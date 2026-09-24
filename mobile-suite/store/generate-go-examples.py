#!/usr/bin/env python3
"""Preview home-screen-style opacity GO behind a boxed document icon.

Matches Suite login look lr-b: wide Saira Condensed GO at low white opacity
on the navy tile, with the paper document kept fully inside its box.

Does not overwrite the current production icons.
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
draw_mark = g["draw_mark"]
save_png = g["save_png"]


def saira(size):
    # Weight 800 matches the Suite login GO mark.
    return ImageFont.truetype(str(FONTS / "SairaCondensed-ExtraBold.ttf"), size)


def wide_go(img, fill, *, scale=0.52, x=0.50, y=0.50, tracking=0.0):
    """Home-screen GO: one wide word, tight tracking, stays inside the tile."""
    size = img.size[0]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = saira(max(12, int(size * scale)))
    g_w = f.getlength("G")
    o_w = f.getlength("O")
    gap = size * tracking if tracking else size * 0.018
    total = g_w + o_w + gap
    start = size * x - total / 2
    draw.text((start, size * y), "G", font=f, fill=fill, anchor="lm")
    draw.text((start + g_w + gap, size * y), "O", font=f, fill=fill, anchor="lm")
    return Image.alpha_composite(img, layer)


def boxed_mark(img, *, inset=0.22):
    """Document stays a complete rounded box inside the tile."""
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    pad = int(size * inset)
    draw_mark(draw, (pad, pad, size - pad, size - pad))
    return img


def compose(size, *, alpha=46, scale=0.58, x=0.50, y=0.50, fill=None, inset=0.28):
    img = Image.new("RGBA", (size, size), NAVY)
    colour = fill if fill is not None else (255, 255, 255, alpha)
    img = wide_go(img, colour, scale=scale, x=x, y=y)
    return boxed_mark(img, inset=inset)


def example_home_18(size):
    """lr-b: rgba(255,255,255,0.18) wide GO, document boxed."""
    return compose(size, alpha=46, scale=0.60, y=0.40)


def example_home_26(size):
    """lr-a: a bit stronger, 26% white."""
    return compose(size, alpha=66, scale=0.60, y=0.40)


def example_home_12(size):
    """lr-c: softer 12% white, a little wider GO."""
    return compose(size, alpha=31, scale=0.64, y=0.40)


def example_home_sky(size):
    """Same wide GO, sky tint at home-screen opacity."""
    return compose(size, fill=(56, 189, 248, 56), scale=0.60, y=0.40)


def example_home_high(size):
    """Login placement: more of the GO shows above the boxed document."""
    return compose(size, alpha=46, scale=0.62, y=0.36)


EXAMPLES = [
    ("1-home-18", "Home screen 18% white GO, document in the box", example_home_18),
    ("2-home-26", "Stronger 26% white GO, document in the box", example_home_26),
    ("3-home-12", "Softer 12% white GO, a little wider", example_home_12),
    ("4-home-sky", "18% sky GO, document in the box", example_home_sky),
    ("5-home-high", "18% white GO high like the login, document boxed", example_home_high),
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
    # Drop the previous (cropped-letter) set so only this direction is shown.
    if OUT.exists():
        for child in OUT.iterdir():
            if child.is_dir() and child.name[0].isdigit():
                for f in child.glob("*"):
                    f.unlink()
                child.rmdir()

    play_row = []
    store_row = []
    for slug, title, fn in EXAMPLES:
        folder = OUT / slug
        play_path = folder / "icon-play-512.png"
        store_path = folder / "icon-appstore-1024.png"
        save_png(fn(512), play_path, mode="opaque-rgba")
        save_png(fn(1024), store_path, mode="rgb")
        (folder / "README.txt").write_text(f"{title}\nPlay 512 + App Store 1024\n", encoding="utf8")
        play_row.append((slug.split("-", 1)[0], play_path))
        store_row.append((slug.split("-", 1)[0], store_path))
        print(f"wrote {folder}")

    contact_sheet(play_row, OUT / "sheet-play-512.png", tile=220)
    contact_sheet(store_row, OUT / "sheet-appstore-1024.png", tile=220)
    print("wrote contact sheets")


if __name__ == "__main__":
    main()
