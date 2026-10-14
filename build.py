#!/usr/bin/env python3
"""Combine src/ into one self-contained page: public/caguman.html"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'
JS_ORDER = ['data.js', 'scene.js', 'sync.js', 'app.js', 'io.js']


def build():
    shell = (SRC / 'shell.html').read_text(encoding='utf-8')
    css = (SRC / 'app.css').read_text(encoding='utf-8')
    js = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in JS_ORDER) + '\nstart();\n'
    if '</script' in js.lower() or '</style' in css.lower():
        raise SystemExit('source contains a closing tag that would break the page')
    html = shell.replace('/*CSS*/', css).replace('/*JS*/', js)
    for bad in ('fonts.googleapis', '<link rel="stylesheet"', '<script src'):
        if bad in html:
            raise SystemExit('external resource found: ' + bad)
    out = ROOT / 'public' / 'caguman.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'built {out.relative_to(ROOT)} ({len(html) // 1024} KB)')


if __name__ == '__main__':
    build()
