#!/usr/bin/env python3
"""Generate Go Taxation Suite launcher and store icons (navy + sky document).

Requires Pillow:  python3 -m pip install Pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ANDROID_RES = ROOT.parent / "android" / "app" / "src" / "main" / "res"

NAVY = (11, 31, 51, 255)
INK = (11, 31, 51, 255)
PAPER = (232, 238, 245, 255)
SKY = (56, 189, 248, 255)
AMBER = (240, 162, 2, 255)

LEGACY = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
FOREGROUND = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}


def draw_mark(draw, box, paper=PAPER, fold=SKY, line=INK, accent=AMBER):
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    radius = max(8, int(w * 0.11))
    draw.rounded_rectangle(box, radius=radius, fill=paper)

    fold_w = int(w * 0.36)
    fold_h = int(h * 0.22)
    fx = x1 - fold_w
    # Turned page corner (sky triangle).
    draw.polygon([(fx, y0), (x1, y0 + fold_h), (fx, y0 + fold_h)], fill=fold)

    pad_x = int(w * 0.16)
    line_h = max(3, int(h * 0.055))
    gap = int(h * 0.12)
    ly = y0 + int(h * 0.42)
    widths = (0.68, 0.50, 0.58)
    colors = (line, line, accent)
    for i, (frac, color) in enumerate(zip(widths, colors)):
        lw = int(w * frac)
        y = ly + i * gap
        draw.rounded_rectangle(
            (x0 + pad_x, y, x0 + pad_x + lw, y + line_h),
            radius=line_h // 2,
            fill=color,
        )


def compose(size, *, background=True, round_clip=False):
    img = Image.new("RGBA", (size, size), NAVY if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Adaptive / store safe zone: keep the mark inside the inner ~66%.
    inset = int(size * (0.22 if not background else 0.18))
    draw_mark(draw, (inset, inset, size - inset, size - inset))
    if round_clip:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        rounded.paste(img, mask=mask)
        return rounded
    return img


def flatten(img, bg=NAVY):
    out = Image.new("RGB", img.size, bg[:3])
    out.paste(img, mask=img.split()[-1])
    return out


def save_png(img, path, *, mode="rgba"):
    path.parent.mkdir(parents=True, exist_ok=True)
    if mode == "rgb":
        flatten(img).save(path, "PNG")
    elif mode == "opaque-rgba":
        # Play high-res wants 32-bit PNG; flatten first so alpha is fully opaque.
        flatten(img).convert("RGBA").save(path, "PNG")
    else:
        img.save(path, "PNG")


def main():
    play = compose(512, background=True)
    save_png(play, ROOT / "icon-play-512.png", mode="opaque-rgba")

    appstore = compose(1024, background=True)
    save_png(appstore, ROOT / "icon-appstore-1024.png", mode="rgb")

    # Web / PWA companion (same 512 master).
    save_png(play, ROOT.parent.parent / "public" / "suite" / "icon-512.png", mode="opaque-rgba")

    for density, size in LEGACY.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        full = compose(size, background=True)
        save_png(full, folder / "ic_launcher.png", mode="rgb")
        save_png(compose(size, background=True, round_clip=True), folder / "ic_launcher_round.png")

    for density, size in FOREGROUND.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        save_png(compose(size, background=False), folder / "ic_launcher_foreground.png")

    print("wrote store + Android launcher icons")


if __name__ == "__main__":
    main()
