# Brand tools

These scripts build the HexaBlock brand assets and the two review boards.
`brand/DESIGN.md` cites them. Its generator paths are relative to this folder.
Each script prints its contrast and layout gates. A script stops when a gate fails.

## What each tool makes

| Tool | Makes | Published |
|---|---|---|
| `textpath.py` | Text as one SVG path (HarfBuzz shapes it, fontTools draws it). The other generators import it. | no |
| `profile-assets/gen.py` | `profile/assets/`: the Corte banner (dark, light), the engine figure (dark, light) and the four game cards, as SVG. With `--repo`, the README banner of `hexablock-app` or `hexablock-api` instead | yes |
| `avatar-previews/gen.py` | `brand/avatar.svg` and `brand/social/hexablock-app.svg`, `brand/social/hexablock-api.svg` | yes |
| `avatar-previews/render.sh` | PNG renders of the avatar and the previews, with snap Chromium | no (input for `finish.py`) |
| `avatar-previews/finish.py` | `brand/avatar.png` (1024 × 1024) and `brand/social/*.png` (1280 × 640) from the renders | yes |
| `ds-rombo/gen.py` | `build/rombo.html`: the second-pass review board of the Rombo direction | no |
| `ds-componentes/gen.py` | `build/componentes.html`: the components review board | no |
| `fetch_fonts.py` | `fonts/`: the static TTF files that `textpath.py` reads | no |

The two board pages are review pages, not published assets. They go to `build/`, and git ignores that folder.

## Setup

Run every command from this folder (`brand/tools/`).

1. Make a virtual environment and install the packages:

   ```sh
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

   On Debian and Ubuntu, `python3 -m venv` needs the `python3-venv` package. With `uv`, these commands do the same:

   ```sh
   uv venv --python 3.12 .venv
   uv pip install --python .venv -r requirements.txt
   ```

   The published assets were built with Python 3.12.

   `requirements.txt` lists `fonttools`, `uharfbuzz` and Pillow. Only `finish.py` uses Pillow. The tools need no other third-party package.

2. Fetch the fonts:

   ```sh
   python3 fetch_fonts.py
   ```

   The script uses the standard library only. It saves `Unbounded-800.ttf`, `Archivo-400.ttf`, `Archivo-500.ttf` and `Archivo-600.ttf` in `fonts/`. Both families come from Google Fonts under the SIL Open Font License. Git ignores `fonts/`, so the fonts are never committed.

The `.venv/` folder is also ignored.

## Rebuild the assets

Profile assets (writes `profile/assets/*.svg` in this repository):

```sh
.venv/bin/python profile-assets/gen.py
```

README banner of a repository (writes `docs/assets/banner-dark.svg` and `docs/assets/banner-light.svg` in the checkout that `--root` names). The second line holds «App» or «API» and the role from the profile table:

```sh
.venv/bin/python profile-assets/gen.py --repo hexablock-app --root ~/path/to/hexablock-app
.venv/bin/python profile-assets/gen.py --repo hexablock-api --root ~/path/to/hexablock-api
```

Avatar and social previews. Snap Chromium cannot read the system temp folder or hidden folders in your home. So the preview folder must be a visible folder in your home, outside the repository, given as an absolute path:

```sh
mkdir -p ~/hexablock-preview
.venv/bin/python avatar-previews/gen.py ~/hexablock-preview
bash avatar-previews/render.sh ~/hexablock-preview
python3 -I avatar-previews/finish.py ~/hexablock-preview
```

`gen.py` writes the SVG files to `brand/` and copies them, with an HTML wrapper each, to the preview folder. `render.sh` renders the wrappers to PNG. `finish.py` saves the renders as RGB PNG files in `brand/` and writes two 40 px views of the avatar to the preview folder. The PNG bytes can change between Chromium versions.

To write somewhere other than this repository, give `--root <dir>` to `profile-assets/gen.py`, `avatar-previews/gen.py` or `avatar-previews/finish.py`. The files then go to `<dir>/profile/assets/` or `<dir>/brand/`.

Review boards (standard library only):

```sh
python3 ds-rombo/gen.py
python3 ds-componentes/gen.py
```

Each board takes an optional output path. Without it, the page goes to `build/`.

## Check a rebuild

The generators are deterministic. With the same fonts and package versions, they give the same SVG bytes. To check, write to another root and compare:

```sh
out=$(mktemp -d)
.venv/bin/python profile-assets/gen.py --root "$out"
for f in "$out"/profile/assets/*.svg; do cmp "$f" ../../profile/assets/"$(basename "$f")"; done
```
