"""Offline opening via the service worker + screenshots of every theme at every time of day."""
import json, sys, os, datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *  # noqa

OUT = Path(os.environ.get('SHOTS', '/tmp/cgm-shots')); OUT.mkdir(parents=True, exist_ok=True)
SEED = """(()=>{const now=Date.now(),day=k=>keyOf(new Date(now-k*864e5));
const t={id:'t1',name:'Đà Lạt · tháng 10',at:now,u:1};
const m=[['m1','Cá',0],['m2','Gừ',1],['m3','Mẫn',2]].map(([id,name,c])=>({id,trip:'t1',name,c,u:1}));
const all=['m1','m2','m3'];
const e=[['e1','Lẩu gà lá é',540000,'m3',all,0],['e2','Taxi sân bay',180000,'m1',all,0],['e3','Cà phê Túi Mơ To',95000,'m2',['m2','m3'],0],['e4','Vé đồi chè',150000,'m3',all,1],['e5','Bánh căn',60000,'m1',all,1]]
 .map(([id,desc,amount,payer,split,d],i)=>({id,trip:'t1',desc,amount,payer,split,date:day(d),at:now-i*1000,u:1}));
localStorage.setItem('cgm.v1',JSON.stringify({trips:[t],members:m,expenses:e,payments:[],del:{}}));})()"""
PHASE_HOURS = {'dawn': 6, 'day': 11, 'dusk': 17, 'night': 21}


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        def t_offline_reload():
            knob(reset=1, down=0, delay=0)
            ctx, pg = device(b)
            pg.goto(APP); pg.wait_for_selector('#hdTitle')
            pg.evaluate("navigator.serviceWorker.ready.then(() => 1)")
            pg.reload(); pg.wait_for_selector('#hdTitle')
            pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=10000)
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector('#hdTitle', timeout=8000)
            check('opens offline after the first visit', pg.inner_text('#hdTitle') == 'Sổ chi tiêu chuyến đi')
            ctx.set_offline(False); ctx.close()
        run('offline reload', t_offline_reload)

        def t_shots():
            ctx, pg = device(b)
            pg.goto(APP); pg.evaluate(SEED)
            files = []
            for theme in ['earth', 'forest', 'sea', 'wind']:
                for ph, h in PHASE_HOURS.items():
                    pg.clock.set_fixed_time(datetime.datetime(2026, 10, 14, h, 10))
                    pg.evaluate(f"localStorage.setItem('cgm.dev',JSON.stringify({{theme:'{theme}'}}))")
                    pg.reload(); pg.wait_for_selector('#hdTitle'); pg.wait_for_timeout(150)
                    f = OUT / f'shot-{theme}-{ph}.png'; pg.screenshot(path=str(f)); files.append(f)
            for tab in ['balance', 'trips', 'settings']:
                pg.evaluate(f"setTab('{tab}')"); pg.wait_for_timeout(100)
                pg.screenshot(path=str(OUT / f'tab-{tab}.png'), full_page=True)
            pg.evaluate("setTab('ledger')"); pg.click('.fab'); pg.wait_for_timeout(400)
            pg.screenshot(path=str(OUT / 'sheet-expense.png'))
            check('no errors in screenshot run', not pg.errors, pg.errors)
            from PIL import Image
            ims = [Image.open(f) for f in files]
            w, h = ims[0].width // 2, 560
            sheet = Image.new('RGB', (w * 4 + 30, h * 4 + 30), '#ccc')
            for i, im in enumerate(ims):
                t, ph = divmod(i, 4)
                sheet.paste(im.resize((w, ims[0].height // 2)).crop((0, 0, w, h)), (ph * (w + 10), t * (h + 10)))
            sheet.save(OUT / 'themes-x-times.png')
            ctx.close()
        run('screenshots', t_shots)
        b.close()
    sys.exit(0 if summary() else 1)


if __name__ == '__main__':
    main()
