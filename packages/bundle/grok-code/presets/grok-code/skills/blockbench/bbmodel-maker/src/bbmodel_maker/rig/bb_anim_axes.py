#!/usr/bin/env python3
"""MC 玩家动画轴 ↔ bbmodel 关键帧的**唯一换算处**。

## 生成取反，渲染不取反

不按 `format_version` 分。写进 `.bbmodel` 动画通道时取反；渲染器读通道时按文件里的度数转。

    生成关键帧  → `WRITE_LAYERS`：bb.x = -pitch, bb.y = -yaw, bb.z = -roll
    渲染 / 预览 → 用文件里的 x、y、z，不再套 `WRITE_LAYERS` 或 `READ_LAYERS`
    读回 MC 角  → `READ_LAYERS`：pitch = -bb.x, yaw = +bb.y, roll = -bb.z

`rotation_to_bb` 不是 `rotation_from_bb` 的逆。生成器写出的数字和面板上要看到的角差一个符号。
渲染器（`render_bbmodel` 的元素旋转、`render_chest` 这类预览）认的是文件里的度数，
不要在画图前再取一次反。

静态 `group.rotation` 不走动画通道。它用 `READ_LAYERS`：
`bb.x = -pitch, bb.y = +yaw, bb.z = -roll`，由 `render_player_pose.part_matrix` 佐证
（`R._rotmat(-roll,2) @ R._rotmat(yaw,1) @ R._rotmat(-pitch,0)`）。
不要把 `WRITE_LAYERS` 用到静态组上。

## 其余换算

    position（写）: bb = (-x, -y, z) × 16   （米 → px；X 取反、y 翻）
    position（读）: x = -bb.x/16, y = -bb.y/16, z = bb.z/16
    bend（写）    : 纯 X 轴，axis=180 → bb.x = +bend；axis=0 → bb.x = -bend
"""

from __future__ import annotations

import math

# (MC 轴名, bb 分量下标, 符号)。**内 pitch → 中 yaw → 外 roll** 的嵌套单轴顺序与 MC 的
# `rotationZYX(roll, yaw, pitch)` 作用次序一致，多轴同时非零时两边才不会解释出歧义。
#
# 写进动画通道的符号。渲染不走这一层。
WRITE_LAYERS = (("pitch", 0, -1.0), ("yaw", 1, -1.0), ("roll", 2, -1.0))
# 从文件读回 MC 角，以及静态 group.rotation。渲染不用。
READ_LAYERS = (("pitch", 0, -1.0), ("yaw", 1, +1.0), ("roll", 2, -1.0))
AXIS_ORDER = tuple(name for name, _, _ in WRITE_LAYERS)
PX_PER_BLOCK = 16.0

# 老名字：一律指**写侧**（生成器用得最多）。留着是为了 import 不断，新代码请直呼
# WRITE_LAYERS / READ_LAYERS，把"这是哪一侧"写在脸上。
AXIS_LAYERS = WRITE_LAYERS


def rotation_to_bb(axes: dict, axis_name: str) -> list[float]:
    """MC 轴 → 写进动画通道的 bb 三元组。

    文件里的数字已经取过反。渲染时直接用这个三元组，不要再取一次。
    """
    for name, index, sign in WRITE_LAYERS:
        if name != axis_name:
            continue
        out = [0.0, 0.0, 0.0]
        out[index] = round(sign * float(axes.get(name, 0.0)), 4)
        return out
    raise KeyError(f"未知轴层 {axis_name!r}，可选 {AXIS_ORDER}")


def rotation_from_bb(triple, axis_name: str) -> float:
    """文件里的单轴三元组 → MC 角度。

    不是 `rotation_to_bb` 的逆。渲染不要调它，渲染用文件里的度数。
    """
    for name, index, sign in READ_LAYERS:
        if name == axis_name:
            return float(triple[index]) / sign
    raise KeyError(f"未知轴层 {axis_name!r}，可选 {AXIS_ORDER}")


def euler_to_mc(bb_xyz) -> dict:
    """文件里的合成欧拉三元组 → MC 的 pitch/yaw/roll。

    用户在 Blockbench 里拖 gizmo 时，三个轴会被写进同一个 group（单轴分层被打破），
    这时候得先把整条 group 链乘起来、分解成一个欧拉三元组，再用这个函数换算。
    渲染不要调它。
    """
    x, y, z = (float(v) for v in bb_xyz)
    return {"pitch": -x, "yaw": y, "roll": -z}


def mc_to_euler(axes: dict) -> list[float]:
    """MC 轴 → 静态 `group.rotation`。

    写动画关键帧用 `rotation_to_bb`，不要用这个。
    """
    return [-float(axes.get("pitch", 0.0)),
            float(axes.get("yaw", 0.0)),
            -float(axes.get("roll", 0.0))]


def body_position_to_bb(body: dict) -> list[float]:
    """`body.x/y/z`（米）→ 写进动画通道的 bb position（px）。

    X 取反 + y 翻。渲染按文件里的 px 平移，不再取反。
    """
    return [round(-float(body.get("x", 0.0)) * PX_PER_BLOCK, 4),
            round(-float(body.get("y", 0.0)) * PX_PER_BLOCK, 4),
            round(float(body.get("z", 0.0)) * PX_PER_BLOCK, 4)]


def body_position_from_bb(triple) -> dict:
    """文件里的 bb position → MC 米。

    不是 `body_position_to_bb` 的逆：写侧的 x 多一次取反。渲染不用这个。
    """
    x, y, z = (float(v) for v in triple)
    return {"x": -x / PX_PER_BLOCK, "y": -y / PX_PER_BLOCK, "z": z / PX_PER_BLOCK}


def bend_to_bb(bend_deg: float, axis_deg: float) -> float:
    """bend → 单轴 X 旋转（度）。

    bendAxis 语义是"折弯方向绕主轴转多少"，轴 = (cos a, 0, sin a)。本仓的动画只用
    a=0（绕 +X）与 a=180（绕 −X）两种纯前后折弯，走解析分支而不是通用矩阵分解——JSON
    存的是弧度，π 转回度数是 180.000003，sin 不严格为 0，通用分解会渗出 1e-6 级的 y/z
    分量，落到单轴层里表达不了。
    """
    if abs(bend_deg) < 1e-9:
        return 0.0
    a = float(axis_deg) % 360.0
    # bend 写进动画通道，X 按写侧取反（与 WRITE_LAYERS 的 pitch 同号）。
    if a < 1.0 or a > 359.0:
        return -float(bend_deg)      # 轴 +X
    if abs(a - 180.0) < 1.0:
        return +float(bend_deg)      # 轴 −X
    raise AssertionError(
        f"bendAxis={axis_deg}° 不是纯 X 折弯，单轴层表达不了——需要再拆一层斜轴 group")


def bend_from_bb(bb_x: float) -> tuple[float, float]:
    """文件里的单轴 X 旋转 → (bend, axis)，约定 bend 取正。渲染不用。"""
    value = float(bb_x)
    if abs(value) < 1e-9:
        return 0.0, 180.0
    return (value, 180.0) if value > 0 else (-value, 0.0)


def assert_pure_x(triple, where: str = "") -> tuple[float, float]:
    """bend 层必须是纯 X 转动；拖 gizmo 拧出来的 y/z 残差在 MC 里表达不了。

    返回 (bend, axis)，并把残差一并抛给调用方决定怎么处理——静默丢掉会让"读回来的姿态
    和 Blockbench 里看到的不是同一个"，那正是最难查的一类偏差。
    """
    x, y, z = (float(v) for v in triple)
    bend, axis = bend_from_bb(x)
    residual = (round(y, 3), round(z, 3))
    if max(abs(y), abs(z)) > 1.0:
        loc = f"{where}: " if where else ""
        raise ValueError(
            f"{loc}bend 层带着 y/z 残差 {residual}——MC 的 bend 只能绕水平轴转，"
            f"这部分表达不了。把它挪到手臂的 yaw/roll 上，或接受丢失后显式忽略")
    return bend, axis


def radians_if_needed(value: float, degrees_flag: bool) -> float:
    return value if degrees_flag else math.degrees(value)
