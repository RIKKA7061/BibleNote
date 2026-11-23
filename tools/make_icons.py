"""앱 아이콘(PNG)을 Eleven 우산 로고(icons/logo.svg)로 만든다.

tools/icon.html 을 헤드리스 Edge/Chrome으로 열어 크기별로 찍는다 (그림 라이브러리 필요 없음).
사용법: python tools/make_icons.py
"""
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / 'tools' / 'icon.html').as_uri()

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
]

ICONS = [
    ('icon-192.png', 192, 'any'),
    ('icon-512.png', 512, 'any'),
    ('maskable-512.png', 512, 'maskable'),
    ('favicon-32.png', 32, 'favicon'),
]


def main():
    browser = next(b for b in BROWSERS if os.path.exists(b))
    with tempfile.TemporaryDirectory() as profile:
        for name, size, kind in ICONS:
            out = ROOT / 'icons' / name
            subprocess.run([
                browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                f'--user-data-dir={profile}', '--default-background-color=00000000',
                f'--window-size={size},{size}', f'--screenshot={out}', '--virtual-time-budget=2000',
                f'{PAGE}?size={size}&kind={kind}',
            ], check=True, capture_output=True, timeout=60)
            print(name, out.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
