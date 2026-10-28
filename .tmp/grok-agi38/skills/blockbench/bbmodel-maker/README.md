# bbmodel-maker

程序化生成 Blockbench `.bbmodel`、烘焙骨骼动画、headless 渲染核验的离线工具库。

纯离线，不进游戏运行时。产出的是**作者资产和校对图**——给人看、给人改，然后由调用方
自己决定怎么装进游戏。

```
src/bbmodel_maker/
├── workspace.py   项目根 / 产出目录 / 资源命名空间的唯一解析处（跨层）
├── model/         几何与格式：护甲骨架、box-UV、方块 UV/连通检查、材质贴图；只写 bbmodel 4.10
├── rig/           骨骼与动画：正逆解、关键帧轨道、体素生物 Rig、PlayerAnimator 采样
├── render/        z-buffer 软渲 bbmodel、诚实视角命名与固定取景、玩家姿态、手持物
├── gates/         后验判据：七道几何门 + 动画门，每道自带缺陷注入器
└── workbench/     生图工作台 CLI：接触表、护甲上身预览、变体派生、姿态回程
```

## 安装

```bash
pip install git+https://github.com/Kizunad/bbmodel-maker@v0.1.0
pip install "bbmodel-maker[geckolib] @ git+https://github.com/Kizunad/bbmodel-maker@v0.1.0"  # 要 GeckoLib 转换时
```

只依赖 `numpy` 和 `pillow`。`bbmodel_to_geckolib` 驱动的是 web Blockbench 的官方 codec，
只有那一条路径要 `playwright`。

## 告诉库你的项目长什么样

库不猜调用方的目录布局。在项目根放一个 `bbmodel.toml`：

```toml
[workspace]
lib = "modelScript"                              # 生成脚本与产出所在目录
namespace = "yourmod"                            # MC 资源命名空间
client_resources = "client/src/main/resources"   # 可选，读动画 JSON / 写导出资产时才需要
```

解析顺序：**显式传参 → `$BBMODEL_PROJECT_ROOT` → `bbmodel.toml` → `.git` → cwd**。
`.git` 是文件时（git worktree）同样认。

```python
from bbmodel_maker import Workspace

ws = Workspace.discover()
ws.models / "Thing.bbmodel"     # 产出路径
ws.rel(path)                    # 打印用的短路径
ws.resolve_texture(src, near=)  # bbmodel 贴图路径：项目根 → bbmodel 同目录 → 原样
```

## 常用入口

```bash
# 看 bbmodel 真长相（别只信平涂示意图）
bbmodel-render path/to/Thing.bbmodel

# 人工闸门：六视角接触表 + 特征点名 + 差分自证，出完停下等人看
bbmodel-contact-sheet Thing.bbmodel --gates gen_thing --prev out/Thing_round1.bbmodel

# 把护甲戴到真 MC 玩家模型上，查有没有漏盖
bbmodel-armor-preview gen_hide_armor --slot chest --coverage

# Blockbench 里改完的姿态读回成 POSE 表
bbmodel-to-pose Anim.bbmodel --anim club_smash --tick 5
```

## 踩过的坑（都是流过血的）

- **1 texel ≈ 1 单位**：护甲 cube 的贴图分辨率就这么低。任何「逐 texel 的描边 / 虚线 /
  交替缝线」放大后都是棋盘格。细节要么做成几何，要么别做。
- **共面 z-fighting**：两块 cube 同向外表面落在同一平面且投影相交 → 渲染器逐像素乱挑 →
  一片高频噪点，**极容易被误读成「贴图脏了」**。
  这是静止几何：`coplanar_faces` 只比 `elements` 里轴对齐的方块，不采样动画，`AnimGates` 也不查它。
  方块自己的 `rotation` 非零时这道检查直接跳过，所以给方块写一个 0.001° 并不能躲过闪烁，只是让检查闭嘴。错开的是外表面，不是这个字段。
- **正交三视图结构上看不见水平面**：臂顶、脚底这类精确平面上的穿模，只能靠逐面采样查。
- **`yaw=180` 渲的是 −z 面**：背面剔除只画法线转到 +z 的面。视角名一律走 `framing` 派生，
  别手写角度表。
- **自动取景不能跨图比较**：`render()` 不传 `focus` 时每张图各算各的包围盒。要比就传
  `framing.focus_for()` 出来的公共取景。
- **渲出来的 PNG 读不回来**：验证只能靠 PIL/numpy 逐像素采样，把结果打成人类可读的数字表。
  数材质像素用**色相单位向量**（归一化后比距离，`< 0.035~0.05` 判命中）——绝对亮度阈值在
  不同光照/朝向下会失效，色相不会。
- **生成取反，渲染不取反**：写进动画通道用 `WRITE_LAYERS`，三个轴都取反（`bb.x = -pitch`，`bb.y = -yaw`，`bb.z = -roll`）。渲染按文件里的度数转，不再套一次。
  读回 MC 角用 `READ_LAYERS`。两套不是互逆，也不按 `format_version` 分。
- **薄于 1 的边会被展开成 1 像素**：`unfold` 每条边四舍五入且至少 1，六条边共用这次取整。0.2 厚的铁带和 1 厚的边落到同一像素宽，`uv_density` 会报两轴密度差超过 1.5 倍。装饰条做满 1 单位。
- **uuid 是身份句柄不是内容**：多数生成器用 `uuid.uuid4()` 现取，每跑一次都不同。做字节回归
  要先把 uuid 按首次出现顺序归一化，否则每次都「变了」。
- **落盘前一律 `mkdir(parents=True, exist_ok=True)`**：产出目录通常 gitignored，
  干净 checkout 上不存在。

## 测试

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

263 例。

### 已知缺口

`gates` 的迁移用例、`manifest` 点名器、`contact_sheet` 的端到端用例目前**只在调用方仓库里
有覆盖**——它们拿真实资产当 fixture（某个具体的草包 / 背篓 bbmodel）。库这边缺的是等价的
**合成 fixture**。在补上之前，改这三块要连调用方的测试一起跑。

同理，`preview_player_anim` / `held_item_pose` 两个工作台入口还没进库：它们依赖一份
biped 骨架数学与关节解剖判据，那部分还在调用方仓库里，要一起搬。

## 出处

从 [Kizunad/Bong](https://github.com/Kizunad/Bong) 的 `modelScript/` 抽出，
`git filter-repo` 保留了完整提交历史（可以 `git log --follow` 追到 2026 年初）。
