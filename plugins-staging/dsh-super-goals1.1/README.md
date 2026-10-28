# dsh-super-goals

![banner](https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/banner.svg)

**把整个项目画成一张会自己动的「任务思维导图」，并且让 Agent 真的照着它走——跑偏当场拦下。**

计划 → 模块 → 任务三层展开，跨分支依赖画成紫色箭头，拓扑执行序号实时刷新，Agent 在图上 GPS 站位前行；改图当场生效并留下 reason，任务完成必须附证据，git 里出现计划外改动立即漂移阻断。

[**English**](README.en.md) · [Releases](https://github.com/hoyyang/dsh-plan-board/releases) · [更新日志](CHANGELOG.md) · [设计文档](docs/DESIGN.md)

<p align="center">
  <a href="https://github.com/hoyyang/dsh-plan-board/releases"><img alt="release" src="https://img.shields.io/github/v/release/hoyyang/dsh-plan-board?color=8b5cf6"></a>
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%3E%3D0.1.5--rc.1-38bdf8">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-BSD--3--Clause-green"></a>
  <a href="https://github.com/hoyyang/dsh-plan-board/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hoyyang/dsh-plan-board?color=f5c542"></a>
</p>

## 安装

```sh
dsh plugin --profile web add github:hoyyang/dsh-plan-board
# 构建产物随仓库提交，免本地构建
```

重启 `dsh web`：会话头部右侧（「⋯ 更多操作」左边）出现 **SuperGoals** 按钮即成功。点它打开当前会话的规划面板。

```sh
dsh plugin --profile web remove @dsh-external/dsh-super-goals   # 卸载
```

最低 `dsh >= 0.1.5-rc.1`（实测版本）。**零配置**：不需要 API Key，规划数据全部落在你自己的项目目录里。

## 看看长什么样

<p align="center">
  <img alt="plan board panel" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/panel.png" width="420">
</p>

- **左**：面板（561×720）——计划 → 模块 → 任务三层思维导图，模块间紫色虚线是依赖，任务前的 `#N` 是拓扑执行序号，绿色=done；顶部横幅是漂移阻断，底部是事件时间线（`status_changed` / `human_edit` 全量留痕）。
- **入口按钮**：静止收成 31×31 正圆（左），悬停向左展开成完整胶囊（右）——两态圆角同为 15.5px（= 高度一半），所以弧度全程不变；右缘固定，右邻「⋯ 更多操作」不动。

<p align="center">
  <img alt="button collapsed" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/button-collapsed.png" height="56">
  &nbsp;&nbsp;
  <img alt="button expanded" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/button-expanded.png" height="56">
</p>

## 它解决什么问题

Agent 跑偏不是「不听话」，是**没有可执行的计划权威**：计划活在对话里，压缩一次就没了；任务做到哪一步没人知道；说「做完了」也没有证据；改计划不留痕。dsh-super-goals 把计划变成会话工作区里的一份**机器权威文件**（`<cwd>/.super-goals/<session>/board.json`），再用五层机制让 Agent 只能顺着它走。

## Agent 工具（4 个）

| 工具 | 作用 |
| --- | --- |
| `super_goals_map` | 读图：模块/任务树 + 依赖 + 拓扑序号 + 站位 + 漂移块（新会话/压缩后第一件事） |
| `super_goals_edit` | 改图：结构变更当场生效，必须带 reason 审计留痕 |
| `super_goals_next` | 发号：**唯一**下一个可做任务（依赖已就绪 + 优先级排序），当场标记 doing（L1 单发号硬锁） |
| `super_goals_update` | 流转：`planned/ready → doing → done/blocked`；**done 必须附证据**（L3 证据门），模块收卷也走这里 |

## 防跑偏五层

| 层 | 机制 | 默认 |
| --- | --- | --- |
| L1 | **单发号硬锁**：同时只允许一个 doing；已有进行中任务时 `super_goals_next` 直接拒绝 | 开 |
| L2 | **改图审计留痕**：`super_goals_edit` 必须带 reason，结构变更当场生效并写入事件流 | 开 |
| L3 | **证据门**：done 不带证据 → `EVIDENCE_REQUIRED`（任务与模块一视同仁） | 开 |
| L4 | **git 交叉核对**：doing 期间的 commit 若不落在任务 `scope` 内 → 漂移告警/阻断 | 开 |
| L5 | **漂移阻断**：存在未处置漂移时拒绝发号，人须在面板「解除阻断」 | 开 |
| L6 | **LLM 仲裁 + watchdog** | M4 未排期 |
| L7 | **已删除**：不按 doing 任务 scope 拦截 write/edit，也不再提供 `enforceScope` 配置 | — |

## 功能

- **思维导图面板**：React + 自绘 SVG 横向树，模块分组自动布局；滚轮缩放（原生 non-passive，不带动面板滚动）、拖背景平移、拖拽节点自定义位置（`pos` 仅视图状态，不进 lint）。
- **面板直编辑**：点节点开编辑卡（标题 / 优先级 / 备注 / 验收标准 / scope / 依赖多选）、拖拽、紫点拖出连线改依赖（拖到 B 即 B 依赖它，再拖一次撤销）、＋子任务 / 删除节点。
- **保存门控**：面板上的一切改动先进草稿态（横幅显示「N 项未保存更改」），点「保存更改」才批量 `POST /edit` 落盘并记 `human_edit` 事件；点「放弃」全部回滚。保存前客户端预检环依赖，服务端 lint 兜底；status 不在面板直改（状态流转只走 super_goals_update 的证据门）。
- **模块级依赖真的算数（v0.2.0）**：写在模块上的依赖会向下冒泡到它的子任务——「大任务3 依赖 大任务2」会真正卡住小任务3-1 的发号。模块在「自身 done」或「名下任务全部 done/canceled」时算完成；空模块不自动完成；声明无环但冒泡后成环的死锁会在提交时被 lint 拒绝。
- **实时刷新**：`/stream` NDJSON 推送 + 4s 轮询兜底；漂移横幅、事件时间线全部实时。
- **入口按钮（会话头部）**：静止时收成 31×31 正圆只留银河图标，悬停/键盘聚焦/面板开启时向左展开成完整胶囊（两态圆角同为 15.5px，弧度不跳变；右缘固定，邻居平滑让位）；状态点每 15s 轮询 `GET /state`：青=无进行中 · 琥珀=N 个进行中 · 红=漂移阻断或阻塞 · 灰=未设置路径；收起态由图标光晕颜色继续传达状态。深浅主题同款，`aria-pressed` / `focus-visible` / `prefers-reduced-motion` 齐备。
- **存储**：`<cwd>/.super-goals/<session>/` 三件套——`board.json`（机器权威，乐观锁 version + SHA-256 digest）、`events.jsonl`（只追加审计流）、`ROADMAP.md`（人读镜像）。
## 数据权威

规划与任务状态以 `.super-goals/<session>/board.json` 为**唯一权威**。

## 使用

1. **Agent 侧**：新会话/压缩后先 `super_goals_map`；`super_goals_next` 领任务（一次一个）；做完 `super_goals_update` 为 done 并附证据；改规划用 `super_goals_edit`（当场生效，必须带 reason）。
2. **人类侧**：点头部 **SuperGoals** 按钮开面板 → 漂移横幅「解除阻断」。

## 边界（明确不做）

- 不做看板（Kanban）形态——思维导图是主形态（用户拍板）。
- 不替代 issue tracker：单项目单板，不做多人协作/权限/通知。
- status 不在面板直改（必须走 `super_goals_update` 的证据门）。
- 不记录全局工具调用日志，也不按任务 scope 拦截 write/edit。
- 甘特/关键路径视图、LLM 仲裁（M4）未排期。

## 开发

```sh
npm install                      # 取本地 devDependencies（tsdown 等）
bash scripts/build.sh            # host：tsc 编译到 lib/（自动探测 DSH_CHECKOUT 或 npm 安装的 dsh）
npm run build:client             # client：tsdown 编译面板（react 为 external）
bash /path/to/dsh-plugin-build/scripts/boot-check.sh web   # 冷启动三故障静态检测
```

改完源码请把 `lib/` 一起提交（GitHub 安装依赖它）。

## 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-super-goals
```

卸载**不会**删除工作区里的 `.super-goals/` 数据；彻底清除请手动删除该目录。

## License

BSD-3-Clause
