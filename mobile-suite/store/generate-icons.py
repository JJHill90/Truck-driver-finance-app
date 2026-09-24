#!/usr/bin/env python3
"""Generate Go Taxation Suite launcher and store icons (navy + sky document).

Requires Pillow:  python3 -m pip install Pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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


SAIRA_EXTRABOLD = Path(__file__).resolve().parent / "fonts" / "SairaCondensed-ExtraBold.ttf"
# Home-screen lr-b GO is ~18% white on navy. On the paper box that becomes
# the same navy at ~18% so the letters read as a watermark inside the page.
GO_ON_PAPER = (11, 31, 51, 46)


def box_radius(box):
    return max(8, int((box[2] - box[0]) * 0.11))


def draw_paper_box(draw, box, paper=PAPER, outline=(255, 255, 255, 255)):
    radius = box_radius(box)
    draw.rounded_rectangle(box, radius=radius, fill=paper)
    # Bright edge so the page reads as an outlined box on the tile.
    if outline:
        stroke = max(2, int((box[2] - box[0]) * 0.028))
        draw.rounded_rectangle(box, radius=radius, outline=outline, width=stroke)


def draw_mark_details(draw, box, fold=SKY, line=INK, accent=AMBER):
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    fold_w = int(w * 0.36)
    fold_h = int(h * 0.22)
    fx = x1 - fold_w
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


def draw_go_inside_box(img, box, fill=GO_ON_PAPER, *, scale=0.62, y_frac=0.36):
    """Option 5 GO, clipped so it cannot sit outside the white outlined box."""
    x0, y0, x1, y1 = box
    bw = x1 - x0
    bh = y1 - y0
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    try:
        face = ImageFont.truetype(str(SAIRA_EXTRABOLD), max(12, int(bw * scale)))
    except OSError:
        face = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf", max(12, int(bw * scale)))
    g_w = face.getlength("G")
    o_w = face.getlength("O")
    gap = bw * 0.018
    total = g_w + o_w + gap
    start = (x0 + x1) / 2 - total / 2
    cy = y0 + bh * y_frac
    draw.text((start, cy), "G", font=face, fill=fill, anchor="lm")
    draw.text((start + g_w + gap, cy), "O", font=face, fill=fill, anchor="lm")

    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=box_radius(box), fill=255)
    clipped = Image.new("RGBA", img.size, (0, 0, 0, 0))
    clipped.paste(layer, mask=mask)
    return Image.alpha_composite(img, clipped)


def paint_boxed_mark(
    img,
    box,
    paper=PAPER,
    fold=SKY,
    line=INK,
    accent=AMBER,
    go=GO_ON_PAPER,
    outline=(255, 255, 255, 255),
):
    """Layering: navy → white box → opacity GO inside the box → fold / lines."""
    draw = ImageDraw.Draw(img)
    draw_paper_box(draw, box, paper=paper, outline=outline)
    img = draw_go_inside_box(img, box, fill=go)
    draw = ImageDraw.Draw(img)
    draw_mark_details(draw, box, fold=fold, line=line, accent=accent)
    return img


def compose_theme(size, theme, *, background=True, round_clip=False):
    """Same option-5 layout with a caller-supplied colour palette."""
    tile = theme["bg"] if background else (0, 0, 0, 0)
    img = Image.new("RGBA", (size, size), tile)
    inset = int(size * (0.22 if not background else 0.18))
    box = (inset, inset, size - inset, size - inset)
    img = paint_boxed_mark(
        img,
        box,
        paper=theme["paper"],
        fold=theme["fold"],
        line=theme["line"],
        accent=theme["accent"],
        go=theme["go"],
        outline=theme.get("outline", (255, 255, 255, 255)),
    )
    if round_clip:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        rounded.paste(img, mask=mask)
        return rounded
    return img


def draw_mark(draw, box, paper=PAPER, fold=SKY, line=INK, accent=AMBER, outline=(255, 255, 255, 255)):
    draw_paper_box(draw, box, paper=paper, outline=outline)
    draw_mark_details(draw, box, fold=fold, line=line, accent=accent)


def compose(size, *, background=True, round_clip=False):
    img = Image.new("RGBA", (size, size), NAVY if background else (0, 0, 0, 0))
    # Adaptive / store safe zone: keep the mark inside the inner ~66%.
    inset = int(size * (0.22 if not background else 0.18))
    box = (inset, inset, size - inset, size - inset)
    img = paint_boxed_mark(img, box)
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


FONT_BOLD = Path("/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf")
FONT_SEMI = Path("/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf")
FONT_MED = Path("/usr/share/fonts/truetype/noto/NotoSansDisplay-Regular.ttf")


def font(path, size, fallback="DejaVuSans.ttf"):
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.truetype(fallback, size)


def feature_graphic():
    """Play Console feature graphic: 1024 × 500, opaque RGB."""
    w, h = 1024, 500
    img = Image.new("RGBA", (w, h), NAVY)
    draw = ImageDraw.Draw(img)

    # Soft sky wash on the right so the tile does not look flat.
    wash = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(wash).ellipse((520, -180, 1240, 420), fill=(56, 189, 248, 38))
    img = Image.alpha_composite(img, wash)
    draw = ImageDraw.Draw(img)

    mark_box = (72, 86, 72 + 328, 86 + 328)
    img = paint_boxed_mark(img, mark_box)
    draw = ImageDraw.Draw(img)

    title = font(FONT_BOLD, 46)
    suite_font = font(FONT_BOLD, 54)
    tag = font(FONT_MED, 22)
    draw.text((448, 128), "Go Taxation", fill=PAPER, font=title)
    draw.text((448, 188), "Suite", fill=SKY, font=suite_font)
    draw.rounded_rectangle((448, 266, 448 + 72, 272), radius=3, fill=AMBER)
    draw.text((448, 296), "Record receipts. Prepare working papers.", fill=PAPER, font=tag)
    draw.text((448, 334), "Not advice. You lodge with the ATO.", fill=(186, 200, 214, 255), font=tag)
    return img


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

    save_png(feature_graphic(), ROOT / "feature-graphic-1024x500.png", mode="rgb")

    ios_icon = ROOT.parent / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
    if ios_icon.exists():
        save_png(appstore, ios_icon / "AppIcon-512@2x.png", mode="rgb")

    print("wrote store + Android launcher icons + feature graphic")


if __name__ == "__main__":
    main()
