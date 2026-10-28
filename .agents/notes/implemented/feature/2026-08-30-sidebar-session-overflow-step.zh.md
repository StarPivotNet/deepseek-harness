# Agent Note: 侧栏会话分批展开

Status: implemented

[English](2026-08-30-sidebar-session-overflow-step.md) | 中文

## Problem

打开的 Workspace 若有大量空闲／历史会话，点一次 **展开其余** 就会把剩余行一次性铺满侧栏。需要保持有界默认，并支持逐步多看一些；同时要在设置里提供明确的“全部展开”路径。

## Decision

workspace 插件在 Host 设置命名空间 `ui-workspace` 下拥有字段 `sessionOverflowLimit`。可选值是 `5`（默认）、`10`、`20`、`50` 和 `all`。通用设置行 **侧栏会话展开条数** 写入该字段。

侧栏浏览器把每个打开的 Workspace 或扁平历史／空闲簇的起点设为该有限上限。每次点 **展开其余** 会按同一步长推进当前挂载的绝对上限，并封顶到普通行总数：例如共 12 条、步长 5，会先再展开 5 条，再展开 2 条。空白新会话仍不计入普通配额。选择 **全部展开** 后，空闲／历史行默认不折叠，并隐藏溢出控件。收起整个 Workspace 只清除该账户的临时绝对上限，再次打开回到设置中的基础上限。

这取代了 [Workspace 侧边栏顺序与折叠](../../archived/feature/2026-08-11-workspace-sidebar-order-and-folding.md) 里“一次展开剩余全部”的布尔手势，但保留其五行默认、空白行配额与收起重置规则。

## Alternatives considered

**只改初始上限，点击仍一次展开全部。** 第一次点溢出仍会把剩余会话一次性倒进侧栏，正是本次要避免的拥挤。

**把推进后的绝对上限持久化到刷新后。** 很久以后再打开 Workspace 仍可能占满侧栏；只有设置中的基础上限才是稳定偏好。

**只放在视图选项里。** 需求明确要求设置页，而且这是产品级偏好，不是单次浏览模式。

## Consequences

- 默认打开仍只显示 5 条普通空闲／历史会话。
- 除非选择全部展开，否则溢出点击都是分批推进。
- 收起 Workspace 只重置该账户的临时步长推进。
- Host 用户设置新增 `ui-workspace` 段承载该偏好。

## Testing

包内测试覆盖溢出算术、五加五的分批展开与收起重置、空白行配额、Workspace 收起后的折叠拖拽锚点，以及 `settingsScope` 的 apply inject 接线。
