'use strict';
/* ===== app.js — state, views, sheets, actions, stability ===== */
let S = emptyState(), DEV = sDev(null), TAB = 'ledger', THEME = 'forest', SCENE_KEY = '', CRASHED = false;
const $ = (s, r = document) => r.querySelector(s);
const TABS = ['ledger', 'balance', 'trips', 'settings'];

/* ---------- persistence ---------- */
function persist() { lsSet(LS_KEY, JSON.stringify(S)); }
function saveDev() { lsSet(LS_DEV, JSON.stringify(DEV)); }
function save() {
  const ch = stampChanges();
  if (ch) { DEV.bkN++; saveDev(); markDirty(); if (SC.on) schedSync(); }
  persist();
  return ch;
}
function commit(fn) { fn(); save(); render(); }
function loadAll() {
  loadDiag();
  const raw = lsGet(LS_KEY);
  let o = null;
  if (raw) { try { o = JSON.parse(raw); } catch (e) { logDiag('load: data could not be read; kept a copy'); lsSet(LS_KEY + '.bad', raw); } }
  S = sanitizeState(o);
  try { DEV = sDev(JSON.parse(lsGet(LS_DEV) || 'null')); } catch (e) { DEV = sDev(null); }
  takeSnap();
  loadSC();
  fixCurrentTrip();
}
function fixCurrentTrip() {
  if (!S.trips.some(t => t.id === DEV.trip)) {
    const t = [...S.trips].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    DEV.trip = t ? t.id : ''; saveDev();
  }
}

/* ---------- lookups and maths ---------- */
const curTrip = () => S.trips.find(t => t.id === DEV.trip) || null;
const memberOf = id => S.members.find(m => m.id === id);
const nameOf = id => { const m = memberOf(id); return m ? m.name : 'Người đã xoá'; };
const colorOf = id => { const m = memberOf(id); return m ? PALETTE[m.c] : '#9AA0A6'; };
const avatar = (id, sm) => `<span class="av${sm ? ' sm' : ''}" style="background:${colorOf(id)}" aria-hidden="true">${esc(initial(nameOf(id)))}</span>`;

function tripData(tid) {
  const mem = S.members.filter(m => m.trip === tid);
  const ex = S.expenses.filter(e => e.trip === tid);
  const pay = S.payments.filter(p => p.trip === tid);
  const order = mem.map(m => m.id);
  ex.forEach(e => [e.payer, ...e.split].forEach(i => { if (!order.includes(i)) order.push(i); }));
  pay.forEach(p => [p.from, p.to].forEach(i => { if (!order.includes(i)) order.push(i); }));
  const paid = {}, share = {}, sent = {}, got = {}, bal = {};
  order.forEach(i => { paid[i] = share[i] = sent[i] = got[i] = 0; });
  let total = 0;
  for (const e of ex) { total += e.amount; paid[e.payer] += e.amount; const s = e.amount / e.split.length; e.split.forEach(i => { share[i] += s; }); }
  for (const p of pay) { sent[p.from] += p.amount; got[p.to] += p.amount; }
  order.forEach(i => { bal[i] = paid[i] - share[i] + sent[i] - got[i]; });
  return { mem, ex, pay, order, paid, share, sent, got, bal, total, transfers: computeTransfers(bal, order) };
}
function computeTransfers(bal, order) {
  const cr = [], db = [];
  order.forEach((id, i) => { const b = Math.round(bal[id] || 0); if (b > 1) cr.push({ id, a: b, i }); else if (b < -1) db.push({ id, a: -b, i }); });
  const by = (x, y) => y.a - x.a || x.i - y.i;
  cr.sort(by); db.sort(by);
  const out = []; let i = 0, j = 0;
  while (i < db.length && j < cr.length) {
    const p = Math.min(db[i].a, cr[j].a);
    if (p > 1) out.push({ from: db[i].id, to: cr[j].id, amt: p });
    db[i].a -= p; cr[j].a -= p;
    if (db[i].a <= 1) i++;
    if (cr[j].a <= 1) j++;
  }
  return out;
}

/* ---------- theme and header ---------- */
function pickTheme() {
  THEME = DEV.theme !== 'random' ? DEV.theme : Object.keys(THEMES)[Math.floor(Math.random() * 4)];
  applyTheme();
}
function applyTheme() {
  const T = THEMES[THEME], r = document.documentElement.style;
  r.setProperty('--ac', T.ac); r.setProperty('--ac2', T.ac2);
  r.setProperty('--acSoft', mix(T.ac, '#ffffff', .86));
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', T.ac);
  SCENE_KEY = ''; updateScene();
}
function updateScene() {
  const ph = phaseOf(new Date().getHours()), key = THEME + ph;
  if (key === SCENE_KEY) return;
  SCENE_KEY = key;
  const img = $('#hdImg'); if (img) img.src = sceneSrc(THEME, ph);
  const hd = $('#hd'); if (hd) hd.classList.toggle('dk', ph === 'dusk' || ph === 'night');
}
function renderHeader() {
  const t = curTrip();
  $('#hdTitle').textContent = t ? t.name : 'Sổ chi tiêu chuyến đi';
  if (t) {
    const d = tripData(t.id);
    $('#hdSub').textContent = (d.mem.length ? d.mem.map(m => m.name).join(' · ') : 'Chưa có thành viên') + ' · ' + d.ex.length + ' khoản chi';
  } else $('#hdSub').textContent = 'Ghi chung · chia đều · biết ai trả ai';
  const d = $('#sdot'); if (d) { d.className = 'sdot s-' + SY.st + (SC.on ? '' : ' hidden'); d.title = syncLine(); }
}

/* ---------- views ---------- */
const rc = (h, cls = '') => `<div class="rc ${cls}">${h}</div>`;
function render() {
  try {
    renderWaiting = false;
    updateScene();
    renderHeader();
    const t = curTrip(), d = t ? tripData(t.id) : null;
    const v = { ledger: viewLedger, balance: viewBalance, trips: viewTrips, settings: viewSettings }[TAB];
    $('#main').innerHTML = (STORAGE_OK ? '' : storageNote()) + v(t, d);
    document.querySelectorAll('#tabs [data-tab]').forEach(b => { const on = b.dataset.tab === TAB; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  } catch (e) {
    logDiag('render: ' + (e && e.stack || e));
    $('#main').innerHTML = rc(`<div class="rh"><div class="eyebrow">— Có lỗi —</div><p class="sm c">Có lỗi khi hiển thị… dữ liệu của bạn vẫn an toàn.</p></div>
      <div class="btns"><button class="btn" data-act="export">Xuất sao lưu</button><button class="btn g" data-act="copyDiag">Chép báo cáo</button></div>`);
  }
}
const storageNote = () => `<div class="note bad">Trình duyệt đang chặn lưu dữ liệu trên máy. Hãy <button class="link" data-act="export">xuất file sao lưu</button> trước khi đóng.</div>`;
function welcome() {
  return rc(`<div class="rh"><div class="eyebrow">— Sổ chi tiêu —</div><div class="h2">Chào mừng!</div>
    <p class="sm c">Ghi các khoản chi chung, chia đều và biết ngay ai cần trả ai.</p></div>
    <div class="btns col"><button class="btn" data-act="newTrip">Tạo chuyến đi đầu tiên</button></div>
    <div class="dash"></div>
    <p class="sm">Đã dùng trên máy khác?</p>
    <div class="btns"><button class="btn g" data-act="goSync">Kết nối đồng bộ</button><button class="btn g" data-act="import">Nhập file</button></div>`);
}
function noMembers(t) {
  return rc(`<div class="rh"><div class="eyebrow">— ${esc(t.name)} —</div><p class="sm c">Chuyến này chưa có ai. Thêm thành viên để bắt đầu ghi.</p></div>
    <div class="btns col"><button class="btn" data-act="tab" data-tab="trips">Thêm thành viên</button></div>`);
}
function splitText(e, memIds) {
  const all = memIds.length > 1 && e.split.length === memIds.length && memIds.every(i => e.split.includes(i));
  return all ? 'chia cả nhóm' : 'chia ' + e.split.map(nameOf).join(', ');
}
function expRow(e, memIds) {
  return `<button class="it" data-act="editExp" data-id="${e.id}">${avatar(e.payer)}<span class="t"><span class="d">${esc(e.desc)}</span><span class="m">${esc(nameOf(e.payer))} trả · ${esc(splitText(e, memIds))}</span></span><span class="a">${fmt(e.amount)} ₫</span></button>`;
}
function transfersHTML(d) {
  if (!d.ex.length && !d.pay.length) return `<div class="settled">Chưa có gì để chia</div>`;
  if (!d.transfers.length) return `<div class="settled">Mọi người đã cân bằng ✓</div>`;
  return d.transfers.map((t, i) => `<button class="tr" data-act="payTransfer" data-i="${i}">${avatar(t.from, 1)}<span class="nm">${esc(nameOf(t.from))}</span><span class="arr">→</span>${avatar(t.to, 1)}<span class="nm">${esc(nameOf(t.to))}</span><span class="x">${fmt(t.amt)} ₫</span></button>`).join('') +
    `<div class="hint c">Bấm vào một dòng khi đã trả xong</div>`;
}
function backupNag() {
  if (DEV.bkN < 10 || (SC.on && SY.st === 'ok')) return '';
  return `<div class="note">${DEV.bkN} thay đổi chưa sao lưu · <button class="link" data-act="export">Xuất file</button></div>`;
}
function viewLedger(t, d) {
  if (!t) return welcome();
  if (!d.mem.length && !d.ex.length) return noMembers(t);
  const memIds = d.mem.map(m => m.id);
  let h = `<div class="rh"><div class="eyebrow">— Sổ chi tiêu —</div><div class="big">${fmt(d.total)} <i>₫</i></div><div class="sm c">${d.ex.length} khoản · ${d.mem.length} người</div></div><div class="dash"></div>`;
  if (!d.ex.length) h += `<div class="empty">Chưa có khoản chi nào — bấm <b>+</b> để thêm</div>`;
  else {
    const days = new Map();
    [...d.ex].sort((a, b) => dayOfItem(b).localeCompare(dayOfItem(a)) || (b.at || 0) - (a.at || 0)).forEach(e => {
      const k = dayOfItem(e); if (!days.has(k)) days.set(k, []); days.get(k).push(e);
    });
    for (const [k, list] of days) {
      h += `<div class="day"><span>${esc(fmtDay(k))}</span><span>${fmt(list.reduce((s, e) => s + e.amount, 0))} ₫</span></div>` + list.map(e => expRow(e, memIds)).join('');
    }
  }
  h += `<div class="dash"></div><div class="lbl">Ai trả ai</div>` + transfersHTML(d);
  if (d.ex.length && !d.transfers.length) h += `<div class="foot">✓ tổng đã cân bằng</div>`;
  return rc(h) + backupNag();
}
function viewBalance(t, d) {
  if (!t) return welcome();
  if (!d.mem.length && !d.ex.length) return noMembers(t);
  let h = `<div class="rh"><div class="eyebrow">— Cân bằng —</div><div class="sm c">Tổng ${fmt(d.total)} ₫ · ${d.ex.length} khoản</div></div><div class="dash"></div>`;
  h += d.order.map(id => {
    const b = Math.round(d.bal[id]), cls = b > 1 ? 'pos' : b < -1 ? 'neg' : '';
    const extra = (d.sent[id] ? ` · đã chuyển ${fmt(d.sent[id])}` : '') + (d.got[id] ? ` · đã nhận ${fmt(d.got[id])}` : '');
    return `<div class="pb">${avatar(id)}<span class="t"><span class="d">${esc(nameOf(id))}</span><span class="m">Đã trả ${fmt(d.paid[id])} · phần chia ${fmt(d.share[id])}${extra}</span></span><span class="v ${cls}">${Math.abs(b) <= 1 ? '0' : fmtSigned(b)} ₫</span></div>`;
  }).join('');
  h += `<div class="hint">Số dương: được nhận lại · số âm: cần trả thêm</div>`;
  h += `<div class="dash"></div><div class="lbl">Ai trả ai</div>` + transfersHTML(d);
  h += `<div class="btns"><button class="btn" data-act="addPay">Ghi thanh toán</button><button class="btn g" data-act="shareSummary">Gửi tóm tắt</button></div>`;
  if (d.pay.length) {
    h += `<div class="dash"></div><div class="lbl">Đã thanh toán</div>` + [...d.pay].sort((a, b) => dayOfItem(b).localeCompare(dayOfItem(a)) || (b.at || 0) - (a.at || 0)).map(p =>
      `<button class="it" data-act="editPay" data-id="${p.id}">${avatar(p.from, 1)}<span class="t"><span class="d">${esc(nameOf(p.from))} → ${esc(nameOf(p.to))}</span><span class="m">${esc(fmtDay(dayOfItem(p)))}</span></span><span class="a pos">${fmt(p.amount)} ₫</span></button>`).join('');
  }
  return rc(h);
}
function viewTrips(t) {
  const trips = [...S.trips].sort((a, b) => (b.at || 0) - (a.at || 0));
  let h = `<div class="rh"><div class="eyebrow">— Các chuyến đi —</div></div>`;
  if (!trips.length) h += `<div class="empty">Chưa có chuyến nào</div>`;
  h += trips.map(x => {
    const d = tripData(x.id), on = t && x.id === t.id;
    return `<button class="trip${on ? ' on' : ''}" data-act="pickTrip" data-id="${x.id}"><span class="t"><span class="d">${esc(x.name)}</span><span class="m">${d.mem.length} người · ${d.ex.length} khoản · ${fmt(d.total)} ₫</span></span>${on ? '<span class="badge">Đang xem</span>' : ''}</button>`;
  }).join('');
  h += `<div class="btns col"><button class="btn g" data-act="newTrip">＋ Chuyến đi mới</button></div>`;
  let out = rc(h);
  if (t) {
    const d = tripData(t.id);
    let m = `<div class="lbl">Thành viên · ${esc(t.name)}</div>`;
    m += d.mem.length ? d.mem.map(x => `<button class="it" data-act="member" data-id="${x.id}">${avatar(x.id)}<span class="t"><span class="d">${esc(x.name)}</span><span class="m">Đã trả ${fmt(d.paid[x.id])} ₫</span></span><span class="go">Sửa</span></button>`).join('') : `<div class="empty">Chưa có ai</div>`;
    m += `<div class="srow"><input class="in" id="newMem" maxlength="40" placeholder="Tên người mới…" autocomplete="off" enterkeyhint="done"><button class="btn" data-act="addMember">Thêm</button></div>`;
    m += `<div class="dash"></div><div class="btns"><button class="btn g" data-act="renameTrip">Đổi tên chuyến</button><button class="btn d" data-act="delTrip">Xoá chuyến</button></div>`;
    out += rc(m);
  }
  return out;
}
function viewSettings() {
  const T = THEMES[THEME];
  let h = `<div id="syncBox">${syncInner()}</div><div class="dash"></div>`;
  h += `<div class="lbl">Sao lưu</div><p class="sm">${DEV.bkN ? `${DEV.bkN} thay đổi chưa sao lưu` : 'Không có thay đổi mới'} · lần cuối ${esc(DEV.bkAt ? ago(DEV.bkAt) : 'chưa lần nào')}</p>
    <div class="btns"><button class="btn" data-act="export">Xuất file</button><button class="btn g" data-act="shareBk">Gửi file</button><button class="btn g" data-act="import">Nhập file</button></div>
    <div class="btns"><button class="btn g" data-act="csv">Xuất CSV chuyến đang xem</button></div>
    <p class="hint">Nhập được cả file từ sổ cũ “Sổ chi tiêu chuyến đi”. Có thể chọn nhiều file cùng lúc.</p><div class="dash"></div>`;
  h += `<div class="lbl">Giao diện</div><p class="sm">Hôm nay: ${esc(T.name)} (${esc(THEME)})</p><div class="seg">` +
    [['random', 'Ngẫu nhiên'], ['earth', 'Đất'], ['forest', 'Rừng'], ['sea', 'Biển'], ['wind', 'Gió']].map(([v, n]) => `<button class="${DEV.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}" aria-pressed="${DEV.theme === v}">${n}</button>`).join('') + `</div>
    <button class="tog${DEV.lite ? ' on' : ''}" data-act="lite" aria-pressed="${DEV.lite}"><span class="t"><span class="d">Chế độ nhẹ</span><span class="m">Tắt hiệu ứng chuyển động. Tự bật nếu lần trước ứng dụng bị đóng bất ngờ.</span></span><span class="sw"></span></button><div class="dash"></div>`;
  h += `<div class="lbl">Chẩn đoán</div><p class="sm">Phiên bản ${esc(VERSION)} · lưu trữ ${STORAGE_OK ? 'bình thường' : 'bị chặn'} · ${DIAG.length} dòng nhật ký</p>
    ${DIAG.length ? `<div class="log">${DIAG.slice(-6).reverse().map(x => `<div>${esc(new Date(x.t).toLocaleString('vi-VN'))} · ${esc(x.m)}</div>`).join('')}</div>` : ''}
    <div class="btns"><button class="btn g" data-act="copyDiag">Chép báo cáo</button>${DIAG.length ? '<button class="btn g" data-act="clearDiag">Xoá nhật ký</button>' : ''}</div><div class="dash"></div>`;
  h += `<div class="lbl">Xoá dữ liệu</div><p class="sm">${SC.on ? 'Đồng bộ đang bật: sẽ xoá trên mọi máy đã kết nối.' : 'Chỉ xoá trên máy này.'}</p><div class="btns"><button class="btn d" data-act="eraseAll">Xoá toàn bộ dữ liệu</button></div>`;
  return rc(h);
}
function setTab(t) {
  if (!TABS.includes(t)) return;
  TAB = t; render(); window.scrollTo(0, 0);
}

/* ---------- toast ---------- */
let toastT = 0;
function toast(m, ms = 2200) {
  const el = $('#toast'); el.textContent = m; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms);
}

/* ---------- history: Back closes sheets; Back on the main screen needs two swipes ---------- */
let HIST_OK = true, lastBack = 0;
let sheetOpen = false, sheetClosing = false, sheetQueue = null, sheetCtx = null, sheetTok = 0;
function initHistory() {
  try { history.replaceState({ cgm: 'base' }, ''); history.pushState({ cgm: 'guard' }, ''); }
  catch (e) { HIST_OK = false; logDiag('history blocked'); }
}
function pushHist(k) { if (!HIST_OK) return; try { history.pushState({ cgm: k }, ''); } catch (e) { HIST_OK = false; } }
window.addEventListener('popstate', () => {
  if (sheetClosing) { sheetClosing = false; hideSheet(); flushSheetQueue(); return; }
  if (sheetOpen) { hideSheet(); return; }
  const st = history.state && history.state.cgm;
  if (st === 'guard' || st === 'sheet') return;
  if (TAB !== 'ledger') { setTab('ledger'); pushHist('guard'); return; }
  if (Date.now() - lastBack < 2500) { try { history.back(); } catch (e) { /* ignore */ } return; }
  lastBack = Date.now(); toast('Vuốt lại lần nữa để thoát'); pushHist('guard');
});

/* ---------- bottom sheets ---------- */
function openSheet(html, ctx) {
  if (sheetClosing) { sheetQueue = [html, ctx]; return; }
  const el = $('#sheet');
  el.innerHTML = html; sheetCtx = ctx || {};
  sheetTok++;
  if (!sheetOpen) {
    sheetOpen = true; pushHist('sheet');
    el.classList.remove('hidden'); $('#scrim').classList.remove('hidden');
    void el.offsetWidth; el.classList.add('open'); $('#scrim').classList.add('open');
  }
  el.scrollTop = 0;
  try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}
function closeSheet() {
  if (!sheetOpen || sheetClosing) return;
  if (HIST_OK && history.state && history.state.cgm === 'sheet') {
    sheetClosing = true;
    try { history.back(); } catch (e) { sheetClosing = false; hideSheet(); return; }
    const tok = sheetTok;
    setTimeout(() => { if (sheetClosing && tok === sheetTok) { sheetClosing = false; hideSheet(); flushSheetQueue(); } }, 700);
  } else hideSheet();
}
function hideSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheetCtx = null;
  const el = $('#sheet'), tok = ++sheetTok;
  el.classList.remove('open'); $('#scrim').classList.remove('open');
  if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  const done = () => { if (tok === sheetTok && !sheetOpen) { el.classList.add('hidden'); $('#scrim').classList.add('hidden'); el.innerHTML = ''; } };
  if (DEV.lite) done(); else setTimeout(done, 220);
  if (renderWaiting) render();
}
function flushSheetQueue() { const q = sheetQueue; sheetQueue = null; if (q) openSheet(q[0], q[1]); }
const sheetHead = title => `<div class="sh-h"><div class="sh-t">${esc(title)}</div><button class="shx" data-act="closeSheet" aria-label="Đóng">✕</button></div>`;
function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file'].includes(a.type)));
}
function armed(b) {
  const now = Date.now();
  if (b.dataset.armed && now - Number(b.dataset.armed) < 3000) return true;
  b.dataset.armed = now; if (!b.dataset.label) b.dataset.label = b.textContent;
  b.textContent = 'Bấm lần nữa để xoá';
  setTimeout(() => { if (b.isConnected && b.dataset.armed && Date.now() - Number(b.dataset.armed) >= 2900) { delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3000);
  return false;
}
const chip = (id, on, act) => `<button class="chip${on ? ' on' : ''}" data-act="${act}" data-id="${id}" aria-pressed="${on}">${avatar(id, 1)}<span>${esc(nameOf(id))}</span></button>`;

/* ---------- expense sheet ---------- */
function expIds(c) {
  const ids = S.members.filter(m => m.trip === c.trip).map(m => m.id);
  for (const i of [c.payer, ...c.split]) if (i && !ids.includes(i)) ids.push(i);
  return ids;
}
function expenseSheet(id) {
  const t = curTrip(); if (!t) return tripSheet();
  const memIds = S.members.filter(m => m.trip === t.id).map(m => m.id);
  const e = id ? S.expenses.find(x => x.id === id) : null;
  if (id && !e) return toast('Khoản này không còn nữa');
  if (!e && !memIds.length) { setTab('trips'); return toast('Thêm thành viên trước'); }
  const lp = DEV.payer[t.id];
  const ctx = { kind: 'exp', id: e ? e.id : '', trip: e ? e.trip : t.id, payer: e ? e.payer : (memIds.includes(lp) ? lp : memIds[0]), split: new Set(e ? e.split : memIds) };
  openSheet(`${sheetHead(e ? 'Sửa khoản chi' : 'Thêm khoản chi')}
    <div class="fld"><label for="fDesc">Nội dung</label><input class="in" id="fDesc" maxlength="120" placeholder="VD: Taxi, lẩu gà…" value="${e ? esc(e.desc) : ''}" autocomplete="off"></div>
    <div class="fld"><label for="fAmt">Số tiền (₫)</label><div class="srow"><input class="in amt" id="fAmt" inputmode="numeric" autocomplete="off" placeholder="0" value="${e ? fmt(e.amount) : ''}"><button class="btn g" data-act="add000" data-for="fAmt">000</button></div></div>
    <div class="fld"><div class="flab">Người trả</div><div class="chips" id="cPayer"></div></div>
    <div class="fld"><div class="flab">Chia cho <button class="link" data-act="splitAll">chọn tất cả</button></div><div class="chips" id="cSplit"></div><div class="hint" id="perHead"></div></div>
    <div class="fld"><label for="fDate">Ngày</label><input class="in" id="fDate" type="date" value="${e && e.date ? e.date : todayKey()}"></div>
    <div class="err" id="fErr" role="alert"></div>
    <div class="btns"><button class="btn" data-act="saveExp">${e ? 'Lưu thay đổi' : 'Ghi vào sổ'}</button>${e ? '<button class="btn d" data-act="delExp">Xoá</button>' : ''}</div>`, ctx);
  drawExpChips();
}
function drawExpChips() {
  const c = sheetCtx; if (!c || c.kind !== 'exp') return;
  const ids = expIds(c);
  $('#cPayer').innerHTML = ids.map(id => chip(id, c.payer === id, 'pickPayer')).join('');
  $('#cSplit').innerHTML = ids.map(id => chip(id, c.split.has(id), 'toggleSplit')).join('');
  updatePerHead();
}
function updatePerHead() {
  const c = sheetCtx, el = $('#perHead'); if (!c || !el) return;
  const a = Number(digits($('#fAmt').value)) || 0, n = c.split.size;
  el.textContent = !n ? 'Chưa chọn ai' : a ? `Mỗi người ${fmt(a / n)} ₫ · ${n} người` : `${n} người`;
}

/* ---------- payment sheet ---------- */
function paymentSheet(id, pre) {
  const t = curTrip(); if (!t) return;
  const memIds = S.members.filter(m => m.trip === t.id).map(m => m.id);
  const p = id ? S.payments.find(x => x.id === id) : null;
  if (id && !p) return toast('Khoản này không còn nữa');
  if (memIds.length < 2 && !p) return toast('Cần ít nhất 2 người');
  const ctx = { kind: 'pay', id: p ? p.id : '', trip: p ? p.trip : t.id, from: p ? p.from : pre ? pre.from : memIds[0], to: p ? p.to : pre ? pre.to : memIds[1] };
  const amt = p ? p.amount : pre ? pre.amt : 0;
  openSheet(`${sheetHead(p ? 'Sửa thanh toán' : 'Ghi thanh toán')}
    <div class="fld"><div class="flab">Người trả</div><div class="chips" id="cFrom"></div></div>
    <div class="fld"><div class="flab">Người nhận</div><div class="chips" id="cTo"></div></div>
    <div class="fld"><label for="pAmt">Số tiền (₫)</label><div class="srow"><input class="in amt" id="pAmt" inputmode="numeric" autocomplete="off" placeholder="0" value="${amt ? fmt(amt) : ''}"><button class="btn g" data-act="add000" data-for="pAmt">000</button></div></div>
    <div class="fld"><label for="pDate">Ngày</label><input class="in" id="pDate" type="date" value="${p && p.date ? p.date : todayKey()}"></div>
    <div class="err" id="pErr" role="alert"></div>
    <div class="btns"><button class="btn" data-act="savePay">${p ? 'Lưu thay đổi' : 'Ghi đã trả'}</button>${p ? '<button class="btn d" data-act="delPay">Xoá</button>' : ''}</div>`, ctx);
  drawPayChips();
}
function drawPayChips() {
  const c = sheetCtx; if (!c || c.kind !== 'pay') return;
  const ids = S.members.filter(m => m.trip === c.trip).map(m => m.id);
  for (const i of [c.from, c.to]) if (i && !ids.includes(i)) ids.push(i);
  $('#cFrom').innerHTML = ids.map(id => chip(id, c.from === id, 'pickFrom')).join('');
  $('#cTo').innerHTML = ids.map(id => chip(id, c.to === id, 'pickTo')).join('');
}

/* ---------- trip and member sheets ---------- */
function parseNames(s) {
  const out = [];
  for (const raw of String(s || '').split(/[,;\n]+/)) {
    const n = sStr(raw, 40);
    if (n && !out.some(x => x.toLocaleLowerCase('vi') === n.toLocaleLowerCase('vi'))) out.push(n);
    if (out.length >= 30) break;
  }
  return out;
}
function tripSheet() {
  const t = curTrip(), d = new Date();
  const prev = t ? S.members.filter(m => m.trip === t.id) : [];
  openSheet(`${sheetHead('Chuyến đi mới')}
    <div class="fld"><label for="tName">Tên chuyến</label><input class="in" id="tName" maxlength="60" autocomplete="off" value="Chuyến đi ${pad(d.getDate())}/${pad(d.getMonth() + 1)}"></div>
    ${prev.length ? `<button class="tog on" data-act="toggleReuse" id="reuse" aria-pressed="true"><span class="t"><span class="d">Dùng lại thành viên</span><span class="m">${esc(prev.map(m => m.name).join(', '))}</span></span><span class="sw"></span></button>` : ''}
    <div class="fld"><label for="tMem">${prev.length ? 'Thêm người khác' : 'Thành viên'}</label><input class="in" id="tMem" maxlength="400" autocomplete="off" placeholder="Tên, cách nhau bằng dấu phẩy"></div>
    <div class="err" id="tErr" role="alert"></div>
    <div class="btns"><button class="btn" data-act="saveTrip">Tạo chuyến</button></div>`, { kind: 'trip', reuse: prev.length > 0, from: t ? t.id : '' });
}
function tripSwitchSheet() {
  const trips = [...S.trips].sort((a, b) => (b.at || 0) - (a.at || 0));
  openSheet(`${sheetHead('Chọn chuyến đi')}` + trips.map(x => `<button class="trip${x.id === DEV.trip ? ' on' : ''}" data-act="pickTrip" data-id="${x.id}"><span class="t"><span class="d">${esc(x.name)}</span></span>${x.id === DEV.trip ? '<span class="badge">Đang xem</span>' : ''}</button>`).join('') +
    `<div class="btns col"><button class="btn g" data-act="newTrip">＋ Chuyến đi mới</button></div>`, { kind: 'switch' });
}
function memberSheet(id) {
  const m = memberOf(id); if (!m) return toast('Người này không còn nữa');
  const used = S.expenses.some(e => e.trip === m.trip && (e.payer === id || e.split.includes(id))) || S.payments.some(p => p.trip === m.trip && (p.from === id || p.to === id));
  openSheet(`${sheetHead('Thành viên')}
    <div class="fld"><label for="mName">Tên</label><input class="in" id="mName" maxlength="40" autocomplete="off" value="${esc(m.name)}"></div>
    <div class="flab">Màu</div><div class="chips" id="cCol">${PALETTE.map((c, i) => `<button class="dot${m.c === i ? ' on' : ''}" data-act="pickCol" data-i="${i}" style="background:${c}" aria-label="Màu ${i + 1}"></button>`).join('')}</div>
    <div class="err" id="mErr" role="alert"></div>
    <div class="btns"><button class="btn" data-act="saveMember">Lưu</button>${used ? '' : '<button class="btn d" data-act="delMember">Xoá khỏi chuyến</button>'}</div>
    ${used ? '<p class="hint">Người này đã có trong khoản chi hoặc thanh toán nên không xoá được. Bạn vẫn có thể đổi tên.</p>' : ''}`, { kind: 'member', id, c: m.c });
}
function renameTripSheet() {
  const t = curTrip(); if (!t) return;
  openSheet(`${sheetHead('Đổi tên chuyến')}<div class="fld"><label for="rName">Tên chuyến</label><input class="in" id="rName" maxlength="60" autocomplete="off" value="${esc(t.name)}"></div>
    <div class="err" id="rErr" role="alert"></div><div class="btns"><button class="btn" data-act="saveRename">Lưu</button></div>`, { kind: 'rename', id: t.id });
}
function confirmSheet(title, text, label, onYes) {
  openSheet(`${sheetHead(title)}<p class="sm">${text}</p><div class="btns"><button class="btn d" data-act="confirmYes">${esc(label)}</button><button class="btn g" data-act="closeSheet">Huỷ</button></div>`, { kind: 'confirm', onYes });
}
function textSheet(title, text, note) {
  openSheet(`${sheetHead(title)}${note ? `<p class="sm">${esc(note)}</p>` : ''}<textarea class="in ta" id="tsText" readonly>${esc(text)}</textarea><div class="btns"><button class="btn" data-act="copyTs">Chép</button></div>`, { kind: 'text' });
}
function copyText(text, done) {
  const fallback = () => textSheet('Chép thủ công', text, 'Không chép tự động được. Giữ ngón tay lên ô dưới để chọn và chép.');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => toast(done || 'Đã chép'), fallback); return; }
  } catch (e) { /* fall through */ }
  fallback();
}

/* ---------- summary text ---------- */
function summaryText() {
  const t = curTrip(); if (!t) return '';
  const d = tripData(t.id);
  const lines = [t.name, `Tổng: ${fmt(d.total)} ₫ · ${d.ex.length} khoản chi`, ''];
  d.order.forEach(id => lines.push(`${nameOf(id)}: đã trả ${fmt(d.paid[id])} ₫ · phần chia ${fmt(d.share[id])} ₫`));
  lines.push('', 'Ai trả ai:');
  if (!d.transfers.length) lines.push('Mọi người đã cân bằng ✓');
  d.transfers.forEach(x => lines.push(`• ${nameOf(x.from)} → ${nameOf(x.to)}: ${fmt(x.amt)} ₫`));
  return lines.join('\n');
}

/* ---------- actions ---------- */
const ACT = {
  tab: b => setTab(b.dataset.tab),
  add: () => { const t = curTrip(); if (!t) return tripSheet(); expenseSheet(); },
  closeSheet: () => closeSheet(),
  newTrip: () => tripSheet(),
  tripSwitch: () => { if (!S.trips.length) return tripSheet(); tripSwitchSheet(); },
  pickTrip: b => { DEV.trip = b.dataset.id; saveDev(); if (sheetOpen) closeSheet(); TAB = 'ledger'; render(); window.scrollTo(0, 0); },
  syncDot: () => toast(syncLine(), 3200),
  goSync: () => { setTab('settings'); const el = $('#syncBox'); if (el) el.scrollIntoView({ block: 'center' }); },

  editExp: b => expenseSheet(b.dataset.id),
  pickPayer: b => { sheetCtx.payer = b.dataset.id; drawExpChips(); },
  toggleSplit: b => { const s = sheetCtx.split, id = b.dataset.id; if (s.has(id)) s.delete(id); else s.add(id); drawExpChips(); },
  splitAll: () => { const c = sheetCtx; const ids = S.members.filter(m => m.trip === c.trip).map(m => m.id); const all = ids.every(i => c.split.has(i)); c.split = new Set(all ? [] : ids); drawExpChips(); },
  add000: b => { const el = $('#' + b.dataset.for); if (!el) return; const d = digits(el.value) || '1'; el.value = fmt(Number((d + '000').slice(0, 12))); updatePerHead(); },
  saveExp: () => {
    const c = sheetCtx, err = m => { $('#fErr').textContent = m; };
    const desc = sStr($('#fDesc').value, 120), amount = Number(digits($('#fAmt').value)), date = sDate($('#fDate').value) || todayKey();
    if (!desc) return err('Nhập nội dung khoản chi.');
    if (!amount) return err('Nhập số tiền lớn hơn 0.');
    if (!c.split.size) return err('Chọn ít nhất một người để chia.');
    if (!S.trips.some(t => t.id === c.trip)) { closeSheet(); return toast('Chuyến này đã bị xoá trên máy khác'); }
    const split = expIds(c).filter(id => c.split.has(id));
    if (c.id) {
      const e = S.expenses.find(x => x.id === c.id);
      if (!e) { closeSheet(); return toast('Khoản này đã bị xoá trên máy khác'); }
      commit(() => Object.assign(e, { desc, amount, payer: c.payer, split, date }));
    } else {
      if (TAB !== 'ledger' && TAB !== 'balance') { TAB = 'ledger'; window.scrollTo(0, 0); }
      commit(() => S.expenses.push({ id: newId(), trip: c.trip, desc, amount, payer: c.payer, split, date, at: Date.now(), u: 0 }));
    }
    DEV.payer[c.trip] = c.payer; saveDev();
    closeSheet(); toast(c.id ? 'Đã lưu' : 'Đã ghi vào sổ');
  },
  delExp: b => { if (!armed(b)) return; const id = sheetCtx.id; commit(() => { S.expenses = S.expenses.filter(x => x.id !== id); }); closeSheet(); toast('Đã xoá khoản chi'); },

  payTransfer: b => { const t = curTrip(); if (!t) return; const tr = tripData(t.id).transfers[Number(b.dataset.i)]; if (tr) paymentSheet(null, tr); },
  addPay: () => paymentSheet(),
  editPay: b => paymentSheet(b.dataset.id),
  pickFrom: b => { sheetCtx.from = b.dataset.id; drawPayChips(); },
  pickTo: b => { sheetCtx.to = b.dataset.id; drawPayChips(); },
  savePay: () => {
    const c = sheetCtx, err = m => { $('#pErr').textContent = m; };
    const amount = Number(digits($('#pAmt').value)), date = sDate($('#pDate').value) || todayKey();
    if (!c.from || !c.to) return err('Chọn người trả và người nhận.');
    if (c.from === c.to) return err('Người trả và người nhận phải khác nhau.');
    if (!amount) return err('Nhập số tiền lớn hơn 0.');
    if (!S.trips.some(t => t.id === c.trip)) { closeSheet(); return toast('Chuyến này đã bị xoá trên máy khác'); }
    if (c.id) {
      const p = S.payments.find(x => x.id === c.id);
      if (!p) { closeSheet(); return toast('Khoản này đã bị xoá trên máy khác'); }
      commit(() => Object.assign(p, { from: c.from, to: c.to, amount, date }));
    } else commit(() => S.payments.push({ id: newId(), trip: c.trip, from: c.from, to: c.to, amount, date, at: Date.now(), u: 0 }));
    closeSheet(); toast('Đã ghi thanh toán');
  },
  delPay: b => { if (!armed(b)) return; const id = sheetCtx.id; commit(() => { S.payments = S.payments.filter(x => x.id !== id); }); closeSheet(); toast('Đã xoá thanh toán'); },
  shareSummary: async () => {
    const text = summaryText(); if (!text) return;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    copyText(text, 'Đã chép tóm tắt — dán vào Zalo nhé');
  },

  toggleReuse: b => { sheetCtx.reuse = !sheetCtx.reuse; b.classList.toggle('on', sheetCtx.reuse); b.setAttribute('aria-pressed', sheetCtx.reuse); },
  saveTrip: () => {
    const c = sheetCtx, name = sStr($('#tName').value, 60);
    if (!name) { $('#tErr').textContent = 'Nhập tên chuyến.'; return; }
    const prev = c.reuse && c.from ? S.members.filter(m => m.trip === c.from) : [];
    const names = parseNames($('#tMem').value).filter(n => !prev.some(m => m.name.toLocaleLowerCase('vi') === n.toLocaleLowerCase('vi')));
    const id = newId(), now = Date.now();
    commit(() => {
      S.trips.push({ id, name, at: now, u: 0 });
      prev.forEach(m => S.members.push({ id: newId(), trip: id, name: m.name, c: m.c, u: 0 }));
      names.forEach((n, i) => S.members.push({ id: newId(), trip: id, name: n, c: (prev.length + i) % PALETTE.length, u: 0 }));
      DEV.trip = id; saveDev();
    });
    closeSheet();
    TAB = (prev.length + names.length) ? 'ledger' : 'trips'; render(); window.scrollTo(0, 0);
    toast((prev.length + names.length) ? 'Đã tạo chuyến · bấm + để ghi khoản chi' : 'Đã tạo chuyến · thêm thành viên ở đây');
  },
  renameTrip: () => renameTripSheet(),
  saveRename: () => {
    const name = sStr($('#rName').value, 60), t = S.trips.find(x => x.id === sheetCtx.id);
    if (!name) { $('#rErr').textContent = 'Nhập tên chuyến.'; return; }
    if (t) commit(() => { t.name = name; });
    closeSheet();
  },
  delTrip: () => {
    const t = curTrip(); if (!t) return; const d = tripData(t.id);
    confirmSheet('Xoá chuyến', `Xoá <b>${esc(t.name)}</b> cùng ${d.ex.length} khoản chi và ${d.pay.length} thanh toán?${SC.on ? ' Sẽ xoá trên mọi máy đã đồng bộ.' : ''} Không hoàn tác được.`, 'Xoá chuyến', () => {
      const id = t.id;
      commit(() => { S.trips = S.trips.filter(x => x.id !== id); purgeOrphans(S); fixCurrentTrip(); });
      toast('Đã xoá chuyến');
    });
  },
  confirmYes: b => { if (!armed(b)) return; const f = sheetCtx && sheetCtx.onYes; closeSheet(); if (f) f(); },
  addMember: () => {
    const t = curTrip(), el = $('#newMem'); if (!t || !el) return;
    const name = sStr(el.value, 40); if (!name) return el.focus();
    const mem = S.members.filter(m => m.trip === t.id);
    if (mem.some(m => m.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) return toast('Đã có người tên này');
    if (mem.length >= 30) return toast('Tối đa 30 người mỗi chuyến');
    const used = new Set(mem.map(m => m.c)); let c = 0; while (used.has(c) && c < PALETTE.length - 1) c++;
    commit(() => S.members.push({ id: newId(), trip: t.id, name, c: used.size >= PALETTE.length ? mem.length % PALETTE.length : c, u: 0 }));
    toast('Đã thêm ' + name);
    const n = $('#newMem'); if (n) n.focus();
  },
  member: b => memberSheet(b.dataset.id),
  pickCol: b => { sheetCtx.c = Number(b.dataset.i); document.querySelectorAll('#cCol .dot').forEach(x => x.classList.toggle('on', x === b)); },
  saveMember: () => {
    const c = sheetCtx, m = memberOf(c.id), name = sStr($('#mName').value, 40);
    if (!m) { closeSheet(); return toast('Người này không còn nữa'); }
    if (!name) { $('#mErr').textContent = 'Nhập tên.'; return; }
    if (S.members.some(x => x.trip === m.trip && x.id !== m.id && x.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) { $('#mErr').textContent = 'Đã có người tên này.'; return; }
    commit(() => { m.name = name; m.c = c.c; });
    closeSheet();
  },
  delMember: b => { if (!armed(b)) return; const id = sheetCtx.id; commit(() => { S.members = S.members.filter(x => x.id !== id); }); closeSheet(); toast('Đã xoá'); },

  export: () => doExport(),
  shareBk: () => shareBackup(),
  import: () => { const f = $('#fileIn'); f.value = ''; f.click(); },
  csv: () => exportCsv(),
  importMerge: () => applyImport('merge'),
  importReplace: b => { if (!armed(b)) return; applyImport('replace'); },
  copyTs: () => { const el = $('#tsText'); copyText(el ? el.value : ''); },

  theme: b => { DEV.theme = b.dataset.v; saveDev(); if (DEV.theme !== 'random') THEME = DEV.theme; applyTheme(); render(); },
  lite: () => { DEV.lite = !DEV.lite; saveDev(); document.body.classList.toggle('lite', DEV.lite); render(); },
  copyDiag: () => copyText(diagReport(), 'Đã chép báo cáo'),
  clearDiag: () => { DIAG = []; lsSet(LS_DIAG, '[]'); render(); },
  eraseAll: () => confirmSheet('Xoá toàn bộ dữ liệu', SC.on ? 'Xoá mọi chuyến, khoản chi và thanh toán <b>trên mọi máy đã đồng bộ</b>. Nên xuất file sao lưu trước. Không hoàn tác được.' : 'Xoá mọi chuyến, khoản chi và thanh toán trên máy này. Nên xuất file sao lưu trước. Không hoàn tác được.', 'Xoá hết', () => {
    if (SC.on) commit(() => { for (const col of SYNC_COLS) S[col] = []; fixCurrentTrip(); });
    else { S = emptyState(); takeSnap(); persist(); DEV.trip = ''; DEV.bkN = 0; saveDev(); render(); }
    TAB = 'ledger'; render(); toast('Đã xoá toàn bộ dữ liệu');
  }),

  syncSrvShow: () => { const f = $('#srvFld'); if (f) { f.classList.remove('hidden'); const i = $('#ssrv'); if (i && !i.value) i.value = DEFAULT_SERVER; } },
  syncConnect: async b => {
    const pin = ($('#spin') || {}).value || '', srvEl = $('#ssrv'), fld = $('#srvFld');
    const server = srvEl && fld && !fld.classList.contains('hidden') ? srvEl.value.trim().replace(/\/+$/, '') : '';
    const err = m => { const e = $('#syncErr'); if (e) e.textContent = m; };
    if (!/^\d{4,8}$/.test(pin.trim())) return err('PIN gồm 4 chữ số.');
    if (server && !/^https?:\/\/[^\s"'<>]+$/.test(server)) return err('Địa chỉ phải bắt đầu bằng https://');
    if (!server && !pageServer()) return err(syncErrText({ kind: 'noserver' }));
    b.disabled = true; b.textContent = 'Đang kết nối…';
    try {
      const r = await connectSync(pin.trim(), server);
      if (r === 'ask') {
        openSheet(`${sheetHead('Gộp dữ liệu?')}<p class="sm">Máy này và trên mây đều đã có dữ liệu. Bạn muốn làm gì?</p>
          <div class="btns col"><button class="btn" data-act="connectMerge">Gộp cả hai (nên chọn)</button><button class="btn g" data-act="connectCloud">Dùng bản trên mây</button><button class="btn g" data-act="closeSheet">Huỷ</button></div>
          <p class="hint">“Dùng bản trên mây” sẽ thay dữ liệu trên máy này.</p>`, { kind: 'connect' });
      } else {
        toast(r === 'took' ? 'Đã tải dữ liệu từ mây' : 'Đã kết nối đồng bộ');
        render(); syncNow(true);
      }
    } catch (e) { err(syncErrText(e)); b.disabled = false; b.textContent = 'Kết nối'; }
  },
  connectMerge: () => { finishConnect('merge'); closeSheet(); render(); syncNow(true); toast('Đã gộp và bật đồng bộ'); },
  connectCloud: b => { if (!armed(b)) return; finishConnect('cloud'); closeSheet(); render(); syncNow(true); toast('Đã dùng bản trên mây'); },
  syncNowBtn: () => syncNow(true),
  syncOff: b => { if (!armed(b)) return; disconnectSync(); render(); toast('Đã ngắt đồng bộ · dữ liệu vẫn ở trên máy này'); },
  syncPin: () => { const v = (($('#spin2') || {}).value || '').trim(); if (!/^\d{4,8}$/.test(v)) return toast('PIN gồm 4 chữ số'); SC.pin = v; saveSC(); SY.st = ''; syncNow(true); }
};
function diagReport() {
  return [`Caguman ${VERSION}`, navigator.userAgent,
    `Lưu trữ: ${STORAGE_OK ? 'ok' : 'bị chặn'} · Lite: ${DEV.lite} · History: ${HIST_OK}`,
    `Dữ liệu: ${S.trips.length} chuyến, ${S.members.length} người, ${S.expenses.length} khoản, ${S.payments.length} thanh toán, ${Object.keys(S.del).length} dấu xoá`,
    `Đồng bộ: ${SC.on ? 'bật' : 'tắt'} · ${SY.st} · rev ${SC.rev}`, '',
    ...DIAG.slice(-30).map(x => new Date(x.t).toISOString() + ' ' + x.m)].join('\n');
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (e.target.closest('#scrim')) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  e.preventDefault();
  try { const r = fn(b, e); if (r && r.catch) r.catch(err => logDiag('act ' + b.dataset.act + ': ' + (err && err.message || err))); }
  catch (err) { logDiag('act ' + b.dataset.act + ': ' + (err && err.stack || err)); toast('Có lỗi xảy ra · xem Chẩn đoán trong Cài đặt'); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList && el.classList.contains('amt')) {
    const d = digits(el.value); el.value = d ? fmt(Number(d)) : '';
    if (el.id === 'fAmt') updatePerHead();
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target && e.target.id;
  if (id === 'newMem') { e.preventDefault(); ACT.addMember(); }
  else if (id === 'spin') { e.preventDefault(); const b = document.querySelector('[data-act=syncConnect]'); if (b) b.click(); }
});
$('#scrim').addEventListener('click', () => closeSheet());
$('#fileIn').addEventListener('change', e => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) readImport(f); });

/* ---------- stability: crash detection, visibility, timers ---------- */
function markVis() { lsSet(LS_VIS, JSON.stringify({ vis: document.visibilityState === 'hidden' ? 0 : 1, t: Date.now() })); }
function checkCrash() {
  let o = null; try { o = JSON.parse(lsGet(LS_VIS) || 'null'); } catch (e) { /* ignore */ }
  if (isObj(o) && o.vis === 1 && Date.now() - sTs(o.t) < 10 * 60e3) {
    CRASHED = true; logDiag('last session closed while open');
    if (!DEV.lite) { DEV.lite = true; saveDev(); }
  }
  markVis();
}
document.addEventListener('visibilitychange', () => {
  markVis();
  if (document.visibilityState === 'hidden') flushOnHide();
  else { updateScene(); if (!isTyping()) render(); if (SC.on) syncNow(false); }
});
window.addEventListener('pagehide', () => { lsSet(LS_VIS, JSON.stringify({ vis: 0, t: Date.now() })); flushOnHide(); });
window.addEventListener('online', () => { if (SC.on) syncNow(false); });
window.addEventListener('error', e => logDiag('error: ' + (e.message || '') + ' @' + (e.lineno || '')));
window.addEventListener('unhandledrejection', e => logDiag('promise: ' + (e.reason && (e.reason.message || e.reason.kind) || e.reason)));
function storageBanner() { const b = $('#banner'); if (b) { b.textContent = 'Không lưu được trên máy này — hãy xuất file sao lưu.'; b.classList.remove('hidden'); } }

/* ---------- start ---------- */
function start() {
  loadAll();
  checkCrash();
  document.body.classList.toggle('lite', DEV.lite);
  pickTheme();
  initHistory();
  render();
  if (!STORAGE_OK) storageBanner();
  if (CRASHED) toast('Lần trước ứng dụng bị đóng bất ngờ · đã bật Chế độ nhẹ', 4000);
  setSync(SC.on ? 'busy' : 'off');
  if (SC.on) syncNow(false);
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    markVis(); updateScene();
    if (!isTyping()) render();
    if (SC.on) syncNow(false);
  }, 30000);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  try { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
}
