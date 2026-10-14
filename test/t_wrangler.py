"""Run against `wrangler dev` (Cloudflare's real runtime + local D1):
   BASE=http://localhost:8788 python3 test/t_wrangler.py   (put PIN="2468" in .dev.vars; never commit it)
   Note: wrangler dev gives every client 127.0.0.1, so the lockout test runs last."""
import json, sys, os, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *  # noqa


def api(method, path, body=None, pin='2468'):
    req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'X-Pin': pin, 'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ca, A = device(b); A.goto(APP)
        cb, B = device(b); B.goto(APP)

        def t_two_phones():
            s, cur = api('GET', '/slot/caguman')
            if cur.get('data'):  # leftover from an earlier run: start from a clean cloud copy
                api('PUT', '/slot/caguman', {'base': cur['rev'], 'data': json.dumps({'app': 'caguman', 'v': 1, 'trips': [], 'members': [], 'expenses': [], 'payments': [], 'del': {}})})
            create_trip(A, 'Nha Trang', 'Cá, Gừ, Mẫn'); add_expense(A, 'Hải sản', '900000', payer='Mẫn')
            connect(A); A.wait_for_function("SC.on && SY.st==='ok'", timeout=15000)
            connect(B); B.wait_for_function("SC.on && SY.st==='ok'", timeout=15000)
            check('[wrangler] B took A data', B.evaluate("S.expenses.length") == 1)
            add_expense(B, 'Xe máy', '300000', payer='Gừ')
            add_expense(A, 'Nước dừa', '60000')
            for _ in range(3):
                wait_sync(A); wait_sync(B)
            check('[wrangler] converged', A.evaluate("payloadStr()") == B.evaluate("payloadStr()") and A.evaluate("S.expenses.length") == 3)
        run('two phones', t_two_phones)

        def t_conflict():
            s, cur = api('GET', '/slot/caguman')
            s1, r1 = api('PUT', '/slot/caguman', {'base': cur['rev'], 'data': cur['data']})
            s2, r2 = api('PUT', '/slot/caguman', {'base': cur['rev'], 'data': cur['data']})
            check('[wrangler] second save with old base gets 409 + newer copy', s1 == 200 and s2 == 409 and r2.get('rev') == r1['rev'], (s1, s2))
            s, r = api('GET', f"/slot/caguman?since={r1['rev']}")
            check('[wrangler] unchanged read is cheap', r.get('same') is True)
        run('conflict', t_conflict)

        def t_large():
            A.evaluate("""commit(()=>{const t=DEV.trip,m=S.members.filter(x=>x.trip===t).map(x=>x.id);
              for(let i=0;i<12000;i++)S.expenses.push({id:'big'+i,trip:t,desc:'Khoản số '+i+' với chút mô tả',amount:1000+i,payer:m[i%m.length],split:m,date:todayKey(),at:Date.now()+i,u:0})})""")
            wait_sync(A, 90000); wait_sync(B, 90000)
            check('[wrangler] 12,000 records through D1 in pieces', B.evaluate("S.expenses.length") == 12003)
        run('large', t_large)

        def t_lockout():
            codes = [api('GET', '/ping', pin='0000')[0] for _ in range(5)]
            s, r = api('GET', '/ping', pin='2468')
            check('[wrangler] 5 wrong PINs -> pause, even for the right PIN', codes[:4] == [401] * 4 and codes[4] == 429 and s == 429, (codes, s))
        run('lockout', t_lockout)

        for pg, n in ((A, 'A'), (B, 'B')):
            check(f'[wrangler] no page errors on {n}', not pg.errors, pg.errors)
        b.close()
    sys.exit(0 if summary() else 1)


if __name__ == '__main__':
    main()
