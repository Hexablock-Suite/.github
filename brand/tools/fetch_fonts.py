#!/usr/bin/env python3
"""Download the brand fonts as static TTF files into brand/tools/fonts/.

Usage: python3 fetch_fonts.py

textpath.py draws text as outlines, so it needs the font files.
The Google Fonts CSS API returns .ttf URLs when the user agent is not a modern browser.
The script saves Unbounded-800.ttf, Archivo-400.ttf, Archivo-500.ttf and Archivo-600.ttf.
Both families use the SIL Open Font License. The files are not committed.
Standard library only.
"""

import re
import sys
import urllib.request
from pathlib import Path

CSS_URL = ('https://fonts.googleapis.com/css2?family=Unbounded:wght@800'
           '&family=Archivo:wght@400;500;600&display=swap')
# An old user agent makes the CSS API return TrueType URLs instead of WOFF2.
USER_AGENT = 'Mozilla/4.0'
FONT_HOST = 'https://fonts.gstatic.com/'
WANTED = [('Unbounded', 800), ('Archivo', 400), ('Archivo', 500), ('Archivo', 600)]
FONT_DIR = Path(__file__).resolve().parent / 'fonts'

FACE = re.compile(r'@font-face\s*\{(.*?)\}', re.S)
FAMILY = re.compile(r"font-family:\s*'([^']+)'")
WEIGHT = re.compile(r'font-weight:\s*(\d+)')
SRC = re.compile(r"src:\s*url\(([^)]+)\)\s*format\('truetype'\)")


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def font_urls(css):
    """Map (family, weight) to the TTF URL of each @font-face block."""
    urls = {}
    for block in FACE.findall(css):
        family, weight, src = FAMILY.search(block), WEIGHT.search(block), SRC.search(block)
        if family and weight and src:
            urls[(family.group(1), int(weight.group(1)))] = src.group(1)
    return urls


def main():
    urls = font_urls(get(CSS_URL).decode('utf-8'))
    missing = [w for w in WANTED if w not in urls]
    if missing:
        raise SystemExit(f'FAIL the CSS API gave no TTF URL for {missing}')
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for family, weight in WANTED:
        url = urls[(family, weight)]
        # Download only from the Google Fonts file host.
        if not url.startswith(FONT_HOST):
            raise SystemExit(f'FAIL unexpected font host: {url}')
        data = get(url)
        # A TrueType file starts with the version 0x00010000.
        if data[:4] != b'\x00\x01\x00\x00':
            raise SystemExit(f'FAIL {url} is not a TrueType file')
        out = FONT_DIR / f'{family}-{weight}.ttf'
        out.write_bytes(data)
        print(f'{out.name}: {len(data)} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
