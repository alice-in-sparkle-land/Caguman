"""Sync scenarios with two or three phones against the test server (real worker.js, fake D1)."""
import json, sys, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *  # noqa

TMP = Path(os.environ.get('SHOTS', '/tmp/cgm-shots')) / 'files'; TMP.mkdir(parents=True, exist_ok=True)


def payload(pg):
    return pg.evaluate("payloadStr()")


def converge(*pgs):
    for _ in range(3):
        for pg in pgs:
            wait_sync(pg)
    return len({payload(pg) for pg in pgs}) == 1


def main():
    knob(reset=1, delay=0, down=0, pin='2468')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ca, A = device(b, ip='10.0.0.1'); A.goto(APP)
        cb, B = device(b, ip='10.0.0.2'); B.goto(APP)

        def t_first_connect():
            create_trip(A, 'Đà Lạt', 'Cá, Gừ, Mẫn')
            add_expense(A, 'Lẩu gà', '300000')
            connect(A); A.wait_for_function("SC.on && SY.st==='ok'", timeout=10000)
            check('A pushed to empty cloud', slot()['rev'] >= 1 and 'Lẩu gà' in slot()['data'])
            check('green dot', A.evaluate("document.getElementById('sdot').className").endswith('s-ok'))
            connect(B); B.wait_for_function("SC.on && SY.st==='ok'", timeout=10000)
            check('B (empty) took cloud copy silently', B.evaluate("S.expenses.length") == 1 and B.inner_text('#hdTitle') == 'Đà Lạt' and not B.evaluate("sheetOpen"))
            check('payloads equal', payload(A) == payload(B))
        run('first connect', t_first_connect)

        def t_both_edit():
            add_expense(B, 'Taxi', '120000', payer='Gừ')
            add_expense(A, 'Cà phê', '60000', payer='Mẫn')
            check('different adds converge', converge(A, B) and A.evaluate("S.expenses.length") == 3)
            check('adding from Settings jumps to ledger', B.evaluate("TAB") == 'ledger')
            check('B renders A change', 'Cà phê' in B.inner_text('#main'))
            # same item edited on both: later edit wins
            eid = A.evaluate("S.expenses.find(e=>e.desc==='Taxi').id")
            A.evaluate(f"commit(()=>{{S.expenses.find(e=>e.id==='{eid}').amount=111000}})")
            time.sleep(0.05)
            B.evaluate(f"commit(()=>{{S.expenses.find(e=>e.id==='{eid}').amount=222000}})")
            converge(A, B)
            check('later edit wins on both', A.evaluate(f"S.expenses.find(e=>e.id==='{eid}').amount") == 222000 and B.evaluate(f"S.expenses.find(e=>e.id==='{eid}').amount") == 222000)
            # delete on A, then later edit on B -> edit wins (item comes back); delete after edit -> gone
            A.evaluate(f"commit(()=>{{S.expenses=S.expenses.filter(e=>e.id!=='{eid}')}})"); time.sleep(0.05)
            B.evaluate(f"commit(()=>{{S.expenses.find(e=>e.id==='{eid}').desc='Taxi sân bay'}})")
            converge(A, B)
            check('edit after delete keeps item', A.evaluate(f"(S.expenses.find(e=>e.id==='{eid}')||{{}}).desc") == 'Taxi sân bay')
            B.evaluate(f"commit(()=>{{S.expenses=S.expenses.filter(e=>e.id!=='{eid}')}})")
            converge(A, B)
            check('delete spreads', not A.evaluate(f"S.expenses.some(e=>e.id==='{eid}')") and not B.evaluate(f"S.expenses.some(e=>e.id==='{eid}')"))
        run('both edit', t_both_edit)

        def t_same_moment():
            knob(delay=600)
            add_expense(A, 'A cùng lúc', '10000'); add_expense(B, 'B cùng lúc', '20000')
            A.evaluate("syncNow(true)"); B.evaluate("syncNow(true)")
            A.wait_for_function("!SY.busy", timeout=15000); B.wait_for_function("!SY.busy", timeout=15000)
            knob(delay=0)
            ok = converge(A, B)
            check('two devices saving at the same moment converge', ok and A.evaluate("S.expenses.filter(e=>e.desc.includes('cùng lúc')).length") == 2)
        run('same moment', t_same_moment)

        def t_change_during_slow_save():
            knob(delay=1500)
            add_expense(A, 'Trước', '1000')
            A.evaluate("syncNow(true)"); A.wait_for_timeout(300)
            A.evaluate("commit(()=>S.expenses.push({id:newId(),trip:DEV.trip,desc:'Trong lúc lưu',amount:2000,payer:S.members[0].id,split:[S.members[0].id],date:todayKey(),at:Date.now(),u:0}))")
            A.wait_for_function("!SY.busy", timeout=20000)
            knob(delay=0)
            wait_sync(A)
            d = slot()['data']
            check('change made during a slow save still reaches cloud', 'Trước' in d and 'Trong lúc lưu' in d)
            converge(A, B)
        run('slow save', t_change_during_slow_save)

        def t_offline():
            knob(down=1)
            add_expense(A, 'Ngoại tuyến', '5000')
            A.evaluate("syncNow(true)"); A.wait_for_function("!SY.busy", timeout=25000)
            check('offline status (grey)', A.evaluate("SY.st") == 'offline' and 's-offline' in A.evaluate("document.getElementById('sdot').className"))
            A.reload(); A.wait_for_selector('#hdTitle')
            check('change kept on device after reload offline', 'Ngoại tuyến' in A.inner_text('#main'))
            knob(down=0)
            A.evaluate("dispatchEvent(new Event('online'))")
            A.wait_for_function("SY.st==='ok' && SY.gen===SY.clean", timeout=15000)
            check('syncs when back online', 'Ngoại tuyến' in slot()['data'])
            converge(A, B)
        run('offline', t_offline)

        def t_trip_delete_race():
            create_trip(A, 'Vũng Tàu', 'Cá, Gừ'); converge(A, B)
            tid = A.evaluate("DEV.trip")
            B.evaluate(f"DEV.trip='{tid}'; render()")
            knob(down=1)
            add_expense(B, 'Ghẹ', '200000'); B.evaluate("syncNow(true)"); B.wait_for_function("!SY.busy", timeout=25000)
            knob(down=0)
            A.evaluate("ACT.delTrip()"); A.click('[data-act=confirmYes]'); A.click('[data-act=confirmYes]'); sheet_closed(A)
            wait_sync(A); converge(B, A)
            check('deleted trip stays deleted, no orphans', not B.evaluate(f"S.trips.some(t=>t.id==='{tid}')") and not B.evaluate(f"S.expenses.some(e=>e.trip==='{tid}')") and B.evaluate("!!curTrip()"))
        run('trip delete race', t_trip_delete_race)

        def t_third_device_merge():
            cc, C = device(b, ip='10.0.0.3'); C.goto(APP)
            create_trip(C, 'Phú Quốc', 'Mẫn, Bin'); add_expense(C, 'Lặn biển', '800000')
            connect(C); C.wait_for_selector('[data-act=connectMerge]')
            check('asks Merge / Use cloud when both have data', 'Gộp cả hai' in C.inner_text('#sheet') and not C.evaluate("SC.on"))
            C.click('[data-act=connectMerge]'); C.wait_for_function("SC.on && SY.st==='ok'", timeout=10000)
            ok = converge(A, B, C)
            check('merge both: everything on every phone', ok and A.evaluate("S.trips.some(t=>t.name==='Phú Quốc')") and C.evaluate("S.trips.some(t=>t.name==='Đà Lạt')"))
            check('device keeps its own current trip', C.inner_text('#hdTitle') == 'Phú Quốc')
            cc.close()
        run('third device', t_third_device_merge)

        def t_import_replace_spreads():
            with A.expect_download() as d:
                A.evaluate("ACT.export()")
            f = TMP / 'sync-backup.json'; Path(d.value.path()).replace(f)
            add_expense(A, 'Sau sao lưu', '7000'); converge(A, B)
            check('B has post-backup item', B.evaluate("S.expenses.some(e=>e.desc==='Sau sao lưu')"))
            A.set_input_files('#fileIn', str(f)); A.wait_for_selector('[data-act=importReplace]')
            check('replace warns about all devices', 'mọi máy' in A.inner_text('#sheet'))
            A.click('[data-act=importReplace]'); A.click('[data-act=importReplace]'); sheet_closed(A)
            converge(A, B)
            check('import Replace wins on every device', not B.evaluate("S.expenses.some(e=>e.desc==='Sau sao lưu')") and B.evaluate("S.expenses.length") == A.evaluate("S.expenses.length"))
        run('replace spreads', t_import_replace_spreads)

        def t_convergence_idle():
            converge(A, B)
            r0 = slot()['rev']
            for _ in range(3):
                wait_sync(A); wait_sync(B)
            check('no pushes when nothing changed', slot()['rev'] == r0, (r0, slot()['rev']))
        run('idle', t_convergence_idle)

        def t_flush_on_hide():
            A.evaluate("clearTimeout(SY.timer)")
            A.evaluate("stampChanges(); S.expenses.push({id:'hide1',trip:DEV.trip,desc:'Lúc ẩn',amount:3000,payer:S.members.find(m=>m.trip===DEV.trip).id,split:[S.members.find(m=>m.trip===DEV.trip).id],date:todayKey(),at:Date.now(),u:0}); save(); clearTimeout(SY.timer); flushOnHide()")
            A.wait_for_timeout(800)
            check('keepalive save on hide', 'Lúc ẩn' in slot()['data'])
            converge(A, B)
        run('flush on hide', t_flush_on_hide)

        def t_large():
            A.evaluate("""commit(()=>{const t=DEV.trip,m=S.members.filter(x=>x.trip===t).map(x=>x.id);
              for(let i=0;i<12000;i++)S.expenses.push({id:'big'+i,trip:t,desc:'Khoản số '+i+' với chút mô tả',amount:1000+i,payer:m[i%m.length],split:m,date:todayKey(),at:Date.now()+i,u:0})})""")
            wait_sync(A, 60000)
            size = len(slot()['data'])
            check('large data stored in several pieces', size > 1_000_000, size)
            wait_sync(B, 60000)
            check('B receives 12,000 records', B.evaluate("S.expenses.filter(e=>e.id.startsWith('big')).length") == 12000)
            t0 = time.time(); B.evaluate("render()"); dt = time.time() - t0
            check('render with 12,000 records < 1.5 s', dt < 1.5, dt)
            A.evaluate("commit(()=>{S.expenses=S.expenses.filter(e=>!e.id.startsWith('big'))})")
            converge(A, B)
        run('large', t_large)

        def t_pin_problems():
            knob(clearguard=1)
            cw, W = device(b, ip='10.0.0.66'); W.goto(APP)
            connect(W, '1111'); W.wait_for_function("document.getElementById('syncErr').textContent.length>0", timeout=8000)
            check('wrong PIN message with tries left', 'Còn 4 lần' in W.inner_text('#syncErr'), W.inner_text('#syncErr'))
            for _ in range(4):
                W.click('[data-act=syncConnect]'); W.wait_for_timeout(400)
            check('lockout after 5 wrong PINs', 'tạm dừng' in W.inner_text('#syncErr') or 'Nhập sai PIN' in W.inner_text('#syncErr'), W.inner_text('#syncErr'))
            check('other phones unaffected by lockout', (wait_sync(A) or True) and A.evaluate("SY.st") == 'ok')
            cw.close(); knob(clearguard=1)
            knob(pin='9999')
            A.evaluate("syncNow(true)"); A.wait_for_function("!SY.busy", timeout=8000)
            check('PIN changed on server -> red dot + retry box', A.evaluate("SY.st") == 'pin' and 's-pin' in A.evaluate("document.getElementById('sdot').className"))
            A.evaluate("setTab('settings')")
            A.fill('#spin2', '9999'); A.click('[data-act=syncPin]')
            A.wait_for_function("SY.st==='ok'", timeout=8000)
            check('new PIN fixes sync', A.evaluate("SC.pin") == '9999')
            knob(pin='2468', clearguard=1)
            A.evaluate("SC.pin='2468'; saveSC(); syncNow(true)"); B.evaluate("SY.st=''; syncNow(true)")
            A.wait_for_function("SY.st==='ok'", timeout=8000)
        run('pin problems', t_pin_problems)

        def t_foreign_corrupt():
            snap = A.evaluate("JSON.stringify(sanitizeState(S))")
            knob(foreign='caguman')
            A.evaluate("SC.rev=0; syncNow(true)"); A.wait_for_function("!SY.busy", timeout=8000)
            check('foreign cloud data refused', A.evaluate("SY.st") == 'foreign' and A.evaluate("JSON.stringify(sanitizeState(S))") == snap)
            knob(corrupt=1)
            A.evaluate("SC.rev=0; syncNow(true)"); A.wait_for_function("!SY.busy", timeout=8000)
            check('corrupt cloud data refused, local untouched', A.evaluate("SY.st") == 'bad' and A.evaluate("JSON.stringify(sanitizeState(S))") == snap)
            check('problem logged in diagnostics', 'sync: bad' in A.evaluate("DIAG.map(x=>x.m).join('|')"))
        run('foreign/corrupt', t_foreign_corrupt)

        def t_erase_spreads():
            knob(reset=1)
            A.evaluate("SC.rev=0; SC.hash=''; markDirty()"); wait_sync(A)
            B.evaluate("SC.rev=0; SC.hash=''; markDirty()"); wait_sync(B); converge(A, B)
            A.evaluate("setTab('settings')"); A.click('[data-act=eraseAll]')
            check('erase warns about all devices', 'mọi máy' in A.inner_text('#sheet'))
            A.click('[data-act=confirmYes]'); A.click('[data-act=confirmYes]'); sheet_closed(A)
            converge(A, B)
            B.evaluate("setTab('ledger')")
            check('erase all spreads', B.evaluate("S.trips.length + S.expenses.length") == 0 and B.locator('text=Tạo chuyến đi đầu tiên').count() == 1)
        run('erase spreads', t_erase_spreads)

        def t_disconnect():
            B.evaluate("setTab('settings')"); B.click('[data-act=syncOff]'); B.click('[data-act=syncOff]')
            check('disconnect keeps data, clears PIN', not B.evaluate("SC.on") and B.evaluate("SC.pin") == '' and B.locator('#spin').count() == 1)
            check('PIN never in data or backup', '"pin"' not in B.evaluate("lsGet('cgm.v1')") and '"pin"' not in A.evaluate("backupText()") and '"pin"' not in A.evaluate("payloadStr()"))
        run('disconnect', t_disconnect)

        for pg, n in ((A, 'A'), (B, 'B')):
            check(f'no page errors on {n}', not pg.errors, pg.errors)
            check(f'no external requests on {n}', not pg.external, pg.external)
        b.close()
    sys.exit(0 if summary() else 1)


if __name__ == '__main__':
    main()
