"""通用方块模型的离线检查。

护甲和手持物各有自己的断言，生物走七道几何门。这三道补的是「一堆方块」
本身：box-UV 矩形互相盖住、方块（含旋转）互不接触、骨骼图里有环。
只读已经写好的 .bbmodel，不生成、不改文件。
"""

from __future__ import annotations

import math
from typing import Iterable


FACE_ORDER = ("east", "north", "west", "south", "up", "down")
# 面名 → (法线轴, uv 的 u 沿哪根模型轴, uv 的 v 沿哪根模型轴)。
FACE_AXES = {
    "east": (0, 2, 1), "west": (0, 2, 1),
    "north": (2, 0, 1), "south": (2, 0, 1),
    "up": (1, 0, 2), "down": (1, 0, 2),
}


def box_uv_size(size: Iterable[float]) -> tuple[int, int]:
    """标准 box-UV 十字展开的宽高：宽 = 2d+2w，高 = d+h。"""
    w, h, d = (abs(float(v)) for v in size)
    return math.ceil(2 * d + 2 * w), math.ceil(d + h)


def box_uv_rects(offset: Iterable[float], size: Iterable[float]) -> dict[str, tuple[int, int, int, int]]:
    """一个 uv_offset 展开成六面的 (x, y, w, h)。顺序与 Blockbench box-UV 一致。

    边长取整：这是 Bedrock box UV 的像素网格。逐面 UV 要用 per_face_rects，
    小数边长取整后同一面两轴的像素密度会差出 1.5 倍以上。
    """
    u, v = (int(round(float(x))) for x in list(offset)[:2])
    w, h, d = (max(0, int(round(abs(float(x))))) for x in size)
    return {
        "up": (u + d, v, w, d),
        "down": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def per_face_rects(offset: Iterable[float], size: Iterable[float]) -> dict[str, tuple[float, float, float, float]]:
    """按真实边长展开六面。布局与 box_uv_rects 相同，整数尺寸结果一致。

    每条边单独取最近的整数像素，且至少 1。六条边用同一个取整，不能先取整再相加：
    0.8 和 1.5 若分别收成 1 和 2，贴图上的密度比就是 2.5 倍，uv_density 会失败。
    """
    u, v = (float(x) for x in list(offset)[:2])
    w, h, d = (max(1.0, float(round(abs(float(x))))) for x in size)
    return {
        "up": (u + d, v, w, d),
        "down": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def _face_rects(element: dict) -> list[tuple[str, int, int, int, int]]:
    """一个方块真正采样的矩形。box-UV 是十字的六面；逐面 UV 只算写了 uv 的面。

    不用六面的外接矩形：展开图中间的空隙可以放另一块的面，外接矩形会把这种排版误报成重叠。
    """
    if element.get("type", "cube") != "cube":
        return []
    if element.get("box_uv"):
        size = [abs(element["to"][i] - element["from"][i]) for i in range(3)]
        offset = element.get("uv_offset") or [0, 0]
        return [
            (face, *rect)
            for face, rect in box_uv_rects(offset, size).items()
            if rect[2] > 0 and rect[3] > 0
        ]
    out = []
    for face_name, face in (element.get("faces") or {}).items():
        uv = face.get("uv") if isinstance(face, dict) else None
        if isinstance(uv, list) and len(uv) == 4:
            x0, y0, x1, y1 = (float(v) for v in uv)
            w, h = abs(x1 - x0), abs(y1 - y0)
            if w > 0 and h > 0:
                out.append((str(face_name), int(round(min(x0, x1))), int(round(min(y0, y1))),
                            int(round(w)), int(round(h))))
    return out


def _overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> tuple[int, int]:
    ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return ox, oy


def uv_overlaps(model: dict) -> list[str]:
    """两块方块真正采样的面矩形相交。后画的会盖住先画的，读起来像贴图串到了别的零件上。"""
    cubes: list[tuple[str, list[tuple[str, int, int, int, int]]]] = []
    for element in model.get("elements") or []:
        rects = _face_rects(element)
        if rects:
            cubes.append((str(element.get("name") or element.get("uuid")), rects))
    out: list[str] = []
    for i, (name_a, faces_a) in enumerate(cubes):
        for name_b, faces_b in cubes[i + 1:]:
            for face_a, *box_a in faces_a:
                for face_b, *box_b in faces_b:
                    ox, oy = _overlap(tuple(box_a), tuple(box_b))  # type: ignore[arg-type]
                    if ox > 0 and oy > 0:
                        out.append(
                            f"{name_a}.{face_a} 的 UV {box_a[2]}x{box_a[3]} @({box_a[0]},{box_a[1]}) 与 "
                            f"{name_b}.{face_b} 的 {box_b[2]}x{box_b[3]} @({box_b[0]},{box_b[1]}) 重叠 {ox}x{oy}"
                        )
    return out


def uv_outside(model: dict) -> list[str]:
    """面矩形越出 resolution。采样时会绕回或采到空像素。没有 resolution 时不查。"""
    res = model.get("resolution") or {}
    width, height = res.get("width"), res.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        return []
    out: list[str] = []
    for element in model.get("elements") or []:
        name = str(element.get("name") or element.get("uuid"))
        for face, x, y, w, h in _face_rects(element):
            if x < 0 or y < 0 or x + w > width or y + h > height:
                out.append(f"{name}.{face} 的 UV {w}x{h} @({x},{y}) 越出 {width}x{height}")
    return out


def _rotated_aabb(element: dict) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """方块八个角绕 origin 转完之后的轴对齐包围盒。"""
    frm, to = element["from"], element["to"]
    rot = element.get("rotation") or (0.0, 0.0, 0.0)
    org = element.get("origin") or [(frm[i] + to[i]) / 2 for i in range(3)]
    corners = [(x, y, z) for x in (frm[0], to[0]) for y in (frm[1], to[1]) for z in (frm[2], to[2])]
    if any(rot):
        rx, ry, rz = (math.radians(float(a)) for a in rot)
        cx, sx = math.cos(rx), math.sin(rx)
        cy, sy = math.cos(ry), math.sin(ry)
        cz, sz = math.cos(rz), math.sin(rz)
        spun = []
        for p in corners:
            x, y, z = (p[i] - org[i] for i in range(3))
            y, z = y * cx - z * sx, y * sx + z * cx
            x, z = x * cy + z * sy, -x * sy + z * cy
            x, y = x * cz - y * sz, x * sz + y * cz
            spun.append((x + org[0], y + org[1], z + org[2]))
        corners = spun
    lo = tuple(min(c[i] for c in corners) for i in range(3))
    hi = tuple(max(c[i] for c in corners) for i in range(3))
    return lo, hi  # type: ignore[return-value]


def _touch(a, b, tol: float) -> bool:
    return all(a[0][i] <= b[1][i] + tol and b[0][i] <= a[1][i] + tol for i in range(3))


def disconnected(model: dict, tol: float = 0.05, detached: Iterable[str] = ()) -> list[str]:
    """不跟任何其它方块接触的方块，以及脱离主体的连通块。

    `detached` 里的名字是故意悬空的（光环、浮石），不报。
    返回的第一条是完全孤立的方块；后面是「自己连着、但没连上最大那块」的组。
    """
    skip = set(detached)
    boxes = []
    for element in model.get("elements") or []:
        if element.get("type", "cube") != "cube":
            continue
        name = str(element.get("name") or element.get("uuid"))
        if name in skip:
            continue
        boxes.append((name, _rotated_aabb(element)))
    n = len(boxes)
    if n < 2:
        return []
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if _touch(boxes[i][1], boxes[j][1], tol):
                parent[find(i)] = find(j)
    groups: dict[int, list[str]] = {}
    for i, (name, _) in enumerate(boxes):
        groups.setdefault(find(i), []).append(name)
    islands = sorted(groups.values(), key=len, reverse=True)
    out: list[str] = []
    for island in islands:
        if len(island) == 1 and len(islands) > 1:
            out.append(f"{island[0]} 不与任何方块接触")
    if len(islands) > 1:
        extras = [", ".join(island[:4]) for island in islands[1:] if len(island) > 1]
        if extras:
            out.append(f"模型分成 {len(islands)} 块，未连上主体的有：{'; '.join(extras)}")
    return out


def bone_cycles(model: dict) -> list[str]:
    """outliner 里组套组形成的环。有环时骨骼动画的父链无法拓扑排序。"""
    parent: dict[str, str | None] = {}

    def walk(nodes, owner: str | None) -> None:
        for node in nodes or []:
            if isinstance(node, dict):
                name = str(node.get("name") or node.get("uuid"))
                parent[name] = owner
                walk(node.get("children"), name)

    walk(model.get("outliner"), None)
    seen: set[str] = set()
    out: list[str] = []
    for start in parent:
        if start in seen:
            continue
        trail: list[str] = []
        cursor: str | None = start
        local: set[str] = set()
        while cursor is not None and cursor not in seen:
            if cursor in local:
                ring = trail[trail.index(cursor):] + [cursor]
                out.append("骨骼环：" + " -> ".join(ring))
                break
            local.add(cursor)
            trail.append(cursor)
            cursor = parent.get(cursor)
        seen.update(local)
    return out


def uv_density(model: dict, ratio: float = 1.5) -> list[str]:
    """一个面上横向和纵向的「像素 / 模型单位」差太多。

    差到 `ratio` 倍时，圆会变成椭圆，格子会变成条纹。没有 uv 的面不查。
    密度是 sampled_pixels / surface_length，两边都要有长度才比。
    """
    out: list[str] = []
    for element in model.get("elements") or []:
        if element.get("type", "cube") != "cube":
            continue
        name = str(element.get("name") or element.get("uuid"))
        frm, to = element.get("from"), element.get("to")
        if not (isinstance(frm, list) and isinstance(to, list)):
            continue
        size = [abs(float(to[i]) - float(frm[i])) for i in range(3)]
        for face_name, face in (element.get("faces") or {}).items():
            axes = FACE_AXES.get(face_name)
            uv = face.get("uv") if isinstance(face, dict) else None
            if axes is None or not (isinstance(uv, list) and len(uv) == 4):
                continue
            span_u, span_v = size[axes[1]], size[axes[2]]
            if span_u <= 0 or span_v <= 0:
                continue
            du, dv = abs(float(uv[2]) - float(uv[0])), abs(float(uv[3]) - float(uv[1]))
            if du <= 0 or dv <= 0:
                continue
            density_u, density_v = du / span_u, dv / span_v
            if max(density_u, density_v) > min(density_u, density_v) * ratio:
                out.append(
                    f"{name}.{face_name} 的贴图像素密度 u={density_u:.2f} v={density_v:.2f}，"
                    f"相差超过 {ratio:g} 倍"
                )
    return out


def coplanar_faces(model: dict, tol: float = 1e-6) -> list[str]:
    """两块方块的外表面落在同一平面，并且在另外两轴上有面积重叠。

    渲染器对同深度的两个面没有稳定取舍，逐像素乱选，看起来像贴图脏了。
    只擦到一条边不算，那是正常拼接。旋转过的方块不在这道检查里：
    它的面不再是轴对齐的，包围盒会把没碰到的也算进去。
    """
    cubes = []
    for element in model.get("elements") or []:
        if element.get("type", "cube") != "cube" or element.get("rotation"):
            continue
        frm, to = element.get("from"), element.get("to")
        if isinstance(frm, list) and isinstance(to, list):
            cubes.append((str(element.get("name") or element.get("uuid")),
                          tuple(float(v) for v in frm), tuple(float(v) for v in to)))
    out: list[str] = []
    for i, (name_a, a0, a1) in enumerate(cubes):
        for name_b, b0, b1 in cubes[i + 1:]:
            for axis in range(3):
                others = [k for k in range(3) if k != axis]
                area = 1.0
                for k in others:
                    area *= max(0.0, min(a1[k], b1[k]) - max(a0[k], b0[k]))
                if area <= 1e-4:
                    continue
                for side, av, bv in (("max", a1[axis], b1[axis]), ("min", a0[axis], b0[axis])):
                    if abs(av - bv) <= tol:
                        out.append(
                            f"{name_a} 与 {name_b} 的 {'xyz'[axis]}-{side} 面共面于 {av:g}，"
                            f"投影重叠 {area:.4g}"
                        )
    return out
