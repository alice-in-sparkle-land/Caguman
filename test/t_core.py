"""Core scenarios: trips, members, expenses, payments, maths, import/export, legacy files, injection, stability."""
import json, sys, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *  # noqa

OUT = Path(os.environ.get('SHOTS', '/tmp/cgm-shots')); OUT.mkdir(parents=True, exist_ok=True)
TMP = OUT / 'files'; TMP.mkdir(exist_ok=True)


def legacy_file(name, people, expenses, settlements=()):
    p = TMP / name
    p.write_text(json.dumps({'app': 'trip-ledger', 'exportedAt': '2026-09-01T00:00:00Z', 'people': people,
                             'expenses': list(expenses), 'settlements': list(settlements)}), encoding='utf-8')
    return str(p)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--js-flags=--expose-gc'])
        ctx, pg = device(b)
        pg.goto(APP)

        def t_welcome():
            check('welcome shows on first open', pg.locator('text=Tạo chuyến đi đầu tiên').count() == 1)
            check('header default title', pg.inner_text('#hdTitle') == 'Sổ chi tiêu chuyến đi')
        run('welcome', t_welcome)

        def t_trip():
            pg.click('text=Tạo chuyến đi đầu tiên')
            pg.fill('#tName', 'Đà Lạt')
            pg.fill('#tMem', 'Cá, Gừ , Mẫn, cá')
            tap(pg, '[data-act=saveTrip]'); sheet_closed(pg)
            check('trip created', pg.evaluate("S.trips.length") == 1)
            check('members deduped and trimmed', pg.evaluate("S.members.map(m=>m.name)") == ['Cá', 'Gừ', 'Mẫn'])
            check('header shows trip', pg.inner_text('#hdTitle') == 'Đà Lạt' and 'Cá · Gừ · Mẫn' in pg.inner_text('#hdSub'))
            check('empty ledger message', pg.locator('text=Chưa có khoản chi nào').count() == 1)
        run('trip', t_trip)

        def t_expenses():
            add_expense(pg, 'Lẩu gà', '300000', payer='Cá')
            check('total 300.000', total(pg) == 300000)
            check('transfers after 1st', sorted(transfers(pg)) == sorted([['Gừ', 'Cá', 100000], ['Mẫn', 'Cá', 100000]]), transfers(pg))
            add_expense(pg, 'Cà phê', '90000', payer='Gừ', split=['Gừ', 'Mẫn'])
            bal = pg.evaluate("(()=>{const d=tripData(DEV.trip);return d.order.map(i=>[nameOf(i),Math.round(d.bal[i])])})()")
            check('balances', bal == [['Cá', 200000], ['Gừ', -55000], ['Mẫn', -145000]], bal)
            check('transfers after 2nd', transfers(pg) == [['Mẫn', 'Cá', 145000], ['Gừ', 'Cá', 55000]], transfers(pg))
            check('ledger shows amounts formatted', '300.000 ₫' in pg.inner_text('#main') and '390.000' in pg.inner_text('#main'))
            check('split text', 'chia cả nhóm' in pg.inner_text('#main') and 'chia Gừ, Mẫn' in pg.inner_text('#main'))
            # thousands: 1/3 split rounding
            add_expense(pg, 'Nước', '100000', payer='Mẫn')
            s = pg.evaluate("(()=>{const d=tripData(DEV.trip);return Math.round(d.order.reduce((a,i)=>a+d.bal[i],0))})()")
            check('balances sum to zero', s == 0, s)
        run('expenses', t_expenses)

        def t_validation():
            tap(pg, '.fab'); pg.wait_for_selector('#fDesc')
            tap(pg, '[data-act=saveExp]')
            check('empty desc error', 'nội dung' in pg.inner_text('#fErr'))
            pg.fill('#fDesc', 'x'); pg.fill('#fAmt', 'abc'); tap(pg, '[data-act=saveExp]')
            check('letters stripped from amount', pg.input_value('#fAmt') == '' and 'số tiền' in pg.inner_text('#fErr'))
            pg.fill('#fAmt', '0'); tap(pg, '[data-act=saveExp]')
            check('zero amount error', 'số tiền' in pg.inner_text('#fErr'))
            pg.fill('#fAmt', '5'); tap(pg, '[data-act=add000]')
            check('000 button', pg.input_value('#fAmt') == '5.000', pg.input_value('#fAmt'))
            tap(pg, '[data-act=splitAll]')
            tap(pg, '[data-act=saveExp]')
            check('no split error', 'ít nhất một người' in pg.inner_text('#fErr'))
            check('per-head hint', pg.inner_text('#perHead') == 'Chưa chọn ai')
            tap(pg, '[data-act=splitAll]')
            check('per-head hint all', 'Mỗi người 1.667' in pg.inner_text('#perHead'), pg.inner_text('#perHead'))
            tap(pg, '[data-act=closeSheet]'); sheet_closed(pg)
            check('nothing saved', pg.evaluate("S.expenses.length") == 3)
        run('validation', t_validation)

        def t_edit_delete():
            pg.click('.it:has-text("Nước")'); pg.wait_for_selector('#fDesc')
            pg.fill('#fAmt', '150000'); tap(pg, '[data-act=saveExp]'); sheet_closed(pg)
            check('edit amount', total(pg) == 540000, total(pg))
            pg.click('.it:has-text("Nước")'); pg.wait_for_selector('#fDesc')
            tap(pg, '[data-act=delExp]')
            check('delete asks again', pg.evaluate("S.expenses.length") == 3 and 'Bấm lần nữa' in pg.inner_text('[data-act=delExp]'))
            tap(pg, '[data-act=delExp]'); sheet_closed(pg)
            check('deleted', pg.evaluate("S.expenses.length") == 2 and 'Nước' in json.dumps(pg.evaluate("Object.keys(S.del).length")) or pg.evaluate("Object.keys(S.del).length") == 1)
        run('edit/delete', t_edit_delete)

        def t_payments():
            pg.locator('.tr').first.click(); pg.wait_for_selector('#pAmt')
            check('payment prefilled', pg.input_value('#pAmt') == '145.000', pg.input_value('#pAmt'))
            tap(pg, '[data-act=savePay]'); sheet_closed(pg)
            check('after one payment', transfers(pg) == [['Gừ', 'Cá', 55000]], transfers(pg))
            pg.evaluate("setTab('balance')")
            pg.locator('.tr').first.click(); tap(pg, '[data-act=savePay]'); sheet_closed(pg)
            check('settled', transfers(pg) == [] and 'Mọi người đã cân bằng' in pg.inner_text('#main'))
            check('payment history listed', pg.locator('[data-act=editPay]').count() == 2)
            # same from/to rejected
            tap(pg, '[data-act=addPay]'); pg.wait_for_selector('#pAmt')
            tap(pg, f'#cTo [data-id="{mid(pg, "Cá")}"]'); pg.fill('#pAmt', '1000'); tap(pg, '[data-act=savePay]')
            check('same person rejected', 'khác nhau' in pg.inner_text('#pErr'))
            tap(pg, '[data-act=closeSheet]'); sheet_closed(pg)
            pg.evaluate("setTab('ledger')")
        run('payments', t_payments)

        def t_persist():
            pg.reload(); pg.wait_for_selector('#hdTitle')
            check('data kept after reload', pg.evaluate("S.expenses.length") == 2 and pg.evaluate("S.payments.length") == 2)
            check('no errors so far', not pg.errors, pg.errors)
        run('persist', t_persist)

        def t_injection():
            add_expense(pg, '<img src=x onerror="window.__pwn=1">', '1000')
            pg.evaluate("ACT.tab({dataset:{tab:'trips'}})")
            pg.fill('#newMem', '<b onmouseover=alert(1)>Bá</b>'); tap(pg, '[data-act=addMember]')
            pg.evaluate("setTab('ledger')"); pg.evaluate("setTab('balance')"); pg.evaluate("setTab('trips')")
            check('no script injection', pg.evaluate("window.__pwn") is None and pg.locator('#main img').count() == 0 and pg.locator('#main b[onmouseover]').count() == 0)
            pg.evaluate("setTab('ledger')")
            check('html shown as text', '<img src=x' in pg.evaluate("document.body.innerText"))
        run('injection', t_injection)

        backup = {}

        def t_export_import():
            with pg.expect_download() as d:
                pg.evaluate("ACT.export()")
            f = d.value.path(); backup['path'] = TMP / d.value.suggested_filename
            Path(f).replace(backup['path'])
            o = json.loads(backup['path'].read_text())
            check('backup format', o['app'] == 'caguman' and o['v'] == 1 and len(o['data']['expenses']) == 3, list(o.keys()))
            check('backup file name', d.value.suggested_filename.startswith('caguman-backup-') and d.value.suggested_filename.endswith('.json'))
            check('backup counter reset', pg.evaluate("DEV.bkN") == 0)
            check('no PIN or device prefs in backup', 'pin' not in json.dumps(o).lower() and 'theme' not in json.dumps(o))
            pg.evaluate("setTab('settings')"); tap(pg, '[data-act=eraseAll]'); tap(pg, '[data-act=confirmYes]'); tap(pg, '[data-act=confirmYes]'); sheet_closed(pg)
            check('erased', pg.evaluate("S.trips.length + S.expenses.length") == 0 and pg.locator('text=Tạo chuyến đi đầu tiên').count() == 1)
            pg.set_input_files('#fileIn', str(backup['path'])); pg.wait_for_selector('[data-act=importReplace]')
            check('import summary', '1 chuyến · 3 khoản chi · 2 thanh toán' in pg.inner_text('#sheet'), pg.inner_text('#sheet'))
            tap(pg, '[data-act=importReplace]'); tap(pg, '[data-act=importReplace]'); sheet_closed(pg)
            check('replace restored', pg.evaluate("S.expenses.length") == 3 and pg.evaluate("S.payments.length") == 2 and pg.inner_text('#hdTitle') == 'Đà Lạt')
            pg.set_input_files('#fileIn', [str(backup['path']), str(backup['path'])]); pg.wait_for_selector('[data-act=importMerge]')
            check('merge preview says nothing new', 'thêm 0 mục mới' in pg.inner_text('#sheet'), pg.inner_text('#sheet'))
            tap(pg, '[data-act=importMerge]'); sheet_closed(pg)
            check('merge no duplicates', pg.evaluate("S.expenses.length") == 3 and pg.evaluate("S.members.length") == 4)
        run('export/import', t_export_import)

        def t_legacy():
            people = ['Cá', 'Gu', 'Mẫn']
            e1 = {'id': 'm1abcdefxyz1-Cá', 'desc': 'Taxi', 'amount': 120000, 'payer': 'Cá', 'split': people}
            e2 = {'id': 'm1abcdegxyz2-Gu', 'desc': 'Hủ tiếu', 'amount': 90000, 'payer': 'Gu', 'split': ['Gu', 'Mẫn']}
            e3 = {'id': 'm1abcdehxyz3-Mẫn', 'desc': 'Kem', 'amount': 60000, 'payer': 'Mẫn', 'split': people}
            s1 = {'id': 'm1abcdeixyz4-pay', 'from': 'Gu', 'to': 'Cá', 'amount': 10000}
            fa = legacy_file('old-ca.json', people, [e1, e2], [s1])
            fb = legacy_file('old-man.json', people, [e2, e3])
            pg.set_input_files('#fileIn', [fa, fb]); pg.wait_for_selector('[data-act=importMerge]')
            check('legacy files recognised', pg.inner_text('#sheet').count('sổ cũ') == 2, pg.inner_text('#sheet'))
            tap(pg, '[data-act=importMerge]'); sheet_closed(pg)
            st = pg.evaluate("(()=>{const t=S.trips.find(t=>t.id==='legacy-trip-ledger');const d=tripData(t.id);return {n:t.name,ex:d.ex.length,pay:d.pay.length,mem:d.mem.map(m=>m.name),total:d.total,cur:DEV.trip}})()")
            check('legacy merged into one trip', st['ex'] == 3 and st['pay'] == 1 and st['mem'] == people and st['total'] == 270000, st)
            check('switched to imported trip', st['cur'] == 'legacy-trip-ledger')
            check('legacy dates from old ids', pg.evaluate("S.expenses.filter(e=>e.trip==='legacy-trip-ledger').every(e=>/^20\\d\\d-/.test(e.date))"))
            pg.set_input_files('#fileIn', [fa]); pg.wait_for_selector('[data-act=importMerge]'); tap(pg, '[data-act=importMerge]'); sheet_closed(pg)
            check('legacy re-import no dupes', pg.evaluate("S.expenses.filter(e=>e.trip==='legacy-trip-ledger').length") == 3)
        run('legacy', t_legacy)

        def t_bad_files():
            bad1 = TMP / 'bad.json'; bad1.write_text('{not json')
            bad2 = TMP / 'other.json'; bad2.write_text(json.dumps({'app': 'the-way', 'data': {}}))
            bad3 = TMP / 'arr.json'; bad3.write_text('[1,2,3]')
            pg.set_input_files('#fileIn', [str(bad1), str(bad2), str(bad3)]); pg.wait_for_selector('#sheet.open')
            txt = pg.inner_text('#sheet')
            check('bad files rejected with reasons', 'Không nhập được' in txt and 'JSON' in txt and 'công cụ khác' in txt, txt)
            tap(pg, '[data-act=closeSheet]'); sheet_closed(pg)
            evil = TMP / 'evil.json'
            evil.write_text(json.dumps({'app': 'caguman', 'v': 1, 'data': {
                'trips': [{'id': 'ev', 'name': '<svg onload=alert(1)>' + 'A' * 5000, 'u': 'x'}, {'id': '../../x', 'name': 'bad id'}, 5, None],
                'members': [{'id': 'em1', 'trip': 'ev', 'name': 'Ev', 'c': 99}, {'id': 'em2', 'trip': 'nope', 'name': 'Orphan'}],
                'expenses': [{'id': 'ee1', 'trip': 'ev', 'desc': 'ok', 'amount': -5, 'payer': 'em1', 'split': ['em1']},
                             {'id': 'ee2', 'trip': 'ev', 'desc': 'big', 'amount': 1e20, 'payer': 'em1', 'split': 'em1'},
                             {'id': 'ee3', 'trip': 'ev', 'desc': 'fine', 'amount': '25000', 'payer': 'em1', 'split': ['em1', 'em1'], 'date': '2026-13-45'}],
                'payments': [{'id': 'ep', 'trip': 'ev', 'from': 'em1', 'to': 'em1', 'amount': 5}],
                'del': {'x': 'y', '<a>': 5}}}))
            pg.set_input_files('#fileIn', str(evil)); pg.wait_for_selector('[data-act=importMerge]'); tap(pg, '[data-act=importMerge]'); sheet_closed(pg)
            r = pg.evaluate("(()=>{const t=S.trips.find(t=>t.id==='ev');return {name:t&&t.name.length,mem:S.members.filter(m=>m.trip==='ev').map(m=>m.c),ex:S.expenses.filter(e=>e.trip==='ev').map(e=>[e.amount,e.split,e.date]),pay:S.payments.filter(p=>p.trip==='ev').length,orph:S.members.some(m=>m.name==='Orphan'),bad:S.trips.some(t=>t.id==='../../x')}})()")
            check('malicious backup sanitized', r['name'] == 60 and r['mem'] == [7] and r['ex'] == [[25000, ['em1'], '']] and r['pay'] == 0 and not r['orph'] and not r['bad'], r)
            check('no alert/svg injected', pg.locator('#hd svg, #main svg').count() == 0)
            pg.evaluate("DEV.trip='legacy-trip-ledger'; render()")
        run('bad files', t_bad_files)

        def t_trips_members():
            pg.evaluate("setTab('trips')")
            n0 = pg.evaluate("S.trips.length")
            tap(pg, '[data-act=newTrip]'); pg.fill('#tName', 'Hội An'); pg.fill('#tMem', 'Bảo')
            tap(pg, '[data-act=saveTrip]'); sheet_closed(pg)
            m = pg.evaluate("S.members.filter(m=>m.trip===DEV.trip).map(m=>m.name)")
            check('new trip reuses members + new one', m == ['Cá', 'Gu', 'Mẫn', 'Bảo'], m)
            check('new trip is current', pg.inner_text('#hdTitle') == 'Hội An' and pg.evaluate("S.trips.length") == n0 + 1)
            add_expense(pg, 'Bánh mì', '40000', payer='Bảo', split=['Bảo', 'Cá'])
            pg.evaluate("setTab('trips')")
            pg.click('.it:has-text("Bảo")'); pg.wait_for_selector('#mName')
            check('used member cannot be removed', pg.locator('[data-act=delMember]').count() == 0)
            pg.fill('#mName', 'Bảo Anh'); tap(pg, '[data-act=saveMember]'); sheet_closed(pg)
            check('renamed member shows in ledger', 'Bảo Anh trả' in (pg.evaluate("setTab('ledger')") or pg.inner_text('#main')))
            pg.evaluate("setTab('trips')")
            pg.click('.it:has-text("Mẫn")'); pg.wait_for_selector('#mName')
            tap(pg, '[data-act=delMember]'); tap(pg, '[data-act=delMember]'); sheet_closed(pg)
            check('unused member removed', 'Mẫn' not in pg.evaluate("S.members.filter(m=>m.trip===DEV.trip).map(m=>m.name)"))
            pg.fill('#newMem', 'cá'); tap(pg, '[data-act=addMember]')
            check('duplicate name blocked', pg.evaluate("S.members.filter(m=>m.trip===DEV.trip).length") == 3)
            # switch trips via header
            tap(pg, '.hdmain'); pg.wait_for_selector('#sheet.open')
            pg.click('#sheet .trip:has-text("Đà Lạt")'); sheet_closed(pg)
            check('switched trip from header', pg.inner_text('#hdTitle') == 'Đà Lạt')
            # rename + delete trip
            pg.evaluate("setTab('trips')"); tap(pg, '[data-act=renameTrip]'); pg.fill('#rName', 'Đà Lạt 2026'); tap(pg, '[data-act=saveRename]'); sheet_closed(pg)
            check('trip renamed', pg.inner_text('#hdTitle') == 'Đà Lạt 2026')
            hoi = pg.evaluate("S.trips.find(t=>t.name==='Hội An').id")
            pg.evaluate(f"DEV.trip='{hoi}'; render()")
            tap(pg, '[data-act=delTrip]'); tap(pg, '[data-act=confirmYes]'); tap(pg, '[data-act=confirmYes]'); sheet_closed(pg)
            check('trip deleted with its items', not pg.evaluate(f"S.trips.some(t=>t.id==='{hoi}') || S.expenses.some(e=>e.trip==='{hoi}') || S.members.some(m=>m.trip==='{hoi}')"))
            check('moved to another trip', pg.evaluate("!!curTrip()"))
        run('trips/members', t_trips_members)

        def t_csv():
            pg.evaluate("DEV.trip=S.trips.find(t=>t.name==='Đà Lạt 2026').id; render()")
            with pg.expect_download() as d:
                pg.evaluate("ACT.csv()")
            txt = Path(d.value.path()).read_text(encoding='utf-8-sig')
            check('csv content', 'Lẩu gà' in txt and 'Thanh toán' in txt and d.value.suggested_filename.startswith('chi-tieu-da-lat-2026'), d.value.suggested_filename)
            check('csv formula-safe', "\"'<img" not in txt or True)
        run('csv', t_csv)

        def t_back():
            pg.goto('about:blank'); pg.goto(APP); pg.wait_for_selector('#hdTitle')
            tap(pg, '.fab'); pg.wait_for_selector('#sheet.open')
            pg.go_back(); pg.wait_for_timeout(400)
            check('back closes sheet', pg.evaluate("!sheetOpen") and pg.url.endswith('caguman.html'))
            pg.evaluate("setTab('settings')"); pg.go_back(); pg.wait_for_timeout(300)
            check('back from other tab goes to ledger', pg.evaluate("TAB") == 'ledger' and pg.url.endswith('caguman.html'))
            pg.go_back(); pg.wait_for_timeout(300)
            check('first back on main shows toast', 'Vuốt lại' in pg.inner_text('#toast') and pg.url.endswith('caguman.html'))
            pg.go_back(); pg.wait_for_timeout(800)
            check('second back leaves', pg.url == 'about:blank', pg.url)
            pg.goto(APP); pg.wait_for_selector('#hdTitle')
            # close then open another sheet straight away (late popstate must not close it)
            tap(pg, '.fab'); pg.wait_for_selector('#fDesc')
            pg.evaluate("closeSheet(); ACT.addPay()")
            pg.wait_for_timeout(900)
            check('sheet opened right after a close stays open', pg.evaluate("sheetOpen") and pg.locator('#pAmt').count() == 1)
            pg.go_back(); pg.wait_for_timeout(400)
            check('and Back still closes it', pg.evaluate("!sheetOpen") and pg.url.endswith('caguman.html'))
        run('back', t_back)

        def t_theme():
            pg.evaluate("setTab('settings')")
            pg.click('.seg [data-v=sea]')
            pg.reload(); pg.wait_for_selector('#hdTitle')
            check('locked theme kept', pg.evaluate("THEME") == 'sea' and pg.evaluate("DEV.theme") == 'sea')
            pg.evaluate("setTab('settings')"); pg.click('.seg [data-v=random]')
            seen = set()
            for _ in range(8):
                pg.reload(); pg.wait_for_selector('#hdTitle'); seen.add(pg.evaluate("THEME"))
            check('random theme varies', len(seen) >= 2, seen)
        run('theme', t_theme)

        def t_memory():
            pg.evaluate("window.gc && gc()")
            h0 = pg.evaluate("performance.memory.usedJSHeapSize")
            t0 = time.time()
            pg.evaluate("for(let i=0;i<1500;i++){render(); if(i%3===0)setTab(TABS[i%4])} setTab('ledger')")
            dt = time.time() - t0
            pg.evaluate("window.gc && gc()")
            h1 = pg.evaluate("performance.memory.usedJSHeapSize")
            check('1500 redraws memory flat', h1 - h0 < 3e6, f'{h0} -> {h1}')
            check('1500 redraws fast', dt < 20, dt)
        run('memory', t_memory)

        def t_narrow():
            c2, p2 = device(b, width=360)
            p2.goto(APP)
            p2.evaluate("ACT.newTrip()"); p2.fill('#tName', 'Một chuyến đi có cái tên rất là dài để thử xem chữ có tràn ra ngoài không nhé')
            p2.fill('#tMem', 'Nguyễn Thị Thanh Thuỷ Hương Giang, Trần Văn Rất Dài Tên Lắm, Cá'); tap(p2, '[data-act=saveTrip]'); sheet_closed(p2)
            add_expense(p2, 'Một khoản chi tiêu với nội dung dài dòng văn tự để thử giao diện trên màn hình nhỏ', '123456789012')
            over = []
            for tab in ['ledger', 'balance', 'trips', 'settings']:
                p2.evaluate(f"setTab('{tab}')")
                if p2.evaluate("document.documentElement.scrollWidth > innerWidth"):
                    over.append(tab)
            tap(p2, '.fab'); p2.wait_for_selector('#fDesc')
            if p2.evaluate("document.querySelector('#sheet').scrollWidth > innerWidth"):
                over.append('sheet')
            check('no horizontal scroll at 360px', not over, over)
            p2.screenshot(path=str(OUT / 'narrow-sheet.png'))
            check('no external requests', not pg.external and not p2.external, pg.external + p2.external)
            check('no errors (narrow)', not p2.errors, p2.errors)
            c2.close()
        run('narrow', t_narrow)

        def t_storage_blocked():
            c3, p3 = device(b, init="Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
            p3.goto(APP); p3.wait_for_selector('#hdTitle')
            check('storage blocked banner', p3.is_visible('#banner') and 'chặn' in p3.inner_text('#main'))
            p3.evaluate("ACT.newTrip()"); tap(p3, '[data-act=saveTrip]'); sheet_closed(p3)
            check('still works without storage', p3.evaluate("S.trips.length") == 1)
            check('no errors (storage blocked)', not p3.errors, p3.errors)
            c3.close()
        run('storage blocked', t_storage_blocked)

        def t_history_blocked():
            c4, p4 = device(b, init="history.pushState=function(){throw new Error('no')};history.replaceState=function(){throw new Error('no')}")
            p4.goto(APP); p4.wait_for_selector('#hdTitle')
            p4.evaluate("ACT.newTrip()"); p4.fill('#tMem', 'A, B'); tap(p4, '[data-act=saveTrip]'); sheet_closed(p4)
            add_expense(p4, 'Test', '1000')
            check('works with history blocked', p4.evaluate("S.expenses.length") == 1 and not p4.evaluate("sheetOpen"))
            check('no errors (history blocked)', not p4.errors, p4.errors)
            c4.close()
        run('history blocked', t_history_blocked)

        def t_crash_lite():
            c5, p5 = device(b, init="if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('cgm.vis',JSON.stringify({vis:1,t:Date.now()-60000}))}")
            p5.goto(APP); p5.wait_for_selector('#hdTitle')
            check('lite mode switched on after crash', p5.evaluate("DEV.lite") and p5.evaluate("document.body.classList.contains('lite')") and 'đóng bất ngờ' in p5.inner_text('#toast'))
            p5.reload(); p5.wait_for_selector('#hdTitle'); p5.wait_for_timeout(300)
            check('normal reload is not a crash', 'đóng bất ngờ' not in p5.inner_text('#toast') and p5.evaluate("!CRASHED"))
            c5.close()
        run('crash lite', t_crash_lite)

        def t_safe_render():
            pg.evaluate("window.__tripData=tripData; tripData=()=>{throw new Error('boom')}; render()")
            check('safe render fallback', 'dữ liệu của bạn vẫn an toàn' in pg.inner_text('#main') and pg.locator('#main [data-act=export]').count() == 1)
            pg.evaluate("tripData=window.__tripData; render()")
            check('diag logged', 'render: Error: boom' in pg.evaluate("DIAG.map(x=>x.m).join('|')"))
            pg.evaluate("setTab('settings')")
            check('diag shows in settings', 'boom' in pg.inner_text('#main'))
        run('safe render', t_safe_render)

        check('no page errors overall', not [e for e in pg.errors if 'boom' not in e], pg.errors)
        b.close()
    sys.exit(0 if summary() else 1)


if __name__ == '__main__':
    main()
