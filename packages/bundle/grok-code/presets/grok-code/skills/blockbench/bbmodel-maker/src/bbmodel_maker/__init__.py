"""bbmodel-maker —— 程序化生成 Blockbench `.bbmodel` 的离线工具库。

五个子包，按「做什么」分层：

- `model`     几何与格式：护甲骨架、box-UV、只写 bbmodel 4.10
- `rig`       骨骼与动画：正逆解、关键帧轨道、体素生物 Rig、PlayerAnimator 采样
- `render`    渲染：z-buffer 软渲 bbmodel、诚实视角命名与固定取景、玩家姿态与手持物
- `gates`     后验判据：七道几何门、动画门，每道自带缺陷注入器
- `workbench` 生图工作台 CLI：接触表、护甲上身预览、变体派生、姿态回程

跨层的只有 `workspace`：项目根 / 产出目录 / 资源命名空间的唯一解析处。
"""

from bbmodel_maker.workspace import Workspace, default, set_default

__all__ = ["Workspace", "default", "set_default"]
__version__ = "0.1.1"
