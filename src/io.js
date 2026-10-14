'use strict';
/* ===== io.js — export, share, import (merge / replace), old trip-ledger files, CSV ===== */
function stampName() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
const backupText = () => JSON.stringify({ app: APP_ID, v: 1, exported: new Date().toISOString(), data: sanitizeState(S) });
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { logDiag('download: ' + (e && e.message)); return false; }
}
function backedUp() { DEV.bkAt = Date.now(); DEV.bkN = 0; saveDev(); render(); }
function doExport() {
  const txt = backupText();
  if (download(`caguman-backup-${stampName()}.json`, txt, 'application/json')) { backedUp(); toast('Đã xuất file sao lưu'); }
  else textSheet('Sao lưu', txt, 'Không tải file được. Hãy chép đoạn dưới và lưu lại.');
}
async function shareBackup() {
  const txt = backupText(), name = `caguman-backup-${stampName()}.json`;
  try {
    const f = new File([txt], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Sao lưu sổ chi tiêu' }); backedUp(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; logDiag('share: ' + (e && e.message)); }
  doExport();
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; }
function exportCsv() {
  const t = curTrip(); if (!t) return toast('Chưa có chuyến nào');
  const d = tripData(t.id), rows = [['Loại', 'Ngày', 'Nội dung', 'Số tiền', 'Người trả', 'Chia cho / Người nhận']];
  [...d.ex].sort((a, b) => dayOfItem(a).localeCompare(dayOfItem(b)) || (a.at || 0) - (b.at || 0))
    .forEach(e => rows.push(['Chi', dayOfItem(e), e.desc, e.amount, nameOf(e.payer), e.split.map(nameOf).join(', ')]));
  d.pay.forEach(p => rows.push(['Thanh toán', dayOfItem(p), '', p.amount, nameOf(p.from), nameOf(p.to)]));
  const txt = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const slug = t.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 30) || 'chuyen';
  if (download(`chi-tieu-${slug}-${stampName()}.csv`, txt, 'text/csv')) toast('Đã xuất CSV');
  else textSheet('CSV', txt);
}

/* ---------- old "Sổ chi tiêu chuyến đi" files: {app:'trip-ledger', people, expenses, settlements} ---------- */
const hid = (p, s) => p + hashStr(String(s)).replace(/[^A-Za-z0-9]/g, '-');
function oldTime(id) {
  const t = parseInt(String(id || '').slice(0, 8), 36);
  return t > 1.5e12 && t < 4.1e12 ? t : 0;
}
function fromLegacy(o) {
  const tid = 'legacy-trip-ledger', st = emptyState(), ids = new Map();
  const mid = raw => {
    const n = sStr(raw, 40); if (!n) return '';
    if (!ids.has(n)) { const id = hid('lg-', n); ids.set(n, id); st.members.push({ id, trip: tid, name: n, c: (ids.size - 1) % PALETTE.length, u: 1 }); }
    return ids.get(n);
  };
  (Array.isArray(o.people) ? o.people : []).forEach(mid);
  let first = 0;
  for (const e of Array.isArray(o.expenses) ? o.expenses : []) {
    if (!isObj(e) || e.id == null) continue;
    const at = oldTime(e.id), payer = mid(e.payer), split = (Array.isArray(e.split) ? e.split : []).map(mid).filter(Boolean);
    const x = sExpense({ id: hid('lx-', e.id), trip: tid, desc: e.desc, amount: e.amount, payer, split, date: at ? keyOf(new Date(at)) : '', at, u: 1 });
    if (x) { st.expenses.push(x); if (at && (!first || at < first)) first = at; }
  }
  for (const p of Array.isArray(o.settlements) ? o.settlements : []) {
    if (!isObj(p) || p.id == null) continue;
    const at = oldTime(p.id);
    const x = sPayment({ id: hid('lp-', p.id), trip: tid, from: mid(p.from), to: mid(p.to), amount: p.amount, date: at ? keyOf(new Date(at)) : '', at, u: 1 });
    if (x) st.payments.push(x);
  }
  st.trips.push({ id: tid, name: 'Chuyến đi (sổ cũ)', at: first, u: 1 });
  return sanitizeState(st);
}
function parseBackup(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw 'Không phải file JSON hợp lệ'; }
  if (isObj(o) && o.app === APP_ID) { if (!isObj(o.data)) throw 'File sao lưu bị hỏng'; return { kind: 'backup', st: sanitizeState(o.data) }; }
  if (isObj(o) && (o.app === 'trip-ledger' || (!o.app && Array.isArray(o.expenses) && Array.isArray(o.people)))) return { kind: 'legacy', st: fromLegacy(o) };
  if (isObj(o) && typeof o.app === 'string') throw 'Đây là file của công cụ khác (' + sStr(o.app, 30) + ')';
  throw 'File không đúng định dạng sổ chi tiêu';
}
const countOf = st => `${st.trips.length} chuyến · ${st.expenses.length} khoản chi · ${st.payments.length} thanh toán`;
let pendingImport = null;
async function readImport(files) {
  const res = [];
  let inc = emptyState();
  for (const f of files.slice(0, 20)) {
    try {
      if (f.size > 15e6) throw 'File quá lớn';
      const p = parseBackup(await f.text());
      inc = mergeStates(inc, p.st);
      res.push({ name: f.name, ok: true, text: (p.kind === 'legacy' ? 'sổ cũ · ' : '') + countOf(p.st) });
    } catch (e) { res.push({ name: f.name, ok: false, text: typeof e === 'string' ? e : 'Không đọc được file' }); if (typeof e !== 'string') logDiag('import: ' + (e && e.message)); }
  }
  const okN = res.filter(r => r.ok).length;
  const list = res.map(r => `<div class="fl ${r.ok ? '' : 'bad'}"><b>${esc(r.name)}</b><span>${esc(r.text)}</span></div>`).join('');
  if (!okN) return openSheet(`${sheetHead('Không nhập được')}${list}<div class="btns"><button class="btn g" data-act="closeSheet">Đóng</button></div>`, { kind: 'import' });
  const m = mergeStates(inc, S);
  let add = 0, upd = 0;
  for (const col of SYNC_COLS) {
    const L = new Map(S[col].map(x => [x.id, x]));
    for (const x of m[col]) { const o = L.get(x.id); if (!o) add++; else if ((o.u || 0) !== (x.u || 0) || itemKey(o) !== itemKey(x)) upd++; }
  }
  pendingImport = inc;
  openSheet(`${sheetHead('Nhập dữ liệu')}${list}<div class="dash"></div>
    <p class="sm"><b>Gộp</b>: thêm ${add} mục mới, cập nhật ${upd} mục. Mục trùng tự bỏ qua.</p>
    <p class="sm"><b>Thay thế</b>: xoá dữ liệu hiện có${SC.on ? ' trên mọi máy đã đồng bộ' : ' trên máy này'} và dùng ${esc(countOf(inc))}.</p>
    <div class="btns col"><button class="btn" data-act="importMerge">Gộp (nên chọn)</button><button class="btn d" data-act="importReplace">Thay thế toàn bộ</button><button class="btn g" data-act="closeSheet">Huỷ</button></div>`, { kind: 'import' });
}
function applyImport(mode) {
  const inc = pendingImport; pendingImport = null; if (!inc) return closeSheet();
  const before = S.trips.length;
  if (mode === 'replace') {
    const old = idsOf(S), del = mergeStates({ ...emptyState(), del: S.del }, { ...emptyState(), del: inc.del }).del;
    for (const col of SYNC_COLS) S[col] = inc[col].map(x => ({ ...x }));
    S.del = del;
    touchAll(old);
    DEV.bkN += 1;
  } else {
    const m = mergeStates(inc, S);
    for (const col of SYNC_COLS) S[col] = m[col];
    S.del = m.del;
    takeSnap();
  }
  if (inc.trips.length === 1 && S.trips.some(t => t.id === inc.trips[0].id)) DEV.trip = inc.trips[0].id;
  fixCurrentTrip(); saveDev();
  markDirty(); persist(); if (SC.on) schedSync(300);
  closeSheet(); TAB = 'ledger'; render(); window.scrollTo(0, 0);
  toast(mode === 'replace' ? 'Đã thay bằng dữ liệu từ file' : `Đã gộp · ${S.trips.length - before > 0 ? 'thêm ' + (S.trips.length - before) + ' chuyến' : 'xong'}`);
}
