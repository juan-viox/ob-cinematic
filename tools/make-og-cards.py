#!/usr/bin/env python3
"""Build the 1200x630 social share cards in site/assets/og/.

    python3 tools/make-og-cards.py

Facebook, LinkedIn, X and iMessage each crop an off-ratio image their own way,
so every card is cropped to 1.91:1 once, here, and every platform then shows
the same frame. `focus` biases the crop along whichever axis is being trimmed
(0 = top or left, 1 = bottom or right) for the shots where a centred crop cuts
the subject or the embossed logo.

Three cards come from tools/og-sources/, which holds the photographer's files
at a higher resolution than the web-sized copies under site/assets/img/.
"""
from PIL import Image, ImageFilter
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/assets/og"
W, H = 1200, 630
AR = W / H

CARDS = {
    # card name         source, relative to the repo root            focus
    "occasionsbox":    ("tools/og-sources/signature-duo.jpg",        0.28),
    "shop":            ("site/assets/img/0B0_5067-750w.jpg",         0.50),
    "custom-gifting":  ("tools/og-sources/branded-run.jpg",          0.50),
    "concierge":       ("site/assets/img/0B0_4910-750w.jpg",         0.50),
    "about":           ("tools/og-sources/in-hand.jpg",              0.62),
    "contact":         ("site/assets/img/0B0_5183-750w.jpg",         0.50),
}


def catalogue():
    """The 21 boxes, read from the same array the storefront renders from."""
    js = (ROOT / "site/assets/js/site.js").read_text()
    start = js.index("var allProducts = [")
    body = js[start:js.index("\n  ];", start)]
    rows = re.findall(r"""\{name:\s*(['"])(.+?)\1.*?img:\s*(['"])(.+?)\3""", body)
    if len(rows) < 20:
        raise SystemExit(f"only parsed {len(rows)} products from allProducts")
    return [(n, i) for _q1, n, _q2, i in rows]


def slugify(name):
    name = name.replace("'", "").replace("\u2019", "")
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


# Each box's own page gets its own card, so texting or pinning a single box
# shows that box rather than the shop.
for product_name, img in catalogue():
    CARDS[f"products/{slugify(product_name)}"] = (f"site{img}", 0.50)

OUT.mkdir(parents=True, exist_ok=True)
for name, (src, focus) in CARDS.items():
    im = Image.open(ROOT / src).convert("RGB")
    w, h = im.size
    if w / h > AR:                       # too wide: trim the sides
        nw = round(h * AR)
        x = round((w - nw) * focus)
        im = im.crop((x, 0, x + nw, h))
    else:                                # too tall: trim top and bottom
        nh = round(w / AR)
        y = round((h - nh) * focus)
        im = im.crop((0, y, w, y + nh))
    upscale = W / im.width
    im = im.resize((W, H), Image.LANCZOS)
    if upscale > 1.05:
        # Only the 750px-wide web copies need this; it puts back the edge the
        # enlargement softens, and at feed size the enlargement is invisible.
        im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=3))
    path = OUT / f"{name}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=84, optimize=True, progressive=True)
    print(f"{path.relative_to(ROOT)}  <- {src}  ({w}x{h}, x{upscale:.2f})  "
          f"{path.stat().st_size // 1024} KB")
