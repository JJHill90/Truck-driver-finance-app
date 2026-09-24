#!/usr/bin/env python3
"""Preview colour-scheme variants of the chosen in-box GO icon.

Same option-5 layout (navy-style tile → outlined page → opacity GO clipped
inside the box → fold / lines). Only the blue / white / black / orange
assignments change. Does not overwrite production store icons.
"""
from __future__ import annotations

import runpy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "examples"
FONTS = ROOT / "fonts"

g = runpy.run_path(str(ROOT / "generate-icons.py"))
save_png = g["save_png"]
compose_theme = g["compose_theme"]

BLACK = (8, 10, 14, 255)
WHITE = (255, 255, 255, 255)
BLUE = (56, 189, 248, 255)
ORANGE = (240, 162, 2, 255)
PAGE = (245, 247, 250, 255)


def go(rgb, alpha):
    return (rgb[0], rgb[1], rgb[2], alpha)


PALETTES = [
    (
        "1-orange-fold",
        "Black tile, white page, orange fold, blue lines, blue GO",
        {
            "bg": BLACK,
            "paper": PAGE,
            "outline": WHITE,
            "fold": ORANGE,
            "line": BLUE,
            "accent": ORANGE,
            "go": go(BLUE, 72),
        },
    ),
    (
        "2-orange-go",
        "Black tile, white page, blue fold, black lines, orange GO",
        {
            "bg": BLACK,
            "paper": PAGE,
            "outline": WHITE,
            "fold": BLUE,
            "line": BLACK,
            "accent": ORANGE,
            "go": go(ORANGE, 78),
        },
    ),
    (
        "3-blue-page",
        "Black tile, blue page, orange fold, white lines, white GO",
        {
            "bg": BLACK,
            "paper": BLUE,
            "outline": WHITE,
            "fold": ORANGE,
            "line": WHITE,
            "accent": ORANGE,
            "go": go(WHITE, 96),
        },
    ),
    (
        "4-orange-tile",
        "Orange tile, white page, blue fold, black lines, black GO",
        {
            "bg": ORANGE,
            "paper": PAGE,
            "outline": WHITE,
            "fold": BLUE,
            "line": BLACK,
            "accent": BLUE,
            "go": go(BLACK, 56),
        },
    ),
    (
        "5-sky-tile",
        "Blue tile, white page, orange fold, black lines, black GO",
        {
            "bg": BLUE,
            "paper": PAGE,
            "outline": WHITE,
            "fold": ORANGE,
            "line": BLACK,
            "accent": ORANGE,
            "go": go(BLACK, 56),
        },
    ),
    (
        "6-white-tile",
        "White tile, black page, orange fold, white lines, blue GO",
        {
            "bg": WHITE,
            "paper": BLACK,
            "outline": BLUE,
            "fold": ORANGE,
            "line": WHITE,
            "accent": BLUE,
            "go": go(BLUE, 96),
        },
    ),
]


def contact_sheet(paths, dest, tile=220, label_h=36):
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
    if OUT.exists():
        for child in OUT.iterdir():
            if child.is_dir() and child.name[0].isdigit():
                for f in child.glob("*"):
                    f.unlink()
                child.rmdir()

    play_row = []
    store_row = []
    for slug, title, theme in PALETTES:
        folder = OUT / slug
        play_path = folder / "icon-play-512.png"
        store_path = folder / "icon-appstore-1024.png"
        save_png(compose_theme(512, theme), play_path, mode="opaque-rgba")
        save_png(compose_theme(1024, theme), store_path, mode="rgb")
        (folder / "README.txt").write_text(f"{title}\nPlay 512 + App Store 1024\n", encoding="utf8")
        play_row.append((slug.split("-", 1)[0], play_path))
        store_row.append((slug.split("-", 1)[0], store_path))
        print(f"wrote {folder}")

    contact_sheet(play_row, OUT / "sheet-play-512.png", tile=200)
    contact_sheet(store_row, OUT / "sheet-appstore-1024.png", tile=200)
    print("wrote contact sheets")


if __name__ == "__main__":
    main()
