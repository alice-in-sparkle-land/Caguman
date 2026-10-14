'use strict';
/* ===== data.js — storage, sanitizers, state, formatting ===== */
const APP_ID = 'caguman';
const VERSION = '1.0 · 2026-10-14';
const LS_KEY = 'cgm.v1', LS_DEV = 'cgm.dev', LS_VIS = 'cgm.vis', LS_DIAG = 'cgm.diag';
const DEFAULT_SERVER = 'https://caguman.emile-cao.workers.dev';
const SYNC_COLS = ['trips', 'members', 'expenses', 'payments'];
const PALETTE = ['#1D7898', '#C6613A', '#3B7A4D', '#7A4B8F', '#B8862B', '#B6463A', '#4569B3', '#5E7D2E'];
const MAX = { trips: 500, members: 3000, expenses: 30000, payments: 10000 };

/* ---------- storage ---------- */
let STORAGE_OK = true;
function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { STORAGE_OK = false; return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; }
  catch (e) { STORAGE_OK = false; if (typeof storageBanner === 'function') storageBanner(); return false; }
}
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

/* ---------- sanitizers ---------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sStr = (v, n = 200) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '';
const sId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '';
const sNum = (v, min, max, d) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const sTs = v => Math.round(sNum(v, 0, 4102444800000, 0));
const sBool = v => v === true || v === 1;
const sDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00')) ? v : '';
const sAmt = v => { const n = Math.round(sNum(v, 0, 1e12, 0)); return n > 0 ? n : 0; };
function sDel(o) {
  const out = {}, cut = Date.now() - 400 * 864e5;
  if (isObj(o)) for (const k of Object.keys(o).sort()) { if (!sId(k)) continue; const t = sTs(o[k]); if (t > cut) out[k] = t; }
  return out;
}
function sTrip(x) {
  if (!isObj(x)) return null;
  const id = sId(x.id), name = sStr(x.name, 60);
  if (!id || !name) return null;
  return { id, name, at: sTs(x.at), u: sTs(x.u) };
}
function sMember(x) {
  if (!isObj(x)) return null;
  const id = sId(x.id), trip = sId(x.trip), name = sStr(x.name, 40);
  if (!id || !trip || !name) return null;
  return { id, trip, name, c: Math.round(sNum(x.c, 0, PALETTE.length - 1, 0)), u: sTs(x.u) };
}
function sIds(a, n = 60) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (const v of a) { const id = sId(v); if (id && !out.includes(id)) out.push(id); if (out.length >= n) break; }
  return out;
}
function sExpense(x) {
  if (!isObj(x)) return null;
  const id = sId(x.id), trip = sId(x.trip), desc = sStr(x.desc, 120), amount = sAmt(x.amount), payer = sId(x.payer), split = sIds(x.split);
  if (!id || !trip || !desc || !amount || !payer || !split.length) return null;
  return { id, trip, desc, amount, payer, split, date: sDate(x.date), at: sTs(x.at), u: sTs(x.u) };
}
function sPayment(x) {
  if (!isObj(x)) return null;
  const id = sId(x.id), trip = sId(x.trip), from = sId(x.from), to = sId(x.to), amount = sAmt(x.amount);
  if (!id || !trip || !from || !to || from === to || !amount) return null;
  return { id, trip, from, to, amount, date: sDate(x.date), at: sTs(x.at), u: sTs(x.u) };
}
const SAN = { trips: sTrip, members: sMember, expenses: sExpense, payments: sPayment };
function sList(arr, fn, max) {
  if (!Array.isArray(arr)) return [];
  const m = new Map();
  for (const raw of arr) {
    const x = fn(raw); if (!x) continue;
    const o = m.get(x.id);
    if (!o || (x.u || 0) > (o.u || 0)) m.set(x.id, x);
    if (m.size >= max) break;
  }
  return [...m.values()];
}
function sanitizeState(o) {
  o = isObj(o) ? o : {};
  const st = { del: sDel(o.del) };
  for (const col of SYNC_COLS) st[col] = sList(o[col], SAN[col], MAX[col]);
  purgeOrphans(st);
  return { trips: st.trips, members: st.members, expenses: st.expenses, payments: st.payments, del: st.del };
}
/* Items whose trip no longer exists are dropped (a trip deleted on one phone while another added to it). */
function purgeOrphans(st) {
  const t = new Set(st.trips.map(x => x.id));
  for (const col of ['members', 'expenses', 'payments']) st[col] = st[col].filter(x => t.has(x.trip));
}
const emptyState = () => ({ trips: [], members: [], expenses: [], payments: [], del: {} });

/* ---------- device-only settings (never synced, never in a backup) ---------- */
function sDev(o) {
  o = isObj(o) ? o : {};
  return {
    trip: sId(o.trip),
    theme: ['random', 'earth', 'forest', 'sea', 'wind'].includes(o.theme) ? o.theme : 'random',
    lite: sBool(o.lite),
    payer: isObj(o.payer) ? Object.fromEntries(Object.entries(o.payer).filter(([k, v]) => sId(k) && sId(v)).slice(-50)) : {},
    bkAt: sTs(o.bkAt),
    bkN: Math.round(sNum(o.bkN, 0, 1e7, 0))
  };
}

/* ---------- ids, numbers, dates ---------- */
function newId() {
  let r = '';
  try { const a = new Uint32Array(2); crypto.getRandomValues(a); r = a[0].toString(36) + a[1].toString(36); }
  catch (e) { r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
  return (Date.now().toString(36) + r).replace(/[^a-z0-9]/g, '').slice(0, 20);
}
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
const fmtSigned = n => (Math.round(n) > 0 ? '+' : '') + fmt(n);
const digits = s => String(s || '').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function fmtDay(key, short) {
  if (!key) return 'Không rõ ngày';
  const d = new Date(key + 'T00:00:00'), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 864e5);
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` + (d.getFullYear() !== t.getFullYear() ? '/' + d.getFullYear() : '');
  if (short) return base;
  if (diff === 0) return 'Hôm nay · ' + base;
  if (diff === 1) return 'Hôm qua · ' + base;
  return WD[d.getDay()] + ' · ' + base;
}
const dayOfItem = x => x.date || (x.at ? keyOf(new Date(x.at)) : '');
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const initial = name => { const ch = [...String(name || '?').trim()][0] || '?'; return ch.toLocaleUpperCase('vi'); };

/* ---------- diagnostics ---------- */
let DIAG = [];
function loadDiag() { try { const a = JSON.parse(lsGet(LS_DIAG) || '[]'); DIAG = Array.isArray(a) ? a.filter(x => isObj(x)).slice(-60).map(x => ({ t: sTs(x.t), m: sStr(x.m, 300) })) : []; } catch (e) { DIAG = []; } }
function logDiag(m) {
  DIAG.push({ t: Date.now(), m: sStr(String(m), 300) });
  if (DIAG.length > 60) DIAG = DIAG.slice(-60);
  lsSet(LS_DIAG, JSON.stringify(DIAG));
}
