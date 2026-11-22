#!/usr/bin/env python3
"""Generates OpenWars' key art (resources/images/OpenWarsKeyArt.jpg).

The social-preview image (og:image), 1200x675. It is composed only from
OpenWars' own CC BY-SA assets in resources/: the gameplay screenshot as the
backdrop and the OpenWars wordmark on top. It replaces OpenFront's
proprietary KeyArt.jpg.

    python3 scripts/assets/generate_key_art.py

Needs Python 3 with Pillow and numpy.
"""

import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
IMAGES = os.path.join(ROOT, "resources", "images")
W, H = 1200, 675


def backdrop():
    shot = Image.open(os.path.join(IMAGES, "GameplayScreenshot.png")).convert("RGB")
    scale = max(W / shot.width, H / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    left, top = (shot.width - W) // 2, (shot.height - H) // 2
    shot = shot.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(1.2))
    px = np.asarray(shot).astype(np.float32) / 255
    # Night-time tint: desaturate, then pull toward deep navy, darker at the
    # edges (vignette) and through the middle band where the logo sits.
    grey = px @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    px = 0.6 * px + 0.4 * grey[..., None]
    navy = np.array([0.02, 0.06, 0.13], dtype=np.float32)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    band = np.exp(-(((y - H * 0.5) / (H * 0.2)) ** 2))
    dark = np.clip(0.38 + 0.3 * r + 0.22 * band, 0, 0.9)[..., None]
    px = px * (1 - dark) + navy * dark
    # A faint pixel grid, like the in-game map.
    grid = ((x % 24 < 1) | (y % 24 < 1)).astype(np.float32)[..., None]
    px = px + grid * np.array([0.0, 0.25, 0.45], dtype=np.float32) * 0.08
    return Image.fromarray((np.clip(px, 0, 1) * 255).astype(np.uint8))


def wordmark(width):
    logo = Image.open(os.path.join(IMAGES, "OpenWars.png")).convert("RGBA")
    logo = logo.crop(logo.getbbox())
    a = np.asarray(logo).astype(np.int32)
    # The wordmark is two blues: the face (light) and its drop shadow (dark).
    # Make the face white and keep the shadow blue, so it reads on the night map.
    face = (a[..., 3] > 0) & (a[..., 2] > 180)
    out = a.copy()
    out[face, :3] = [240, 246, 252]
    out[(a[..., 3] > 0) & ~face, :3] = [0, 132, 209]
    logo = Image.fromarray(out.astype(np.uint8), "RGBA")
    h = round(logo.height * width / logo.width)
    return logo.resize((width, h), Image.NEAREST)


def glow(mark, color, radius):
    alpha = mark.split()[3].filter(ImageFilter.GaussianBlur(radius))
    layer = Image.new("RGBA", mark.size, color + (0,))
    layer.putalpha(alpha.point(lambda v: int(v * 0.75)))
    return layer


def main():
    art = backdrop().convert("RGBA")
    mark = wordmark(980)
    pad = 60
    canvas = Image.new("RGBA", (mark.width + 2 * pad, mark.height + 2 * pad))
    canvas.paste(mark, (pad, pad))
    pos = ((W - canvas.width) // 2, (H - canvas.height) // 2)
    art.alpha_composite(glow(canvas, (0, 132, 209), 22), pos)
    art.alpha_composite(canvas, pos)
    art.convert("RGB").save(
        os.path.join(IMAGES, "OpenWarsKeyArt.jpg"), quality=88, optimize=True, progressive=True
    )


if __name__ == "__main__":
    main()
