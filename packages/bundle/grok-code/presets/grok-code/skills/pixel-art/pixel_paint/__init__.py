"""任意宽高的像素贴图。入口是 paint。"""

from pixel_paint.paint import (
    FACE_SHADE,
    MATERIALS,
    clamp_byte,
    dot,
    fill_rect,
    new_image,
    paint_face,
    paint_sheet,
    swatch_row,
)

__all__ = [
    "FACE_SHADE",
    "MATERIALS",
    "clamp_byte",
    "dot",
    "fill_rect",
    "new_image",
    "paint_face",
    "paint_sheet",
    "swatch_row",
]
