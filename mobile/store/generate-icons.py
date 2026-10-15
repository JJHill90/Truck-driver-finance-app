#!/usr/bin/env python3
"""Generate Driver Hub launcher and Play store icons.

Navy tile, amber truck, DRIVER / HUB wordmark on the feature graphic.

Requires Pillow:  python3 -m pip install Pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ANDROID_RES = ROOT.parent / "android" / "app" / "src" / "main" / "res"

NAVY = (11, 31, 51, 255)
AMBER = (240, 162, 2, 255)
INK = (232, 238, 245, 255)
WHITE = (255, 255, 255, 255)

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


def draw_truck(draw, box, fill=AMBER):
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    cab = (x0 + w * 0.08, y0 + h * 0.28, x0 + w * 0.42, y0 + h * 0.72)
    trailer = (x0 + w * 0.40, y0 + h * 0.18, x1 - w * 0.08, y0 + h * 0.72)
    draw.rounded_rectangle(cab, radius=max(2, int(w * 0.04)), fill=fill)
    draw.rounded_rectangle(trailer, radius=max(2, int(w * 0.04)), fill=fill)
    wr = max(3, int(w * 0.07))
    wy = y0 + h * 0.78
    draw.ellipse((x0 + w * 0.22 - wr, wy - wr, x0 + w * 0.22 + wr, wy + wr), fill=fill)
    draw.ellipse((x0 + w * 0.72 - wr, wy - wr, x0 + w * 0.72 + wr, wy + wr), fill=fill)


def compose(size, *, background=True, round_clip=False):
    tile = NAVY if background else (0, 0, 0, 0)
    img = Image.new("RGBA", (size, size), tile)
    draw = ImageDraw.Draw(img)
    inset = int(size * (0.18 if background else 0.22))
    draw_truck(draw, (inset, inset, size - inset, size - inset))
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


def font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf",
        "DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def feature_graphic():
    w, h = 1024, 500
    img = Image.new("RGBA", (w, h), NAVY)
    draw = ImageDraw.Draw(img)
    mark_box = (64, 90, 64 + 320, 90 + 320)
    draw_truck(draw, mark_box)
    title = font(54)
    tag = font(22)
    draw.text((430, 140), "DRIVER", fill=WHITE, font=title)
    draw.text((430, 204), "HUB", fill=AMBER, font=title)
    draw.rounded_rectangle((430, 278, 430 + 72, 284), radius=3, fill=AMBER)
    draw.text((430, 310), "Tax records and diesel planning", fill=INK, font=tag)
    draw.text((430, 348), "for Australian truck drivers.", fill=(160, 176, 192, 255), font=tag)
    return img


def save_png(img, path, *, mode="rgba"):
    path.parent.mkdir(parents=True, exist_ok=True)
    if mode == "rgb":
        flatten(img).save(path, "PNG")
    elif mode == "opaque-rgba":
        flatten(img).convert("RGBA").save(path, "PNG")
    else:
        img.save(path, "PNG")


def main():
    play = compose(512, background=True)
    save_png(play, ROOT / "icon-play-512.png", mode="opaque-rgba")
    save_png(compose(1024, background=True), ROOT / "icon-appstore-1024.png", mode="rgb")

    for density, size in LEGACY.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        save_png(compose(size, background=True), folder / "ic_launcher.png", mode="rgb")
        save_png(compose(size, background=True, round_clip=True), folder / "ic_launcher_round.png")

    for density, size in FOREGROUND.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        save_png(compose(size, background=False), folder / "ic_launcher_foreground.png")

    save_png(feature_graphic(), ROOT / "feature-graphic-1024x500.png", mode="rgb")
    print("wrote Driver Hub store + Android launcher icons + feature graphic")


if __name__ == "__main__":
    main()
