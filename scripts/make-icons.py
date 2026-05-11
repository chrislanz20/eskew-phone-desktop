#!/usr/bin/env python3
"""Generate Eskew Phone tray + app icons (no external assets needed).

Run from repo root:
    python3 scripts/make-icons.py

Outputs:
    assets/trayTemplate.png   (16x16, template — black + alpha)
    assets/trayTemplate@2x.png(32x32, template)
    build/icon.iconset/...    (full Apple iconset)
    build/icon.icns           (compiled by iconutil — call separately)
"""
from __future__ import annotations
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
BUILD = ROOT / "build"
ICONSET = BUILD / "icon.iconset"

ASSETS.mkdir(parents=True, exist_ok=True)
ICONSET.mkdir(parents=True, exist_ok=True)


def draw_phone_glyph(size: int, color: tuple[int, int, int, int]) -> Image.Image:
    """Tiny phone-handset glyph using primitives (no font needed)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    # Phone body — diagonal capsule.
    pad = s * 0.18
    # earpiece (top-left)
    r1 = s * 0.18
    cx1, cy1 = s * 0.30, s * 0.30
    d.ellipse([cx1 - r1, cy1 - r1, cx1 + r1, cy1 + r1], fill=color)
    # mouthpiece (bottom-right)
    cx2, cy2 = s * 0.70, s * 0.70
    d.ellipse([cx2 - r1, cy2 - r1, cx2 + r1, cy2 + r1], fill=color)
    # connecting bar
    bar_w = s * 0.14
    d.line([(cx1, cy1), (cx2, cy2)], fill=color, width=int(bar_w))
    return img


def draw_app_icon(size: int) -> Image.Image:
    """Rounded square w/ Eskew Phone branding."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    # Background rounded rect — Eskew brand-ish navy gradient (flat for simplicity).
    bg = (15, 23, 42, 255)  # slate-900
    d.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=bg)
    # Subtle inner highlight
    d.rounded_rectangle(
        [(int(size * 0.04), int(size * 0.04)), (int(size * 0.96), int(size * 0.50))],
        radius=int(radius * 0.85),
        fill=(30, 41, 59, 255),
    )
    # Phone glyph in white
    glyph = draw_phone_glyph(int(size * 0.62), (255, 255, 255, 255))
    gx = (size - glyph.width) // 2
    gy = (size - glyph.height) // 2 - int(size * 0.04)
    img.alpha_composite(glyph, (gx, gy))
    # "EP" under glyph if there's room
    if size >= 128:
        try:
            font = ImageFont.truetype(
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                int(size * 0.14),
            )
        except Exception:
            font = ImageFont.load_default()
        text = "EP"
        bbox = d.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text(
            ((size - tw) // 2 - bbox[0], int(size * 0.78) - bbox[1]),
            text,
            font=font,
            fill=(186, 230, 253, 255),  # sky-200
        )
    return img


def write_tray_icons() -> None:
    # macOS template images: black silhouette + alpha. We render the phone in
    # solid black; the OS will tint it for menu bar light/dark.
    for px, name in [(16, "trayTemplate.png"), (32, "trayTemplate@2x.png")]:
        img = draw_phone_glyph(px, (0, 0, 0, 255))
        img.save(ASSETS / name, "PNG")
    print(f"wrote tray icons to {ASSETS}")


def write_app_iconset() -> None:
    # Apple iconset spec sizes.
    specs = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, fname in specs:
        draw_app_icon(size).save(ICONSET / fname, "PNG")
    # also drop a 512px PNG that electron-builder can use as fallback
    draw_app_icon(512).save(BUILD / "icon.png", "PNG")
    print(f"wrote app iconset to {ICONSET}")


if __name__ == "__main__":
    write_tray_icons()
    write_app_iconset()
