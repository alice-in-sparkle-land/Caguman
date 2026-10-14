// Local test server: runs the real worker.js with a fake D1 (node:sqlite) and serves /public.
// Knobs: GET /__knob?delay=ms&down=1|0&pin=1234&reset=1&clearguard=1
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8787);
const src = readFileSync(join(ROOT, 'worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a); }
  async first() { const r = this.db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map(r => ({ ...r })) }; }
  async run() { return this._run(); }
  _run() {
    if (/^\s*select/i.test(this.sql)) return { results: this.db.prepare(this.sql).all(...this.args).map(r => ({ ...r })) };
    const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } };
  }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(list) {
    this.db.exec('BEGIN');
    try { const out = list.map(s => s._run()); this.db.exec('COMMIT'); return out; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const env = {
  DB: new D1(), PIN: '2468',
  ASSETS: {
    fetch: async req => {
      const p = new URL(req.url).pathname, f = join(ROOT, 'public', p);
      if (!f.startsWith(join(ROOT, 'public')) || !existsSync(f) || p.endsWith('/')) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' } });
    }
  }
};
const knob = { delay: 0, down: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/__knob') {
      const q = url.searchParams;
      if (q.has('delay')) knob.delay = Number(q.get('delay'));
      if (q.has('down')) knob.down = q.get('down') === '1';
      if (q.has('pin')) env.PIN = q.get('pin');
      if (q.has('reset')) { env.DB = new D1(); }
      if (q.has('clearguard')) { try { env.DB.db.exec('DELETE FROM guard'); } catch (e) { /* no table yet */ } }
      if (q.has('corrupt')) { try { env.DB.db.exec("UPDATE chunks SET part='{bad json'"); } catch (e) { /* none */ } }
      if (q.has('foreign')) {
        try { const s = env.DB.db.prepare('SELECT wid FROM slots WHERE name=?').get(q.get('foreign')); if (s) env.DB.db.prepare("UPDATE chunks SET part=? WHERE wid=?").run(JSON.stringify({ app: 'the-way', v: 2 }), s.wid); } catch (e) { /* none */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...knob, pin: env.PIN })); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (knob.down) { req.socket.destroy(); return; }
      if (knob.delay) await sleep(knob.delay);
    }
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const r = await worker.fetch(request, env, {});
    const out = Buffer.from(await r.arrayBuffer());
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(out);
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
}).listen(PORT, () => console.log('test server on ' + PORT));
