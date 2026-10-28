---
name: pixel-art
description: "Use when painting a pixel image at any width and height: a texture, a sprite, a swatch row, or a glow strip. One Python library. Not a .bbmodel, not a web page, and not a vector graphic."
---

# Pixel art

Paint the image in Python with `pixel_paint`. Do not open Blockbench, do not import `bbmodel_maker`, and do not reach for a canvas site. A `.bbmodel` is `blockbench`. A web page is `frontend-design`.

The library is `pixel_paint` in this skill directory. It needs Python 3.11 or newer and `pillow`. On this machine `python` and `py -3.11` are both Python 3.11.0. If `python --version` is older than 3.11, use `py -3.11`.

```powershell
$env:PYTHONPATH = Join-Path $env:DSH_HOME ".agent-presets\dsh-grok-agi\skills\pixel-art"
```

The import root is the skill directory itself, the base directory the skill tool reports. `pwsh -Command` leaves PSScriptRoot empty, so the example joins `$env:DSH_HOME`. Set it before importing `pixel_paint`. Width and height are whatever the picture needs. There is no 16, no power of two, and no square requirement. A 3×17 image is valid. A size below 1×1 raises `ValueError`.

The background is transparent. A pixel you do not paint stays alpha 0.

## Paint

```python
from pixel_paint import new_image, paint_face, paint_sheet, dot, fill_rect

image = new_image(48, 32)
paint_face(image, (2, 2, 20, 14), (146, 144, 136), face="north", material="stone")
image.save(path)
```

`paint_face(image, rect, color, face="north", material="flat", phase=0.0, bevel=True)` paints one rectangle. `rect` is `(x, y, w, h)` and may be fractional; a pixel the rectangle does not cover is left alone. `color` is `(r, g, b)`.

`face` only picks a brightness: `up` 1.14, `north` 1.0, `east`/`west` 0.94, `south` 0.88, `down` 0.72. An unknown face is 1.0. It does not place the rectangle.

`material` is one of `flat`, `metal`, `wood`, `stone`, `cloth`, `leather`, `gem`, `glow`, `bone`, `scale`. An unknown name paints as `flat`. Each material is a brightness pattern on the given color, not a photograph. `metal` is a band of highlight, `wood` is grain, `stone` is cells, `cloth` is a weave, `leather` is creases, `gem` is facets, `bone` is ridges, `scale` is offset rows. `glow` shifts with `phase` in `0..1`.

Bevel draws a dark outer pixel, a lit inner corner, and a darker far edge, and only when both sides are at least 3 pixels. A 1- or 2-pixel mark stays the color you passed. Pass `bevel=False` for a flat material swatch.

`paint_sheet(width, height, faces, frames=1)` paints a list. Each item needs `rect` and `color`, and may set `face` and `material`. `frames > 1` grows a vertical strip of `height * frames` only when some item is `glow`. Without `glow` the extra frames are dropped, so an empty animation does not stretch the image. Frame `i` uses `phase = i / frames`.

`dot(image, x, y, color)` paints one pixel and ignores coordinates outside the image. `fill_rect(image, x, y, w, h, color)` paints a solid rectangle, clipped to the image. A 3-channel color becomes opaque.

`swatch_row(materials, size=16)` paints one cell per material. Use it to check that a material did not collapse to a single color.

## Draw

A mark thinner than 2 pixels does not read. Put a cross, a letter, or a seam on with `dot` after the material pass, on the rectangle you just painted. Do not expect the material shader to draw a symbol.

Save PNG. Name the path, the size, and which materials landed on which rectangles. The picture is done when the file exists, its size is the size you asked for, and every rectangle you named has opaque pixels inside it.
