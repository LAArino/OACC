# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
"""Generates the abstract course illustrations of the OACC example data.

Every image is drawn by this script from geometry, gradients and seeded noise:
no photograph, no font, no logo, no third-party artwork and no AI image service
is involved, so nobody holds rights over the results beyond the licence of this
file. The output is deterministic: the same Pillow and NumPy versions give the
same pixels.

Requirements: Python 3.10+, Pillow 11 and NumPy 2 (``pip install Pillow numpy``).

Usage (from the repository root):

    python3 docs/data/example-alliance-2026-27/images/generate.py
        writes the example-alliance images next to this script

    python3 generate.py --theme data_ethics --out /tmp/test.jpg
        writes one theme to one file (themes: see THEMES below)

    python3 generate.py --map mapping.json --out-dir images/
        writes <slug>/<course_code>.jpg for a {slug: {course_code: theme}} map
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 900  # 16:9, the course image box
S = 2  # supersampling factor for the drawn layers


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def hx(s: str, a: int = 255) -> tuple[int, int, int, int]:
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def gradient(w: int, h: int, stops, angle: float = 90.0) -> np.ndarray:
    """Linear gradient; stops = [(pos 0..1, '#rrggbb'), ...]; angle in degrees
    (0 = left to right, 90 = top to bottom)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = math.radians(angle)
    t = (x - w / 2) * math.cos(a) + (y - h / 2) * math.sin(a)
    t = (t - t.min()) / (t.max() - t.min())
    pos = [p for p, _ in stops]
    out = np.empty((h, w, 3), np.float32)
    for c in range(3):
        vals = [hx(col)[c] for _, col in stops]
        out[..., c] = np.interp(t, pos, vals)
    return out


def radial_glow(w, h, cx, cy, r, color, strength):
    """Additive soft glow, returns (h, w, 3) float32."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot(x - cx, y - cy) / r
    f = np.clip(1 - d, 0, 1) ** 2 * strength
    return f[..., None] * np.array(color[:3], np.float32)[None, None, :]


def value_noise(w, h, cell, seed, octaves=4):
    """Smooth fractal value noise in 0..1, shape (h, w)."""
    rng = np.random.default_rng(seed)
    total = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = max(cell / (2 ** o), 2)
        gw, gh = int(w / c) + 3, int(h / c) + 3
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray(g, mode="F").resize((int(gw * c), int(gh * c)), Image.BICUBIC)
        a = np.asarray(im)[:h, :w]
        total += amp * a
        norm += amp
        amp *= 0.5
    total /= norm
    return (total - total.min()) / (total.max() - total.min())


def round_poly(pts, r, steps=10):
    """Polyline with rounded corners (quadratic Bezier at every inner vertex)."""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = np.array(pts[i - 1], float), np.array(pts[i], float), np.array(pts[i + 1], float)
        v1, v2 = p0 - p1, p2 - p1
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        rr = min(r, n1 / 2, n2 / 2)
        a, b = p1 + v1 / n1 * rr, p1 + v2 / n2 * rr
        for k in range(steps + 1):
            t = k / steps
            q = (1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t * t * b
            out.append((q[0], q[1]))
    out.append(pts[-1])
    return out


class Art:
    """A supersampled RGBA canvas with helpers to composite drawing layers."""

    def __init__(self, base: np.ndarray):
        base = np.clip(base, 0, 255).astype(np.uint8)
        im = Image.fromarray(base, "RGB").convert("RGBA")
        if im.size != (W * S, H * S):
            im = im.resize((W * S, H * S), Image.BICUBIC)
        self.img = im

    def layer(self):
        im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        return im, Pen(im)

    def put(self, layer, blur: float = 0.0, opacity: float = 1.0):
        if blur:
            layer = layer.filter(ImageFilter.GaussianBlur(blur * S))
        if opacity < 1:
            layer.putalpha(layer.getchannel("A").point(lambda v: int(v * opacity)))
        self.img.alpha_composite(layer)

    def add_light(self, arr: np.ndarray):
        a = np.asarray(self.img).astype(np.float32)
        a[..., :3] += np.repeat(arr, S, 0).repeat(S, 1) if arr.shape[0] == H else arr
        self.img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


class Pen:
    """ImageDraw wrapper working in 1600x900 coordinates."""

    def __init__(self, im):
        self.d = ImageDraw.Draw(im)

    @staticmethod
    def _p(pts):
        return [(x * S, y * S) for x, y in pts]

    def line(self, pts, fill, w=2):
        pts = self._p(pts)
        self.d.line(pts, fill=fill, width=max(1, round(w * S)), joint="curve")

    def round_line(self, pts, fill, w=2):
        """Line with round end caps."""
        self.line(pts, fill, w)
        for x, y in (pts[0], pts[-1]):
            self.circle(x, y, w / 2, fill=fill)

    def circle(self, cx, cy, r, fill=None, outline=None, w=1):
        self.d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S],
                       fill=fill, outline=outline, width=max(1, round(w * S)))

    def ellipse(self, cx, cy, rx, ry, rot, fill=None, outline=None, w=1):
        pts = []
        for i in range(72):
            t = 2 * math.pi * i / 72
            x, y = rx * math.cos(t), ry * math.sin(t)
            pts.append((cx + x * math.cos(rot) - y * math.sin(rot),
                        cy + x * math.sin(rot) + y * math.cos(rot)))
        self.poly(pts, fill, outline, w)

    def poly(self, pts, fill=None, outline=None, w=1):
        pts = self._p(pts)
        if fill:
            self.d.polygon(pts, fill=fill)
        if outline:
            self.d.line(pts + [pts[0]], fill=outline, width=max(1, round(w * S)), joint="curve")

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, w=1, r=0):
        box = [x0 * S, y0 * S, x1 * S, y1 * S]
        if r:
            self.d.rounded_rectangle(box, r * S, fill=fill, outline=outline, width=max(1, round(w * S)))
        else:
            self.d.rectangle(box, fill=fill, outline=outline, width=max(1, round(w * S)))

    def arc(self, cx, cy, r, a0, a1, fill, w=2):
        self.d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], a0, a1,
                   fill=fill, width=max(1, round(w * S)))


def finish(img: Image.Image, path: Path, vignette=0.22, grain=1.6, seed=1):
    im = img.convert("RGB")
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))
    a *= (1 - vignette * np.clip(r - 0.45, 0, 1) ** 1.6)[..., None]
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, grain, (H, W)).astype(np.float32)
    noise = 0.5 * noise + 0.125 * (np.roll(noise, 1, 0) + np.roll(noise, -1, 0) + np.roll(noise, 1, 1) + np.roll(noise, -1, 1))
    a += noise[..., None] * 1.5
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "JPEG", quality=85, optimize=True, progressive=True, subsampling=2)


def lerp_col(c0, c1, t):
    return tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(4))


# --------------------------------------------------------------------------
# themes
# --------------------------------------------------------------------------

def theme_data_ethics(seed=11):
    """Node graph over a dot grid: data systems, AI."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#071a36"), (0.55, "#0d3f5f"), (1, "#127a85")], 35)
    art = Art(base)
    # dot grid
    L, p = art.layer()
    for gx in range(30, W, 40):
        for gy in range(30, H, 40):
            p.circle(gx, gy, 1.6, fill=(255, 255, 255, 46))
    art.put(L)
    # big lens
    L, p = art.layer()
    p.circle(1090, 420, 330, fill=(120, 220, 230, 22), outline=(160, 240, 245, 70), w=2)
    p.circle(1090, 420, 250, outline=(160, 240, 245, 40), w=1.5)
    art.put(L)
    # nodes: rejection sampling for an even spread
    nodes = []
    tries = 0
    while len(nodes) < 54 and tries < 20000:
        tries += 1
        x, y = rng.uniform(60, W - 60), rng.uniform(60, H - 60)
        if all(math.hypot(x - a, y - b) > 105 for a, b in nodes):
            nodes.append((x, y))
    pts = np.array(nodes)
    edges = set()
    for i, (x, y) in enumerate(nodes):
        d = np.hypot(pts[:, 0] - x, pts[:, 1] - y)
        for j in np.argsort(d)[1:4]:
            if d[j] < 250:
                edges.add(tuple(sorted((i, int(j)))))
    hot = {i for i, (x, y) in enumerate(nodes) if math.hypot(x - 1090, y - 420) < 300}
    L, p = art.layer()
    G, g = art.layer()
    for i, j in edges:
        warm = i in hot and j in hot
        col = hx("#ffc857", 190) if warm else hx("#8fe3ee", 95)
        p.line([nodes[i], nodes[j]], col, 2.2 if warm else 1.6)
        if warm:
            g.line([nodes[i], nodes[j]], hx("#ffc857", 160), 6)
    for i, (x, y) in enumerate(nodes):
        r = float(rng.uniform(4, 9))
        if i in hot:
            p.circle(x, y, r + 1, fill=hx("#ffd98a"))
            g.circle(x, y, r + 8, fill=hx("#ffc857", 150))
        else:
            p.circle(x, y, r, fill=hx("#bdf0f5", 235))
            if rng.random() < 0.3:
                p.circle(x, y, r + 7, outline=hx("#bdf0f5", 120), w=1.4)
    art.put(G, blur=9)
    art.put(L)
    return art.img


def theme_ecosystems(seed=22):
    """Northern ecosystems: moon rings, layered conifer ridges, water lines."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#0f2a43"), (0.45, "#2f6577"), (0.68, "#b9d6cf"), (1, "#e7dfc4")], 90)
    art = Art(base)
    # sun / moon rings (tree-ring motif)
    cx, cy = 1160, 235
    L, p = art.layer()
    for i, r in enumerate(range(150, 20, -14)):
        p.circle(cx, cy, r, outline=(255, 244, 214, int(30 + (150 - r) * 0.9)), w=1.6)
    art.put(L)
    L, p = art.layer()
    p.circle(cx, cy, 60, fill=hx("#fff1cf", 245))
    art.put(L)
    G, g = art.layer()
    g.circle(cx, cy, 110, fill=hx("#fff1cf", 120))
    art.put(G, blur=40)

    def ridge_y(x, base_y, amp, k):
        return (base_y + amp * (0.55 * np.sin(x / (210 + 40 * k) + k * 1.7)
                                + 0.30 * np.sin(x / (95 + 17 * k) + k * 3.1)
                                + 0.15 * np.sin(x / 41 + k)))

    cols = ["#6f9fa6", "#4a7f86", "#2f6460", "#1c4a47", "#0f332f"]
    bases = [500, 540, 580, 625, 665]
    amps = [70, 62, 54, 46, 36]
    for k in range(5):
        L, p = art.layer()
        xs = np.arange(-20, W + 21, 4)
        ys = ridge_y(xs, bases[k], amps[k], k)
        poly = [(float(x), float(y)) for x, y in zip(xs, ys)] + [(W + 20, 740), (-20, 740)]
        p.poly(poly, fill=hx(cols[k]))
        # conifers along the ridge
        n = 26 + k * 10
        tree_col = hx(cols[k])
        for _ in range(n):
            x = float(rng.uniform(0, W))
            y = float(ridge_y(np.array([x]), bases[k], amps[k], k)[0]) + 4
            hgt = float(rng.uniform(24, 44)) * (0.7 + 0.2 * k)
            w0 = hgt * 0.34
            for t in range(3):
                yb = y - t * hgt * 0.30
                p.poly([(x - w0 * (1 - t * 0.22), yb), (x + w0 * (1 - t * 0.22), yb),
                        (x, yb - hgt * 0.55)], fill=tree_col)
        art.put(L)
        if k < 4:  # mist between ridges
            M, m = art.layer()
            for _ in range(5):
                mx, my = float(rng.uniform(0, W)), bases[k] + amps[k] * 0.9 + float(rng.uniform(-10, 20))
                m.ellipse(mx, my, float(rng.uniform(220, 380)), 18, 0, fill=(235, 245, 240, 70))
            art.put(M, blur=14)
    # water
    L, p = art.layer()
    p.rect(0, 722, W, H, fill=hx("#0b2c3a"))
    art.put(L)
    base2 = np.asarray(art.img).astype(np.float32)
    # water gradient + reflected glow
    wy = np.linspace(0, 1, H * S - 722 * S, dtype=np.float32)[:, None, None]
    water = np.array(hx("#14485a")[:3], np.float32) * (1 - wy) + np.array(hx("#06202c")[:3], np.float32) * wy
    base2[722 * S:, :, :3] = water
    art.img = Image.fromarray(base2.astype(np.uint8), "RGBA")
    L, p = art.layer()
    for _ in range(95):
        y = float(rng.uniform(730, H - 8))
        x = float(rng.uniform(-100, W))
        ln = float(rng.uniform(60, 330)) * (0.5 + (y - 722) / 260)
        p.line([(x, y), (x + ln, y)], (210, 238, 235, int(rng.uniform(30, 120))), float(rng.uniform(1.2, 2.6)))
    # reflection of the moon: broken short lines
    for i in range(10):
        y = 742 + i * 15
        wd = 88 - i * 6
        p.line([(cx - wd, y), (cx + wd, y)], (255, 241, 207, int(150 - i * 11)), 3)
    art.put(L)
    return art.img


def theme_heritage(seed=33):
    """Layered arches and mosaic tiles."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#2a1b3d"), (0.5, "#8a3f50"), (0.82, "#e08a5a"), (1, "#f2c48d")], 90)
    art = Art(base)
    glow = radial_glow(W, H, 800, 520, 520, hx("#ffd9a0"), 0.38)
    art.add_light(np.asarray(Image.fromarray(np.clip(glow, 0, 255).astype(np.uint8)).resize((W * S, H * S), Image.BICUBIC)).astype(np.float32))

    def arch(p, cx, base_y, spring_y, hw, fill=None, outline=None, w=2):
        pts = [(cx - hw, base_y), (cx - hw, spring_y)]
        for i in range(1, 40):
            t = math.pi - math.pi * i / 40
            pts.append((cx + hw * math.cos(t), spring_y - hw * math.sin(t)))
        pts += [(cx + hw, spring_y), (cx + hw, base_y)]
        p.poly(pts, fill=fill, outline=outline, w=w)

    ground = 640
    # side arcades, fainter
    L, p = art.layer()
    for cx, hw in [(190, 120), (415, 100), (1185, 100), (1410, 120)]:
        for i, col in enumerate(["#5a2c47", "#7e3d4d", "#a15553"]):
            arch(p, cx, ground, ground - 190, hw - i * 20, fill=hx(col, 235))
        arch(p, cx, ground, ground - 190, hw - 60, fill=hx("#f1b27a", 200))
    art.put(L)
    # main nested arches
    rings = ["#3a2146", "#6b2f4e", "#a04557", "#d9704f", "#efa05b", "#f6c47e", "#fbe2ad"]
    L, p = art.layer()
    for i, col in enumerate(rings):
        hw = 290 - i * 38
        arch(p, 800, ground, ground - 250, hw, fill=hx(col))
    art.put(L)
    # keystone dots on the main arch
    L, p = art.layer()
    for i in range(14):
        t = math.pi - math.pi * (i + 0.5) / 14
        p.circle(800 + 304 * math.cos(t), ground - 250 - 304 * math.sin(t), 5, fill=hx("#fbe2ad", 230))
    art.put(L)
    # thin gold outlines
    L, p = art.layer()
    for i in (0, 2, 4):
        arch(p, 800, ground, ground - 250, 290 - i * 38, outline=hx("#ffe3a8", 90), w=1.6)
    art.put(L)
    # mosaic floor
    palette = ["#2a1b3d", "#6b2f4e", "#a04557", "#d9704f", "#efa05b", "#f6c47e", "#1f6f78", "#3aa0a0"]
    L, p = art.layer()
    ts = 40
    for gy, y in enumerate(range(ground, H, ts)):
        for gx, x in enumerate(range(-20, W, ts)):
            k = (gx * 3 + gy * 5 + int(rng.integers(0, 4))) % len(palette)
            col = list(hx(palette[k]))
            sh = 0.8 + 0.25 * float(rng.random())
            col = tuple(min(255, int(c * sh)) for c in col[:3]) + (255,)
            if (gx + gy) % 2:
                p.poly([(x + ts / 2, y + 2), (x + ts - 2, y + ts / 2), (x + ts / 2, y + ts - 2), (x + 2, y + ts / 2)], fill=col)
            else:
                p.rect(x + 2, y + 2, x + ts - 2, y + ts - 2, fill=col)
    art.put(L)
    # fade of the mosaic into the arches' shadow
    sh, p = art.layer()
    for i in range(30):
        p.rect(0, ground + i * 2, W, ground + i * 2 + 2, fill=(20, 8, 25, int(130 * (1 - i / 30))))
    art.put(sh)
    return art.img


def gear_pts(cx, cy, r_out, r_in, teeth, rot):
    p = 2 * math.pi / teeth
    pts = []
    for i in range(teeth):
        a = rot + i * p
        for da, r in ((-0.26, r_in), (-0.15, r_out), (0.15, r_out), (0.26, r_in)):
            pts.append((cx + r * math.cos(a + da * p * 2), cy + r * math.sin(a + da * p * 2)))
    return pts


def theme_manufacturing(seed=44):
    """Gears, circuit traces and a two-segment robot arm."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#0d1620"), (0.6, "#1b2c3b"), (1, "#2a4256")], 30)
    art = Art(base)
    L, p = art.layer()
    for x in range(0, W + 1, 50):
        p.line([(x, 0), (x, H)], (140, 180, 210, 22), 1)
    for y in range(0, H + 1, 50):
        p.line([(0, y), (W, y)], (140, 180, 210, 22), 1)
    art.put(L)
    # circuit traces
    L, p = art.layer()
    traces = [
        [(0, 120), (260, 120), (330, 190), (620, 190)],
        [(0, 200), (180, 200), (250, 270), (500, 270), (560, 330)],
        [(W, 800), (1450, 800), (1380, 870), (1200, 870)],
        [(W, 720), (1500, 720), (1450, 770), (1330, 770)],
        [(W, 150), (1300, 150), (1230, 220), (1000, 220)],
        [(W, 230), (1400, 230), (1330, 300), (1180, 300)],
    ]
    for t in traces:
        p.line(round_poly(t, 24), hx("#56c2d6", 150), 3)
        x, y = t[-1]
        p.circle(x, y, 8, fill=hx("#0d1620"), outline=hx("#56c2d6", 220), w=3)
        x, y = t[0]
        p.circle(x, y + 0, 4, fill=hx("#56c2d6", 200))
    art.put(L)
    # gears
    gears = [(900, 520, 150, 122, 18), (1170, 650, 105, 85, 13), (700, 700, 85, 67, 10)]
    L, p = art.layer()
    G, g = art.layer()
    placed = []
    cx0, cy0, ro0, ri0, n0 = gears[0]
    for idx, (cx, cy, ro, ri, n) in enumerate(gears):
        if idx == 0:
            rot = 0.2
        else:
            # centre on the pitch circle of gear 0; a valley faces gear 0
            ang = math.atan2(cy - cy0, cx - cx0)
            pitch = (ro0 + ri0) / 2 + (ro + ri) / 2 + 5
            cx, cy = cx0 + pitch * math.cos(ang), cy0 + pitch * math.sin(ang)
            rot = math.atan2(cy0 - cy, cx0 - cx) - 0.5 * (2 * math.pi / n)
        pts = gear_pts(cx, cy, ro, ri, n, rot)
        p.poly(pts, fill=hx("#f08a24", 70), outline=hx("#ffb25c", 230), w=3)
        p.circle(cx, cy, ri * 0.62, outline=hx("#ffb25c", 150), w=2)
        p.circle(cx, cy, ri * 0.22, fill=hx("#0d1620"), outline=hx("#ffb25c", 230), w=3)
        for s in range(6):
            a = rot + s * math.pi / 3
            p.line([(cx + ri * 0.25 * math.cos(a), cy + ri * 0.25 * math.sin(a)),
                    (cx + ri * 0.62 * math.cos(a), cy + ri * 0.62 * math.sin(a))], hx("#ffb25c", 130), 2)
        g.poly(pts, fill=hx("#f08a24", 110))
        placed.append((cx, cy))
    art.put(G, blur=14)
    art.put(L)
    # robot arm
    L, p = art.layer()
    j0 = (330, 815)
    j1 = (430, 560)
    j2 = (640, 430)
    for a, b, wd in ((j0, j1, 34), (j1, j2, 26)):
        p.round_line([a, b], hx("#3b566c", 255), wd)
        p.round_line([a, b], hx("#6aa6c4", 255), wd - 12)
        p.round_line([a, b], hx("#1b2c3b", 255), wd - 24)
    for (x, y), r in ((j0, 34), (j1, 28), (j2, 20)):
        p.circle(x, y, r, fill=hx("#0d1620"), outline=hx("#56c2d6"), w=4)
        p.circle(x, y, r * 0.35, fill=hx("#56c2d6"))
    # gripper
    p.line([(j2[0], j2[1]), (j2[0] + 55, j2[1] - 10)], hx("#6aa6c4"), 8)
    p.line([(j2[0] + 55, j2[1] - 10), (j2[0] + 90, j2[1] - 40)], hx("#6aa6c4"), 8)
    p.line([(j2[0] + 55, j2[1] - 10), (j2[0] + 92, j2[1] + 22)], hx("#6aa6c4"), 8)
    p.rect(240, 835, 420, 868, fill=hx("#3b566c"), r=8)
    art.put(L)
    return art.img


def theme_mobility(seed=55):
    """Transit lines, stations and bike rings on a calm city map."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#f6f1e5"), (0.6, "#dcebe3"), (1, "#bfdad8")], 20)
    art = Art(base)
    # blocks
    L, p = art.layer()
    for gx in range(0, W, 120):
        for gy in range(0, H, 100):
            if rng.random() < 0.62:
                w0, h0 = float(rng.uniform(60, 98)), float(rng.uniform(50, 80))
                p.rect(gx + 10, gy + 10, gx + 10 + w0, gy + 10 + h0, fill=(255, 255, 255, 120), r=10)
    art.put(L)
    # park and water
    L, p = art.layer()
    p.ellipse(250, 700, 230, 120, -0.2, fill=hx("#b7dcb0", 150))
    p.ellipse(1400, 190, 260, 90, 0.3, fill=hx("#a9d3dc", 170))
    art.put(L)
    # bike rings
    L, p = art.layer()
    for r, a in ((200, 90), (270, 60)):
        for k in range(0, 360, 14):
            p.arc(900, 470, r, k, k + 7, hx("#2e86ab", a), 3)
    art.put(L)
    lines = [
        ("#1b998b", [(-20, 690), (260, 690), (380, 570), (780, 570), (900, 450), (1220, 450), (1340, 330), (1620, 330)]),
        ("#ff7a45", [(-20, 210), (330, 210), (470, 350), (900, 350), (1020, 470), (1020, 640), (1130, 750), (1620, 750)]),
        ("#6a4c93", [(560, -20), (560, 150), (680, 270), (680, 560), (570, 670), (570, 920)]),
        ("#2e86ab", [(-20, 470), (200, 470), (310, 360), (310, 250), (430, 130), (1000, 130), (1100, 230), (1620, 230)]),
        ("#e63e6d", [(1240, -20), (1240, 120), (1130, 230), (1130, 560), (1250, 680), (1250, 920)]),
    ]
    L, p = art.layer()
    SH, sh = art.layer()
    for col, pts in lines:
        rp = round_poly(pts, 48, 14)
        sh.line([(x + 4, y + 6) for x, y in rp], (20, 50, 60, 70), 20)
        p.line(rp, hx(col), 16)
    art.put(SH, blur=6)
    art.put(L)
    # stations: along each line at some distances, interchanges at crossings
    L, p = art.layer()
    stations = []
    for col, pts in lines:
        rp = round_poly(pts, 48, 14)
        total, acc = 0, [0.0]
        for i in range(1, len(rp)):
            total += math.dist(rp[i - 1], rp[i])
            acc.append(total)
        for s in np.linspace(120, total - 120, 7):
            i = int(np.searchsorted(acc, s))
            i = min(max(i, 1), len(rp) - 1)
            t = (s - acc[i - 1]) / max(acc[i] - acc[i - 1], 1e-6)
            x = rp[i - 1][0] + (rp[i][0] - rp[i - 1][0]) * t
            y = rp[i - 1][1] + (rp[i][1] - rp[i - 1][1]) * t
            if 30 < x < W - 30 and 30 < y < H - 30:
                stations.append((x, y, col))
    for x, y, col in stations:
        p.circle(x, y, 13, fill=(255, 255, 255, 255), outline=hx("#27424a"), w=4)
    art.put(L)
    return art.img


def theme_social(seed=66):
    """Interlocking circles: social innovation, collaboration."""
    base = gradient(W * S, H * S, [(0, "#2a1346"), (0.5, "#8c2f6d"), (1, "#f07a4a")], 25)
    art = Art(base)
    glow = radial_glow(W, H, 800, 450, 620, hx("#ffb27a"), 0.30)
    art.add_light(np.asarray(Image.fromarray(np.clip(glow, 0, 255).astype(np.uint8)).resize((W * S, H * S), Image.BICUBIC)).astype(np.float32))
    R = 190
    centers = [(800, 450)]
    for k in range(6):
        a = math.radians(30 + 60 * k)
        centers.append((800 + R * math.cos(a), 450 + R * math.sin(a)))
    cols = ["#ffe08a", "#ff9a76", "#ff6f91", "#c86bd8", "#7a8cff", "#4fd1c5", "#a3e635"]
    for (cx, cy), col in zip(centers, cols):
        L, p = art.layer()
        p.circle(cx, cy, R, fill=hx(col, 78), outline=hx(col, 235), w=5)
        art.put(L)
    # outer faint rings
    L, p = art.layer()
    p.circle(800, 450, R * 2 + 60, outline=(255, 255, 255, 60), w=2)
    p.circle(800, 450, R * 2 + 130, outline=(255, 255, 255, 30), w=2)
    for k in range(6):
        a = math.radians(60 * k)
        p.circle(800 + (R * 2 + 130) * math.cos(a), 450 + (R * 2 + 130) * math.sin(a), 9, fill=(255, 255, 255, 190))
    for cx, cy in centers:
        p.circle(cx, cy, 8, fill=(255, 255, 255, 235))
    art.put(L)
    return art.img


def theme_rosette(seed=77):
    """Stained-glass rosette and pointed arch: theology, reflection."""
    base = gradient(W * S, H * S, [(0, "#100b26"), (0.55, "#241651"), (1, "#3a1d5e")], 80)
    art = Art(base)
    cx, cy = 800, 470
    glow = radial_glow(W, H, cx, cy, 560, hx("#9a7bff"), 0.34)
    art.add_light(np.asarray(Image.fromarray(np.clip(glow, 0, 255).astype(np.uint8)).resize((W * S, H * S), Image.BICUBIC)).astype(np.float32))
    # pointed arches
    L, p = art.layer()
    for w0, a in ((330, 150), (380, 90), (430, 50)):
        pts = [(cx - w0, 880), (cx - w0, 460)]
        for i in range(0, 41):
            t = math.radians(180 - 60 * i / 40)
            pts.append((cx + w0 + 2 * w0 * math.cos(t), 460 - 2 * w0 * math.sin(t)))
        for i in range(0, 41):
            t = math.radians(60 - 60 * i / 40)
            pts.append((cx - w0 + 2 * w0 * math.cos(t), 460 - 2 * w0 * math.sin(t)))
        pts += [(cx + w0, 460), (cx + w0, 880)]
        p.line(pts, (190, 170, 255, a), 3)
    art.put(L)
    # petals
    n = 12
    for k in range(n):
        h = k / n
        r, g, b = colorsys.hsv_to_rgb(h, 0.55, 1.0)
        col = (int(r * 255), int(g * 255), int(b * 255))
        a = 2 * math.pi * k / n
        L, p = art.layer()
        p.ellipse(cx + 135 * math.cos(a), cy + 135 * math.sin(a), 135, 52, a, fill=col + (92,), outline=col + (230,), w=2.5)
        art.put(L)
    for k in range(n):
        h = (k + 0.5) / n
        r, g, b = colorsys.hsv_to_rgb(h, 0.35, 1.0)
        col = (int(r * 255), int(g * 255), int(b * 255))
        a = 2 * math.pi * (k + 0.5) / n
        L, p = art.layer()
        p.ellipse(cx + 255 * math.cos(a), cy + 255 * math.sin(a), 52, 20, a, fill=col + (70,), outline=col + (200,), w=2)
        art.put(L)
    L, p = art.layer()
    for r, a in ((70, 200), (300, 90), (330, 60), (360, 40)):
        p.circle(cx, cy, r, outline=(235, 225, 255, a), w=2)
    for k in range(48):
        t = 2 * math.pi * k / 48
        p.line([(cx + 70 * math.cos(t), cy + 70 * math.sin(t)), (cx + 300 * math.cos(t), cy + 300 * math.sin(t))],
               (235, 225, 255, 28), 1.2)
    art.put(L)
    G, g = art.layer()
    g.circle(cx, cy, 30, fill=(255, 245, 220, 255))
    art.put(G, blur=22)
    L, p = art.layer()
    p.circle(cx, cy, 24, fill=(255, 250, 235, 255))
    art.put(L)
    return art.img


def theme_bubbles(seed=88):
    """Overlapping speech bubbles drawn as shapes, without text."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#0c3d4f"), (0.55, "#146e75"), (1, "#2fa59a")], 30)
    art = Art(base)
    L, p = art.layer()
    for r in range(90, 900, 90):
        p.circle(1450, 800, r, outline=(255, 255, 255, 26), w=1.5)
    art.put(L)

    def bubble(x, y, w0, h0, col, tail, a=205, dots=None, waves=False):
        L, p = art.layer()
        tx = x + (w0 * 0.25 if tail == "l" else w0 * 0.75)
        tri = [(tx - 26, y + h0 - 2), (tx + 30, y + h0 - 2), (tx - 40 if tail == "l" else tx + 44, y + h0 + 62)]
        p.rect(x, y, x + w0, y + h0, fill=hx(col, a), r=h0 * 0.28)
        p.poly(tri, fill=hx(col, a))
        art.put(L)
        L, p = art.layer()
        cxm, cym = x + w0 / 2, y + h0 / 2
        if dots:
            for i in range(dots):
                p.circle(cxm + (i - (dots - 1) / 2) * 44, cym, 11, fill=(12, 61, 79, 150))
        if waves:
            for i, hh in enumerate([14, 30, 52, 34, 62, 40, 22, 46, 28, 12]):
                xx = cxm + (i - 4.5) * 24
                p.round_line([(xx, cym - hh), (xx, cym + hh)], (12, 61, 79, 140), 10)
        art.put(L)

    bubble(150, 120, 520, 250, "#ff8a65", "l", dots=3)
    bubble(480, 250, 560, 270, "#ffe3b0", "r", waves=True)
    bubble(900, 110, 480, 230, "#4dd8cc", "l", dots=3, a=225)
    bubble(1010, 440, 470, 250, "#c3b1f0", "r", waves=True)
    bubble(260, 560, 480, 210, "#fff6e5", "l", a=215, dots=3)
    bubble(760, 640, 300, 140, "#ff8a65", "r", a=215)
    # small accent bubbles
    L, p = art.layer()
    for x, y, r, col in ((90, 430, 26, "#ffe3b0"), (1500, 330, 20, "#ffe3b0"), (1480, 130, 14, "#ff8a65"), (740, 120, 16, "#c3b1f0")):
        p.circle(x, y, r, fill=hx(col, 210))
    art.put(L)
    return art.img


def leaf_pts(x, y, ang, length, width):
    pts = []
    n = 24
    for i in range(n + 1):
        t = i / n
        off = width * math.sin(math.pi * t) ** 0.85 * (1 - 0.25 * t)
        pts.append((t * length, off))
    for i in range(n, -1, -1):
        t = i / n
        off = width * math.sin(math.pi * t) ** 0.85 * (1 - 0.25 * t)
        pts.append((t * length, -off))
    c, s = math.cos(ang), math.sin(ang)
    return [(x + px * c - py * s, y + px * s + py * c) for px, py in pts]


def theme_bioeconomy(seed=99):
    """Branches with leaves, tree rings and seeds."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#07261f"), (0.55, "#14573f"), (1, "#4f8f4a")], 40)
    art = Art(base)
    # rings
    L, p = art.layer()
    for r in range(40, 760, 26):
        p.circle(1330, 760, r, outline=(255, 232, 150, max(18, int(90 - r * 0.09))), w=1.8)
    art.put(L)
    # branches
    branches = []
    for k in range(5):
        x0 = -40 + k * 40
        y0 = 800 - k * 90
        pts = []
        for t in np.linspace(0, 1, 40):
            x = x0 + t * (900 + k * 70)
            y = y0 - 300 * t - 60 * math.sin(t * 5 + k) - k * 30 * t
            pts.append((x, y))
        branches.append(pts)
    leaf_cols = ["#8fd16b", "#5fb35a", "#c8e58a", "#3f9a5b", "#e8d36a"]
    for k, pts in enumerate(branches):
        L, p = art.layer()
        p.line(pts, hx("#d9c98a", 160), 3.5)
        art.put(L)
        for i in range(3, len(pts) - 1, 3):
            x, y = pts[i]
            dx, dy = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
            ang0 = math.atan2(dy, dx)
            for side in (-1, 1):
                ang = ang0 + side * (0.75 + float(rng.uniform(-0.2, 0.2)))
                ln = float(rng.uniform(70, 130)) * (0.6 + i / len(pts) * 0.6)
                L, p = art.layer()
                col = leaf_cols[int(rng.integers(0, len(leaf_cols)))]
                pts_l = leaf_pts(x, y, ang, ln, ln * 0.25)
                p.poly(pts_l, fill=hx(col, 190), outline=hx("#eaffd0", 200), w=1.5)
                p.line([(x, y), (x + ln * 0.95 * math.cos(ang), y + ln * 0.95 * math.sin(ang))], hx("#eaffd0", 160), 1.5)
                art.put(L)
    # seeds
    L, p = art.layer()
    G, g = art.layer()
    for _ in range(60):
        x, y = float(rng.uniform(0, W)), float(rng.uniform(0, H))
        r = float(rng.uniform(3, 8))
        p.circle(x, y, r, fill=hx("#ffe58a", 220))
        g.circle(x, y, r + 5, fill=hx("#ffe58a", 120))
    art.put(G, blur=6)
    art.put(L)
    return art.img


def theme_gis(seed=101):
    """Contour lines and a coastline: geographic information."""
    f = value_noise(W, H, 420, seed, 5)
    ramp = np.linspace(0.0, 1.0, W, dtype=np.float32)[None, :]
    field = 0.62 * f + 0.55 * ramp * (1 - 0.15 * f) + 0.08 * np.linspace(1, 0, H, dtype=np.float32)[:, None]
    field = (field - field.min()) / (field.max() - field.min())
    sea = 0.50
    # contours
    step = 0.035
    band = (field - sea) / step
    gy, gx = np.gradient(band)
    gm = np.maximum(np.hypot(gx, gy), 1e-4)
    frac = band - np.floor(band)
    dist = np.minimum(frac, 1 - frac) / gm  # distance in px to the nearest contour
    line = np.clip(1.3 - dist, 0, 1)
    idx = np.floor(band + 0.5).astype(int)
    index_line = line * (np.abs(np.round(band)) % 5 == 0)
    # coastline distance
    cg = np.maximum(np.hypot(*np.gradient(field - sea)), 1e-5)
    coast = np.clip(2.2 - np.abs(field - sea) / cg, 0, 1)
    land = field > sea
    out = np.zeros((H, W, 3), np.float32)
    # land colour by elevation: sand -> green -> grey-brown
    e = np.clip((field - sea) / (1 - sea), 0, 1)
    c0, c1, c2 = np.array([226, 214, 170.]), np.array([142, 178, 120.]), np.array([128, 112, 96.])
    t1 = np.clip(e / 0.35, 0, 1)[..., None]
    t2 = np.clip((e - 0.35) / 0.65, 0, 1)[..., None]
    landc = c0 * (1 - t1) + c1 * t1
    landc = landc * (1 - t2) + c2 * t2
    # sea colour by depth
    d = np.clip((sea - field) / sea, 0, 1)[..., None]
    s0, s1 = np.array([112, 190, 205.]), np.array([14, 58, 102.])
    seac = s0 * (1 - np.clip(d / 0.8, 0, 1)) + s1 * np.clip(d / 0.8, 0, 1)
    out = np.where(land[..., None], landc, seac)
    # contour lines
    lc_land = np.array([88, 76, 58.])
    lc_sea = np.array([210, 240, 250.])
    out = np.where(land[..., None],
                   out * (1 - 0.45 * line[..., None]) + lc_land * 0.45 * line[..., None],
                   out * (1 - 0.30 * line[..., None]) + lc_sea * 0.30 * line[..., None])
    out = np.where(land[..., None], out * (1 - 0.35 * index_line[..., None]), out * (1 - 0.2 * index_line[..., None]) + 0.2 * index_line[..., None] * lc_sea)
    # foam / coast line
    out = out * (1 - 0.9 * coast[..., None]) + np.array([252, 250, 240.]) * 0.9 * coast[..., None]
    # shade the land a little
    sh = np.gradient(field, axis=1) * 90
    out[land] += sh[land][:, None]
    # graticule
    grat = np.zeros((H, W), np.float32)
    for x in range(100, W, 200):
        grat[:, x] = 1
    for y in range(50, H, 200):
        grat[y, :] = 1
    grat = np.asarray(Image.fromarray((grat * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255
    out = out * (1 - 0.28 * grat[..., None]) + 255 * 0.28 * grat[..., None]
    # markers (points of interest)
    art = Art(out)
    rng = np.random.default_rng(seed)
    L, p = art.layer()
    G, g = art.layer()
    placed = 0
    while placed < 7:
        x, y = float(rng.uniform(120, W - 120)), float(rng.uniform(100, H - 100))
        if field[int(y), int(x)] > sea + 0.03:
            p.circle(x, y, 9, fill=hx("#e8453c"), outline=(255, 255, 255, 255), w=3)
            g.circle(x, y, 18, fill=hx("#e8453c", 150))
            placed += 1
    art.put(G, blur=6)
    art.put(L)
    return art.img


def theme_ai_ethics(seed=111):
    """Halftone lens, two overlapping circles: balance between views."""
    rng = np.random.default_rng(seed)
    base = gradient(W * S, H * S, [(0, "#10163a"), (0.5, "#1d1c52"), (1, "#2c1b4a")], 20)
    art = Art(base)
    ca, cb, R = (640, 450), (960, 450), 290
    L, p = art.layer()
    sp = 24
    for row, y in enumerate(np.arange(20, H, sp * 0.866)):
        for x in np.arange(10 + (sp / 2 if row % 2 else 0), W, sp):
            da = math.hypot(x - ca[0], y - ca[1])
            db = math.hypot(x - cb[0], y - cb[1])
            ina, inb = da < R, db < R
            edge = min(abs(da - R), abs(db - R))
            if ina and inb:
                col, r = (255, 255, 255, 240), 4.8
            elif ina:
                col, r = hx("#3ad1e0", 235), 3.4
            elif inb:
                col, r = hx("#ff9f45", 235), 3.4
            else:
                col, r = (150, 160, 220, 80), 1.6 + max(0, 2.2 - edge / 60)
            p.circle(x, y, r, fill=col)
    art.put(L)
    L, p = art.layer()
    p.circle(*ca, R, outline=hx("#3ad1e0", 210), w=3)
    p.circle(*cb, R, outline=hx("#ff9f45", 210), w=3)
    # balance beam through the centre
    p.line([(330, 450), (1270, 450)], (255, 255, 255, 120), 2)
    p.poly([(800, 470), (772, 520), (828, 520)], fill=(255, 255, 255, 180))
    art.put(L)
    # connecting nodes
    L, p = art.layer()
    G, g = art.layer()
    nodes = [(640, 450), (800, 330), (800, 570), (960, 450), (800, 450), (560, 300), (1040, 610), (560, 600), (1040, 300)]
    for a, b in ((0, 1), (0, 2), (3, 1), (3, 2), (4, 1), (4, 2), (0, 4), (4, 3), (5, 0), (6, 3), (7, 0), (8, 3)):
        p.line([nodes[a], nodes[b]], (255, 255, 255, 190), 2.4)
    for i, (x, y) in enumerate(nodes):
        r = 11 if i == 4 else 8
        p.circle(x, y, r, fill=(255, 255, 255, 255))
        g.circle(x, y, r + 8, fill=(255, 255, 255, 120))
    art.put(G, blur=8)
    art.put(L)
    return art.img


THEMES = {
    "data_ethics": theme_data_ethics,
    "ecosystems": theme_ecosystems,
    "heritage": theme_heritage,
    "manufacturing": theme_manufacturing,
    "mobility": theme_mobility,
    "social": theme_social,
    "rosette": theme_rosette,
    "bubbles": theme_bubbles,
    "bioeconomy": theme_bioeconomy,
    "gis": theme_gis,
    "ai_ethics": theme_ai_ethics,
}

# The example alliance: slug -> course_code -> theme
EXAMPLE = {
    "northvale": {"EXA-NOR-DATA-ETHICS": "data_ethics", "EXA-NOR-NORTHERN-ECOSYSTEMS": "ecosystems"},
    "southmere": {"EXA-SOU-HERITAGE-IDENTITIES": "heritage"},
    "eastbrook": {"EXA-EAS-SMART-MANUFACTURING": "manufacturing"},
    "westmark": {"EXA-WES-URBAN-MOBILITY": "mobility"},
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--theme", choices=sorted(THEMES), help="draw one theme only")
    ap.add_argument("--out", type=Path, help="output file (with --theme)")
    ap.add_argument("--map", type=Path, help="JSON {organization slug: {course code: theme}} instead of the example alliance")
    ap.add_argument("--out-dir", type=Path, help="root folder of the <slug>/<course_code>.jpg files (default: next to this script)")
    args = ap.parse_args(argv)
    if args.theme:
        if not args.out:
            ap.error("--theme needs --out")
        finish(THEMES[args.theme](), args.out, seed=hash_seed(args.theme))
        return 0
    here = args.out_dir or Path(__file__).resolve().parent
    mapping = json.loads(args.map.read_text(encoding="utf-8")) if args.map else EXAMPLE
    for slug, courses in mapping.items():
        for code, theme in courses.items():
            out = here / slug / f"{code}.jpg"
            finish(THEMES[theme](), out, seed=hash_seed(theme))
            print(f"{slug}/{code}.jpg", out.stat().st_size // 1024, "KB")
    return 0


def hash_seed(name: str) -> int:
    return sum((i + 1) * ord(c) for i, c in enumerate(name))


if __name__ == "__main__":
    sys.exit(main())
