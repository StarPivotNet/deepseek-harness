"""按材质把一张贴图涂出来。

模型只声明每个方块的颜色和材质名。这里把它画成像素：每面一圈暗边、
左上受光的倒角，再加上材质自己的明暗。没有贴图文件也能看出金属、木头、石头。

材质函数移植自离线转换器里的确定性着色（亮度乘子，不是照片）。
发光材质可以出竖条多帧，帧与帧只差相位，几何不动。
"""

from __future__ import annotations

import colorsys
import math
from typing import Callable

from PIL import Image


Shader = Callable[[int, int, int, int, float], float]

MATERIALS = (
    "flat", "metal", "wood", "stone", "cloth", "leather", "gem", "glow", "bone", "scale",
)

FACE_SHADE = {"up": 1.14, "down": 0.72, "north": 1.0, "south": 0.88, "east": 0.94, "west": 0.94}


def _noise(x: int, y: int, seed: int = 0) -> float:
    n = math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
    return n - math.floor(n)


def _step(value: float, steps: int) -> float:
    return round(value * steps) / steps


def _shader(name: str) -> Shader:
    def flat(x, y, w, h, phase):
        return 1.0

    def metal(x, y, w, h, phase):
        along_y = h >= w
        across = (x + 0.5) / w if along_y else (y + 0.5) / h
        specular = max(0.0, 1 - abs(across - 0.34) * 3.4)
        shade = 0.86 if across > 0.82 else 1.0
        return (1 + _step(specular, 4) * 0.34) * shade * (0.97 + _noise(x, y) * 0.06)

    def wood(x, y, w, h, phase):
        along_y = h >= w
        across = x if along_y else y
        along = y if along_y else x
        grain = math.sin((across + math.sin(along * 0.7) * 0.6) * 2.1)
        line = 0.84 if grain > 0.55 else 0.92 if grain < -0.6 else 1.04
        return line * (0.97 + _noise(x, y, 1) * 0.06)

    def stone(x, y, w, h, phase):
        cell = _noise(x // 2, y // 2, 2)
        return (0.9 if cell < 0.35 else 1.06 if cell > 0.75 else 1.0)

    def cloth(x, y, w, h, phase):
        weave = 0.94 if (x + y) % 2 == 0 else 1.04
        return weave * (0.98 + _noise(x, y, 3) * 0.04)

    def leather(x, y, w, h, phase):
        crease = math.sin(x * 0.9) * math.sin(y * 0.4)
        line = 0.9 if crease > 0.6 else 1.0
        return line * (0.97 + _noise(x, y, 4) * 0.05)

    def gem(x, y, w, h, phase):
        facet = _noise(x // 3, y // 3, 5)
        return 1.18 if facet > 0.72 else 0.86 if facet < 0.28 else 1.0

    def glow(x, y, w, h, phase):
        band = 0.5 + 0.5 * math.sin((y / max(h, 1)) * math.tau + phase * math.tau)
        return 0.85 + _step(band, 4) * 0.3

    def bone(x, y, w, h, phase):
        ridge = 0.94 if abs(((x + y) % 5) - 2) <= 0 else 1.04
        return ridge * (0.98 + _noise(x, y, 6) * 0.03)

    def scale(x, y, w, h, phase):
        row = (y // 2) % 2
        col = ((x + row) // 3) % 2
        return 0.9 if col else 1.06

    return {
        "flat": flat, "metal": metal, "wood": wood, "stone": stone, "cloth": cloth,
        "leather": leather, "gem": gem, "glow": glow, "bone": bone, "scale": scale,
    }.get(name, flat)


def _clamp_byte(value: float) -> int:
    return max(0, min(255, int(round(value))))


def paint_face(image: Image.Image, rect: tuple[float, float, float, float], color: tuple[int, int, int],
               face: str, material: str = "flat", phase: float = 0.0,
               bevel: bool = True) -> None:
    """把一个面涂进图里。rect 是 (x, y, w, h)，允许小数；没有被矩形覆盖到的像素不画。"""
    x0, y0, w, h = (float(v) for v in rect)
    if w <= 0 or h <= 0:
        return
    shade = FACE_SHADE.get(face, 1.0)
    shader = _shader(material)
    px = image.load()
    x_lo, y_lo = int(math.floor(x0)), int(math.floor(y0))
    x_hi, y_hi = int(math.ceil(x0 + w)), int(math.ceil(y0 + h))
    span_w, span_h = max(x_hi - x_lo, 1), max(y_hi - y_lo, 1)
    for gy in range(y_lo, y_hi):
        for gx in range(x_lo, x_hi):
            if gx < 0 or gy < 0 or gx >= image.width or gy >= image.height:
                continue
            if gx + 1 <= x0 or gy + 1 <= y0 or gx >= x0 + w or gy >= y0 + h:
                continue
            x, y = gx - x_lo, gy - y_lo
            factor = shade * shader(x, y, span_w, span_h, phase)
            if bevel and span_w >= 3 and span_h >= 3:
                edge = x == 0 or y == 0 or x == span_w - 1 or y == span_h - 1
                if edge:
                    factor *= 0.72
                elif x == 1 or y == 1:
                    factor *= 1.16
                elif x == span_w - 2 or y == span_h - 2:
                    factor *= 0.9
            r, g, b = (_clamp_byte(c * factor) for c in color)
            px[gx, gy] = (r, g, b, 255)


def paint_sheet(width: int, height: int, faces: list[dict], frames: int = 1) -> Image.Image:
    """按面列表涂一张图。每一项要有 rect、color、face，可选 material。

    frames > 1 且存在 glow 时，输出竖条 height*frames。没有 glow 时退回一帧，
    避免空动画把贴图拉高。
    """
    glowing = any(item.get("material") == "glow" for item in faces)
    count = frames if frames > 1 and glowing else 1
    image = Image.new("RGBA", (width, height * count), (0, 0, 0, 0))
    for frame in range(count):
        phase = frame / count if count > 1 else 0.0
        for item in faces:
            x, y, w, h = item["rect"]
            paint_face(
                image, (x, y + frame * height, w, h), tuple(item["color"]),
                item.get("face", "north"), item.get("material", "flat"), phase,
            )
    return image


def swatch_row(materials: tuple[str, ...] = MATERIALS, size: int = 16) -> Image.Image:
    """每种材质一个色块，用来一眼核对着色没有退回纯色。"""
    image = Image.new("RGBA", (size * len(materials), size), (0, 0, 0, 0))
    for i, name in enumerate(materials):
        hue = i / len(materials)
        r, g, b = colorsys.hsv_to_rgb(hue, 0.45, 0.8)
        paint_face(image, (i * size, 0, size, size),
                   (_clamp_byte(r * 255), _clamp_byte(g * 255), _clamp_byte(b * 255)),
                   "north", name, bevel=False)
    return image
