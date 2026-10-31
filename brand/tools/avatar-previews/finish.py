#!/usr/bin/env python3
"""Copy the Chromium renders into the repo as RGB PNG files and make the 40 px views.

Usage: python3 -I avatar-previews/finish.py [--root <dir>] <preview dir>

By default the PNG files go to brand/ of this repository.
With --root, they go to <dir>/brand/ instead.
The script needs Pillow, which requirements.txt lists.

The published avatar.png is 1024 x 1024 RGB, so every PNG here is RGB.
The script also writes two views of the avatar at 40 px to the preview dir:
a Pillow downscale and a crop of the Chromium render at 40 px.
Each view is also enlarged 8 times with nearest-neighbour, so a person can see the pixels.
"""

import argparse
from pathlib import Path

from PIL import Image

RENDERS = [
    ('avatar.png', 'avatar.png', (1024, 1024)),
    ('social-hexablock-app.png', 'social/hexablock-app.png', (1280, 640)),
    ('social-hexablock-api.png', 'social/hexablock-api.png', (1280, 640)),
]
MAX_BYTES = 1_000_000  # GitHub limit for a social preview
REPO = Path(__file__).resolve().parent.parent.parent.parent  # the repository root, above brand/tools/avatar-previews/


def main():
    parser = argparse.ArgumentParser(description='Copy the Chromium renders into brand/ as RGB PNG files.')
    parser.add_argument('--root', type=Path, default=REPO,
                        help='write to <root>/brand/ (default: this repository)')
    parser.add_argument('preview', type=Path, help='folder with the Chromium renders')
    args = parser.parse_args()
    preview, brand = args.preview, args.root / 'brand'
    for src, dst, size in RENDERS:
        img = Image.open(preview / src).convert('RGB')
        if img.size != size:
            raise SystemExit(f'FAIL {src}: size {img.size}, expected {size}')
        out = brand / dst
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, optimize=True)
        n = out.stat().st_size
        if n >= MAX_BYTES:
            raise SystemExit(f'FAIL {dst}: {n} bytes, limit {MAX_BYTES}')
        print(f'{dst}: {img.size[0]} x {img.size[1]}, {n} bytes')
    small = Image.open(brand / 'avatar.png').resize((40, 40), Image.LANCZOS)
    small.save(preview / 'avatar-40-pillow.png')
    small.resize((320, 320), Image.NEAREST).save(preview / 'avatar-40-pillow-x8.png')
    chrome = Image.open(preview / 'avatar-40.png').convert('RGB').crop((0, 0, 40, 40))
    chrome.save(preview / 'avatar-40-chromium.png')
    chrome.resize((320, 320), Image.NEAREST).save(preview / 'avatar-40-chromium-x8.png')
    print('40 px views written')


if __name__ == '__main__':
    main()
