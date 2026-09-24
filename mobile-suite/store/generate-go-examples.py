#!/usr/bin/env python3
"""Preview five Go-background treatments for Play 512 + App Store 1024.

Does not overwrite the current production icons. Pick one, then we can
promote it into generate-icons.py.

Requires Pillow and the Saira Condensed files in store/fonts/ (OFL).
"""
from __future__ import annotations

import runpy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "examples"
FONTS = ROOT / "fonts"

g = runpy.run_path(str(ROOT / "generate-icons.py"))
NAVY = g["NAVY"]
PAPER = g["PAPER"]
SKY = g["SKY"]
AMBER = g["AMBER"]
draw_mark = g["draw_mark"]
flatten = g["flatten"]
save_png = g["save_png"]

NAVY_LIFT = (55, 92, 128, 255)  # lifted navy so stacked GO reads on #0B1F33
SKY_SOFT = (56, 189, 248, 130)
WHITE_SOFT = (232, 238, 245, 92)
AMBER_SOFT = (240, 162, 2, 150)


def saira(size):
    path = FONTS / "SairaCondensed-Black.ttf"
    return ImageFont.truetype(str(path), size)


def stacked_go(img, fill, *, scale=0.78, gap=0.70):
    """Brand stacked G / O like the Suite login watermark."""
    size = img.size[0]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = saira(int(size * scale))
    cx = size / 2
    cy = size / 2
    draw.text((cx, cy - size * gap * 0.28), "G", font=f, fill=fill, anchor="mm")
    draw.text((cx, cy + size * gap * 0.28), "O", font=f, fill=fill, anchor="mm")
    return Image.alpha_composite(img, layer)


def inline_go(img, fill, *, scale=0.62):
    """Wide GO word sitting behind the document."""
    size = img.size[0]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = saira(int(size * scale))
    draw.text((size / 2, size / 2), "GO", font=f, fill=fill, anchor="mm")
    return Image.alpha_composite(img, layer)


def add_mark(img, *, inset=0.20):
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    pad = int(size * inset)
    draw_mark(draw, (pad, pad, size - pad, size - pad))
    return img


def example_soft_navy(size):
    img = Image.new("RGBA", (size, size), NAVY)
    img = stacked_go(img, NAVY_LIFT, scale=1.02, gap=0.62)
    return add_mark(img, inset=0.24)


def example_login_watermark(size):
    img = Image.new("RGBA", (size, size), NAVY)
    img = stacked_go(img, WHITE_SOFT, scale=1.00, gap=0.64)
    return add_mark(img, inset=0.24)


def example_sky_stacked(size):
    img = Image.new("RGBA", (size, size), NAVY)
    img = stacked_go(img, SKY_SOFT, scale=1.00, gap=0.64)
    return add_mark(img, inset=0.24)


def example_side_letters(size):
    """G top-left and O bottom-right so the letters stay readable."""
    img = Image.new("RGBA", (size, size), NAVY)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = saira(int(size * 0.62))
    draw.text((size * 0.22, size * 0.20), "G", font=f, fill=(56, 189, 248, 160), anchor="mm")
    draw.text((size * 0.78, size * 0.80), "O", font=f, fill=(56, 189, 248, 160), anchor="mm")
    img = Image.alpha_composite(img, layer)
    return add_mark(img, inset=0.22)


def example_inline_amber(size):
    img = Image.new("RGBA", (size, size), NAVY)
    img = inline_go(img, AMBER_SOFT, scale=0.86)
    return add_mark(img, inset=0.24)


EXAMPLES = [
    ("1-soft-navy", "Soft navy stacked GO", example_soft_navy),
    ("2-login-watermark", "Login watermark stacked GO", example_login_watermark),
    ("3-sky-stacked", "Sky stacked GO", example_sky_stacked),
    ("4-side-letters", "Sky G / O beside the document", example_side_letters),
    ("5-inline-amber", "Amber GO word behind the document", example_inline_amber),
]


def contact_sheet(paths, dest, tile=256, label_h=36):
    cols = len(paths)
    sheet = Image.new("RGB", (tile * cols, tile + label_h), (7, 16, 28))
    draw = ImageDraw.Draw(sheet)
    label_font = ImageFont.truetype(str(FONTS / "SairaCondensed-ExtraBold.ttf"), 18)
    for i, (label, path) in enumerate(paths):
        tile_img = Image.open(path).convert("RGB").resize((tile, tile), Image.Resampling.LANCZOS)
        sheet.paste(tile_img, (i * tile, 0))
        draw.text(
            (i * tile + tile / 2, tile + label_h / 2),
            label,
            fill=(232, 238, 245),
            font=label_font,
            anchor="mm",
        )
    sheet.save(dest, "PNG")


def main():
    play_row = []
    store_row = []
    for slug, title, fn in EXAMPLES:
        folder = OUT / slug
        play = fn(512)
        appstore = fn(1024)
        play_path = folder / "icon-play-512.png"
        store_path = folder / "icon-appstore-1024.png"
        save_png(play, play_path, mode="opaque-rgba")
        save_png(appstore, store_path, mode="rgb")
        (folder / "README.txt").write_text(f"{title}\nPlay 512 + App Store 1024\n", encoding="utf8")
        play_row.append((slug.split("-", 1)[0], play_path))
        store_row.append((slug.split("-", 1)[0], store_path))
        print(f"wrote {folder}")

    contact_sheet(play_row, OUT / "sheet-play-512.png", tile=220)
    contact_sheet(store_row, OUT / "sheet-appstore-1024.png", tile=220)
    print("wrote contact sheets")


if __name__ == "__main__":
    main()
