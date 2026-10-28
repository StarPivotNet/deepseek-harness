# Agent Note: 侧边栏会话活动分区

Status: implemented

[English](2026-08-15-sidebar-session-activity-sections.md) | 中文

## Problem

侧边栏已经用圆点区分已完成未查看、运行中和空闲 Session，但列表本身仍是一份按最近更新或 Workspace 堆在一起的清单。刚完成、仍需回看的工作会和正在运行的会话以及旧历史挤在一起，操作者必须逐行扫描才能找到刚完成或仍在运行的项。

## Decision

分类仍是现有行状态位的纯函数：**已完成**（`completed` 提醒且没有正在进行的工作）、**运行中**（待处理交互或自身／后代活动）、**异常**（崩溃／重载中断且尚未再次运行）和**历史记录**（其余空闲 Session）。焦点离开已完成 Session 后，`SessionManager` 清除提醒。**按状态分区**（默认视图选项）把这些桶画成可折叠标题。可选的不分区布局由[侧边栏进行中会话不再套状态文件夹](2026-08-19-sidebar-live-idle-without-status-folders.zh.md)负责。macOS dock 鲸鱼显示同一份已完成计数；该角标与跳动见 [macOS dock 已完成角标与跳动](2026-08-20-sidebar-completed-badge-and-dock-bounce.zh.md)。

## Alternatives considered

**用这三个分区替换 Workspace 分组。** 本次请求是给现有列表加状态拆分，不是取消 Workspace 归属、添加／重命名或 Host Session 顺序。

**再加一种视图选项模式。** 需要操作者手动打开的模式会把默认 Workspace 视图里的拆分藏起来，而截图里的正是这份默认列表。

**持久化另一套已读集合。** 绿色提醒在此浏览器里已经表示「已完成且未查看」。再加一份持久已读位会与 `SessionManager.completed` 漂移。

## Consequences

搜索仍是一份扁平匹配列表。Workspace 组头、Host 顺序和提醒生命周期保持不变。Session 开始运行会立刻离开已完成；焦点离开已完成 Session 后只清除提醒。被崩溃／重载中断的 Session 保持异常，再次运行后离开；`session.list` 随后恢复它，并用一条插件通知续上一轮。

## Testing

树测试覆盖四向分类和空分区占位。默认标题、布局切换和空闲溢出见[侧边栏进行中会话不再套状态文件夹](2026-08-19-sidebar-live-idle-without-status-folders.zh.md)。
