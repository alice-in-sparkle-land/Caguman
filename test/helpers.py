"""Shared helpers for the Playwright tests (python3 test/t_*.py, test server on :8787)."""
import json, time, urllib.request

import os
BASE = os.environ.get('BASE', 'http://localhost:8787')
APP = BASE + '/caguman.html'
RESULTS = []


def knob(**kw):
    q = '&'.join(f'{k}={v}' for k, v in kw.items())
    return json.loads(urllib.request.urlopen(f'{BASE}/__knob?{q}').read())


def slot(pin='2468'):
    req = urllib.request.Request(BASE + '/api/slot/caguman', headers={'X-Pin': pin, 'X-Forwarded-For': '9.9.9.9'})
    return json.loads(urllib.request.urlopen(req).read())


def device(browser, ip='10.0.0.1', width=412, init=None, **kw):
    ctx = browser.new_context(viewport={'width': width, 'height': 915}, extra_http_headers={'X-Forwarded-For': ip},
                              accept_downloads=True, **kw)
    if init:
        ctx.add_init_script(init)
    pg = ctx.new_page()
    pg.errors = []
    pg.external = []
    pg.on('pageerror', lambda e: pg.errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: pg.errors.append('console: ' + m.text) if m.type == 'error' and 'net::ERR' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.on('request', lambda r: pg.external.append(r.url) if not r.url.startswith((BASE, 'data:', 'blob:', 'about:')) else None)
    return ctx, pg


def check(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {detail}'), flush=True)
    return cond


def run(name, fn):
    try:
        fn()
    except Exception as e:  # noqa
        import traceback
        traceback.print_exc()
        check(name + ' (crashed)', False, repr(e)[:300])


def summary():
    bad = [r for r in RESULTS if not r[1]]
    print(f'\n{len(RESULTS) - len(bad)}/{len(RESULTS)} passed')
    for r in bad:
        print('  FAILED:', r[0], r[2])
    return not bad


# ---------- UI helpers ----------
def sheet_closed(pg):
    pg.wait_for_function("!sheetOpen && !sheetClosing", timeout=5000)
    pg.wait_for_timeout(250)


def tap(pg, sel):
    pg.locator(sel).first.click()


def create_trip(pg, name, members):
    pg.evaluate("ACT.newTrip()")
    pg.fill('#tName', name)
    pg.fill('#tMem', members)
    tap(pg, '[data-act=saveTrip]')
    sheet_closed(pg)


def mid(pg, name):
    return pg.evaluate("n => (S.members.find(m => m.trip === DEV.trip && m.name === n) || {}).id", name)


def add_expense(pg, desc, amount, payer=None, split=None):
    tap(pg, '.fab')
    pg.wait_for_selector('#fDesc')
    pg.fill('#fDesc', desc)
    pg.fill('#fAmt', str(amount))
    if payer:
        tap(pg, f'#cPayer [data-id="{mid(pg, payer)}"]')
    if split is not None:
        ids = [mid(pg, n) for n in split]
        cur = pg.evaluate("[...sheetCtx.split]")
        for i in set(cur) ^ set(ids):
            tap(pg, f'#cSplit [data-id="{i}"]')
    tap(pg, '[data-act=saveExp]')
    sheet_closed(pg)


def total(pg):
    return pg.evaluate("tripData(DEV.trip).total")


def transfers(pg):
    return pg.evaluate("tripData(DEV.trip).transfers.map(t => [nameOf(t.from), nameOf(t.to), t.amt])")


def wait_sync(pg, timeout=15000):
    pg.evaluate("syncNow(true)")
    pg.wait_for_function("!SY.busy && SY.gen === SY.clean && SY.st === 'ok'", timeout=timeout)


def connect(pg, pin='2468'):
    pg.evaluate("setTab('settings')")
    pg.fill('#spin', pin)
    tap(pg, '[data-act=syncConnect]')
