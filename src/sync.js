'use strict';
/* ===== sync.js — change stamps, merging and cloud sync =====
   Every item carries u (time of its last change). Deleted ids go into S.del with the delete time.
   Device prefs (current trip, theme, Lite mode, backup counters) and the PIN are never sent. */
const LS_SYNC = 'cgm.sync';

/* ---------- canonical helpers ---------- */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function hashStr(s) {
  let h = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h ^= c; h = Math.imul(h, 0x01000193); h2 = (h2 * 31 + c) | 0; }
  return (h >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36) + '.' + s.length.toString(36);
}
function itemKey(x) { const c = {}; for (const k in x) if (k !== 'u') c[k] = x[k]; return JSON.stringify(c); }

/* ---------- change stamps ---------- */
let SNAP = null;
function takeSnap() {
  const cols = {};
  for (const col of SYNC_COLS) { const m = new Map(); for (const x of S[col]) m.set(x.id, { k: itemKey(x), u: x.u || 0 }); cols[col] = m; }
  SNAP = { cols };
}
/* Changed items get u = now, removed items become delete markers. Returns true if anything changed. */
function stampChanges() {
  if (!SNAP) { takeSnap(); return false; }
  const now = Date.now(); let ch = false;
  if (!isObj(S.del)) S.del = {};
  const cols = {};
  for (const col of SYNC_COLS) {
    const old = SNAP.cols[col], m = new Map();
    for (const x of S[col]) {
      const o = old.get(x.id), k = itemKey(x);
      if (o && o.k === k) x.u = o.u; else { x.u = Math.max(now, o ? o.u + 1 : 0); ch = true; }
      m.set(x.id, { k, u: x.u });
    }
    for (const id of old.keys()) if (!m.has(id)) { S.del[id] = Math.max(now, (old.get(id).u || 0) + 1); ch = true; }
    cols[col] = m;
  }
  SNAP = { cols };
  return ch;
}
/* Marks everything as changed now (Import · Replace, so the backup wins on every device). */
function touchAll(oldIds) {
  const now = Date.now();
  for (const col of SYNC_COLS) {
    const have = new Set(S[col].map(x => x.id));
    for (const id of (oldIds[col] || [])) if (!have.has(id)) S.del[id] = now;
    for (const x of S[col]) { x.u = now; delete S.del[x.id]; }
  }
  takeSnap();
}
const idsOf = st => Object.fromEntries(SYNC_COLS.map(c => [c, st[c].map(x => x.id)]));

/* ---------- cloud payload ---------- */
function syncData(st) {
  const c = sanitizeState(st);
  return { app: APP_ID, v: 1, trips: c.trips, members: c.members, expenses: c.expenses, payments: c.payments, del: c.del };
}
const payloadStr = () => JSON.stringify(syncData(S));
function parseRemote(str) {
  let o; try { o = JSON.parse(str); } catch (e) { throw { kind: 'bad', msg: 'Không đọc được dữ liệu trên mây.' }; }
  if (!isObj(o) || o.app !== APP_ID) throw { kind: 'foreign' };
  return sanitizeState(o);
}

/* ---------- merge (same answer whichever device runs it) ---------- */
function newer(a, b) {
  if (!a) return b; if (!b) return a;
  if ((a.u || 0) !== (b.u || 0)) return (a.u || 0) > (b.u || 0) ? a : b;
  return canon(a) >= canon(b) ? a : b;
}
/* L = this device, R = the other copy (cloud or backup). R's order comes first so every device ends with the same order. */
function mergeStates(L, R) {
  const del = { ...R.del };
  for (const [k, t] of Object.entries(L.del || {})) if (!(k in del) || t > del[k]) del[k] = t;
  const out = {};
  for (const col of SYNC_COLS) {
    const Lm = new Map(L[col].map(x => [x.id, x])), used = new Set(), arr = [];
    for (const r of R[col]) { used.add(r.id); arr.push(newer(Lm.get(r.id), r)); }
    for (const l of L[col]) if (!used.has(l.id)) arr.push(l);
    out[col] = arr.filter(x => !(x.id in del) || (x.u || 0) > del[x.id]).map(x => x.split ? { ...x, split: [...x.split] } : { ...x });
  }
  out.del = sDel(del);
  purgeOrphans(out);
  return out;
}
function mergeIn(R) {
  const m = mergeStates(S, R);
  for (const col of SYNC_COLS) S[col] = m[col];
  S.del = m.del;
  fixCurrentTrip();
  takeSnap();
}
function replaceWithRemote(R) {
  for (const col of SYNC_COLS) S[col] = R[col].map(x => ({ ...x }));
  S.del = { ...R.del };
  fixCurrentTrip();
  takeSnap();
}
const hasOwnData = () => S.trips.length > 0;

/* ---------- sync settings on this device ---------- */
const SC = { on: false, pin: '', server: '', slot: 'caguman', rev: 0, hash: '', last: 0 };
function loadSC() {
  try {
    const o = JSON.parse(lsGet(LS_SYNC) || 'null'); if (!isObj(o)) return;
    SC.on = sBool(o.on); SC.pin = /^\d{4,8}$/.test(o.pin) ? o.pin : '';
    SC.server = /^https?:\/\/[^\s"'<>]+$/.test(o.server || '') ? sStr(o.server, 200) : '';
    SC.slot = /^[a-z0-9-]{1,40}$/.test(o.slot) ? o.slot : 'caguman';
    SC.rev = Math.round(sNum(o.rev, 0, 1e12, 0)); SC.hash = sStr(o.hash, 60); SC.last = sTs(o.last);
    if (!SC.pin) SC.on = false;
  } catch (e) { /* ignore */ }
}
function saveSC() { lsSet(LS_SYNC, JSON.stringify(SC)); }
const pageServer = () => /^https?:$/.test(location.protocol) ? location.origin : '';
const apiBase = () => (SC.server || pageServer()).replace(/\/+$/, '');

/* ---------- sync engine ---------- */
const SY = { st: 'off', msg: '', busy: false, again: false, timer: 0, until: 0, gen: 1, clean: 0 };
function markDirty() { SY.gen++; }

async function api(method, path, body, pin, server) {
  const base = (server || apiBase()).replace(/\/+$/, '');
  if (!base) throw { kind: 'noserver' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const tm = setTimeout(() => { if (ctl) ctl.abort(); }, 20000);
  const headers = { 'X-Pin': pin == null ? SC.pin : pin };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(base + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined }); }
  catch (e) { throw { kind: 'net', msg: e && e.message }; }
  finally { clearTimeout(tm); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 401) throw { kind: 'pin', left: j && j.triesLeft };
  if (r.status === 429) throw { kind: 'locked', wait: (j && j.retryIn) || 900 };
  if (r.status === 409 && j) return { conflict: true, ...j };
  if (!r.ok || !j) throw { kind: j && j.error === 'setup' ? 'setup' : 'server', msg: (j && (j.detail || j.error)) || ('HTTP ' + r.status) };
  return j;
}
function syncErrText(e) {
  if (!e || typeof e !== 'object') return 'Đồng bộ không thành công.';
  return {
    net: 'Không kết nối được trang đồng bộ. Thay đổi vẫn được giữ trên máy này.',
    pin: 'Mã PIN không đúng.' + (e.left > 0 ? ` Còn ${e.left} lần thử trước khi tạm khoá 15 phút.` : ''),
    locked: `Nhập sai PIN quá nhiều lần. Đồng bộ tạm dừng ${Math.ceil((e.wait || 900) / 60)} phút.`,
    setup: 'Trang đồng bộ chưa cài đặt xong: ' + (e.msg || ''),
    noserver: 'Hãy nhập địa chỉ trang đồng bộ trước.',
    foreign: 'Chỗ lưu trên mây này đang chứa dữ liệu của công cụ khác.',
    bad: e.msg || 'Không đọc được dữ liệu trên mây.',
    server: 'Trang đồng bộ gặp lỗi (' + (e.msg || 'không rõ') + '). Sẽ tự thử lại.'
  }[e.kind] || 'Đồng bộ không thành công.';
}
function setSync(st, msg = '') {
  SY.st = st; SY.msg = msg;
  const d = document.getElementById('sdot');
  if (d) { d.className = 'sdot s-' + st + (SC.on ? '' : ' hidden'); d.title = syncLine(); }
  const b = document.getElementById('syncBox'); if (b && !b.contains(document.activeElement)) b.innerHTML = syncInner();
}
function ago(t) {
  if (!t) return 'chưa lần nào';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 50) return 'vừa xong'; if (s < 3600) return Math.round(s / 60) + ' phút trước';
  if (s < 86400) return Math.round(s / 3600) + ' giờ trước';
  return fmtDay(keyOf(new Date(t)), true);
}
function syncLine() {
  if (!SC.on) return 'Đồng bộ đang tắt';
  if (SY.st === 'busy') return 'Đang đồng bộ…';
  if (SY.st === 'ok') return 'Đã đồng bộ · ' + ago(SC.last);
  if (SY.st === 'offline') return 'Ngoại tuyến · thay đổi đang chờ trên máy này';
  return SY.msg || 'Chưa đồng bộ';
}
function schedSync(ms = 1500) { clearTimeout(SY.timer); SY.timer = setTimeout(() => syncNow(false), ms); }

function applyRemote(g) {
  if (g.data == null) { SC.rev = 0; SC.hash = ''; saveSC(); markDirty(); return; }
  const R = parseRemote(g.data);
  if (stampChanges()) markDirty();          // keep edits made a moment ago
  mergeIn(R);
  SC.rev = g.rev; SC.hash = hashStr(g.data); saveSC();
  markDirty();
  persist();
  afterRemote();
}
let renderWaiting = false;
function afterRemote() {
  if (isTyping()) { renderWaiting = true; return; }
  render();
}
async function syncNow(manual) {
  if (!SC.on) return setSync('off');
  if (SY.busy) { SY.again = true; return; }
  if (!manual && SY.st === 'pin') return;
  if (!manual && SY.st === 'locked' && Date.now() < SY.until) return;
  if (navigator.onLine === false) return setSync('offline');
  SY.busy = true; setSync('busy');
  try {
    const g = await api('GET', '/slot/' + SC.slot + '?since=' + SC.rev);
    if (!g.same) applyRemote(g);
    for (let i = 0; i < 5 && SY.gen !== SY.clean; i++) {
      const gen = SY.gen, str = payloadStr(), h = hashStr(str);
      if (h === SC.hash) { SY.clean = gen; break; }
      const r = await api('PUT', '/slot/' + SC.slot, { base: SC.rev, data: str });
      if (r.conflict) { applyRemote(r); continue; }
      SC.rev = r.rev; SC.hash = h; SY.clean = gen; saveSC();
    }
    SC.last = Date.now(); saveSC();
    setSync('ok');
  } catch (e) {
    if (e && e.kind === 'locked') SY.until = Date.now() + (e.wait || 900) * 1000;
    if (e && e.kind !== 'net') logDiag('sync: ' + (e.kind || '') + ' ' + (e.msg || e.message || ''));
    setSync(e && e.kind === 'net' ? 'offline' : (e && e.kind) || 'error', syncErrText(e));
  } finally {
    SY.busy = false;
    if (SY.again) { SY.again = false; schedSync(300); }
  }
}
/* When the page is hidden, one last quick save (small data only). */
function flushOnHide() {
  if (!SC.on || SY.busy || SY.gen === SY.clean || SY.st === 'pin' || SY.st === 'locked') return;
  try {
    const str = payloadStr(); if (hashStr(str) === SC.hash) return;
    const body = JSON.stringify({ base: SC.rev, data: str });
    if (body.length > 60000 || !apiBase()) return;
    fetch(apiBase() + '/api/slot/' + SC.slot, { method: 'PUT', keepalive: true, headers: { 'X-Pin': SC.pin, 'Content-Type': 'application/json' }, body }).catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ---------- connect / disconnect ---------- */
let pendingCloud = null;
async function connectSync(pin, server) {
  await api('GET', '/ping', null, pin, server);
  const g = await api('GET', '/slot/' + SC.slot, null, pin, server);
  const R = g.data == null ? null : parseRemote(g.data);
  SC.pin = pin; SC.server = server; SC.on = true; SC.rev = 0; SC.hash = ''; SY.clean = 0; markDirty();
  if (!R) { saveSC(); return 'empty'; }
  if (!hasOwnData()) {
    replaceWithRemote(R); SC.rev = g.rev; SC.hash = hashStr(g.data); SY.clean = SY.gen; saveSC(); persist(); return 'took';
  }
  pendingCloud = { R, g }; SC.on = false;   // stays off until the person chooses
  return 'ask';
}
function finishConnect(choice) {
  const p = pendingCloud; pendingCloud = null; if (!p) return;
  if (choice === 'cloud') replaceWithRemote(p.R); else mergeIn(p.R);
  SC.on = true; SC.rev = p.g.rev; SC.hash = hashStr(p.g.data); markDirty(); saveSC();
  persist();
}
function disconnectSync() {
  Object.assign(SC, { on: false, pin: '', rev: 0, hash: '', last: 0 }); saveSC();
  clearTimeout(SY.timer); setSync('off');
}

/* ---------- settings panel ---------- */
function syncInner() {
  const host = pageServer() ? location.host : '';
  if (!SC.on) {
    const srv = SC.server || (host ? '' : DEFAULT_SERVER);
    return `<div class="lbl">Đồng bộ giữa các máy</div>
      <p class="sm">Dùng chung một mã PIN trên điện thoại của Cá, Gừ, Mẫn để cùng xem và ghi một cuốn sổ.</p>
      <div class="fld"><label for="spin">Mã PIN đồng bộ</label><input class="in" id="spin" name="spin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="4 chữ số"></div>
      ${host ? `<div class="hint">Trang đồng bộ: ${esc(host)} · <button type="button" class="link" data-act="syncSrvShow">dùng địa chỉ khác</button></div>` : ''}
      <div class="fld${host && !SC.server ? ' hidden' : ''}" id="srvFld"><label for="ssrv">Địa chỉ trang đồng bộ</label><input class="in" id="ssrv" name="ssrv" inputmode="url" autocomplete="off" value="${esc(srv)}" placeholder="https://caguman.….workers.dev"></div>
      <div class="err" id="syncErr"></div>
      <div class="btns"><button class="btn" data-act="syncConnect">Kết nối</button></div>`;
  }
  const bad = SY.st === 'pin';
  return `<div class="lbl">Đồng bộ giữa các máy</div>
    <div class="row mt8"><span class="sdot s-${SY.st} inl"></span><div class="sp">${esc(syncLine())}</div></div>
    ${SY.st !== 'ok' && SY.st !== 'busy' && SY.msg ? `<p class="sm">${esc(SY.msg)}</p>` : ''}
    <p class="sm">Trang: ${esc((apiBase() || '').replace(/^https?:\/\//, ''))} · lần cuối ${esc(ago(SC.last))}</p>
    ${bad ? `<div class="srow"><input class="in" name="spin2" id="spin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="PIN"><button class="btn" data-act="syncPin">Thử PIN</button></div>` : ''}
    <div class="btns"><button class="btn" data-act="syncNowBtn">Đồng bộ ngay</button><button class="btn g" data-act="syncOff">Ngắt kết nối</button></div>`;
}
