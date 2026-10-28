# Agent Note: 侧边栏进行中会话不再套状态文件夹

Status: implemented

[English](2026-08-19-sidebar-live-idle-without-status-folders.md) | 中文

## Problem

侧边栏已经在每行上标出进行中、等待、中断和已完成 Session。再用可折叠的已完成／运行中／异常／历史记录标题包一层，会让一个 Workspace 看起来像三层文件夹。操作者分不清标题是在分类、隐藏还是截断历史；哪怕只有一条进行中会话，也会压在「运行中」折叠栏下面。

## Decision

视图选项会持久化 `activityLayout`。**按状态分区**（`folders`，默认）恢复 [侧边栏会话活动分区](2026-08-15-sidebar-session-activity-sections.zh.md) 的可折叠已完成／运行中／异常／历史记录标题。**不分区**（`inline`）时只有 Workspace 和置顶可折叠。`partitionLiveIdle` 再把待处理交互、自身运行和有运行中后代的行浮到空闲行之上。已完成、异常和其余空闲行留在空闲簇里，状态只画在行内圆点上。进行中行永不进入五行溢出。空闲溢出仍使用 [Workspace 侧边栏顺序与折叠](2026-08-11-workspace-sidebar-order-and-folding.md) 的临时 **展开其余**。Session 拖拽只发生在起始的进行中／空闲簇或状态分区内。

## Alternatives considered

**保留可折叠状态标题，只改样式。** 标题仍会同时充当分类和折叠，正是操作者报出的控件冲突。

**加状态筛选花片或「按状态」分组模式。** 以后仍可加。去掉默认列表的嵌套文件夹读法不需要它们。

**把异常也钉成第二簇进行中。** 中断 Session 已有红色行内点。再自动分一簇会为少见状态重建状态文件夹。

## Consequences

- 打开的 Workspace 或单列表始终显示全部进行中 Session。
- 空闲 Session 默认仍只显示五条，直到展开其余。
- 已持久化的 `activityExpansion` 键只在**按状态分区**时折叠状态标题；置顶标题在两种布局下都可折叠。
- 搜索仍是一份扁平匹配列表。

## Testing

树测试覆盖进行中先于空闲的拆分、四向分类和持久化布局。浏览器测试覆盖默认状态标题、切换到不分区，以及空闲超过五行后的溢出。
