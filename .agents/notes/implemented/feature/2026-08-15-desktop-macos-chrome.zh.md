# Agent Note: 桌面端 macOS 原生窗口外观

Status: implemented

[English](2026-08-15-desktop-macos-chrome.md) | 中文

## 问题

Electron 壳此前在所有平台绘制 Windows 风格标题栏，且没有应用菜单。在 macOS 上既没有原生红绿灯，也没有 Cmd-Q/Cmd-W/Cmd-M 处理和标准 Edit role，而且关闭窗口会杀死 dock 进程。

## 决策

`apps/desktop/src/titlebar.ts` 引入 `TitlebarVariant`（`'mac' | 'windows'`），由主进程的 `titlebarVariantForPlatform(process.platform)` 选择。mac 变体在 drag 区左侧为原生红绿灯留出 inset；windows 变体保留右侧 inset 给系统标题按钮 overlay。两者都不自绘按钮。`apps/desktop/src/main.ts` 按平台分支：darwin 上窗口使用 `titleBarStyle: 'hiddenInset'`，`trafficLightPosition` 在 36px 标题栏内垂直居中，并加 `vibrancy: 'under-window'`；由纯 `role` 项（app/Edit/Window）构建的 `Menu.setApplicationMenu` 提供 Cmd 快捷键；`window-all-closed` 不再退出。Host 启动抽为 `startHost()`/`presentWindow()`，`activate` 事件从 dock 重新打开窗口并重启 Host，同时保留首启时 Host 先于 Chromium 启动的重叠优化；真正的退出仍由 `before-quit` 停止 Host。

## 备选方案

**macOS 也用 Windows 标题按钮 overlay。** 否决：Window Controls Overlay 不是 macOS 外观；`hiddenInset` 提供真实红绿灯，包括全屏行为和正确的命中测试。

**macOS 关窗即退出。** 否决：dock 图标重新打开窗口是平台惯例；Host 在关窗时停止、随重开窗口重启。

**在自定义标题栏里绘制 mac 风格圆点。** 否决理由同 overlay：原生控件已经是正确的。

## 后果

Windows 行为不变：标题按钮 overlay、鲸鱼图标和开始菜单快捷方式与之前完全一致。macOS 上红绿灯为原生控件，标题栏为其预留空间，菜单快捷键在 Web GUI 中可用。`window.dshDesktop` IPC 两个变体都保留，供 drag 区双击使用。新的未读已完成提醒也走这条 preload：macOS 按 [macOS dock 已完成角标与跳动](2026-08-20-sidebar-completed-badge-and-dock-bounce.zh.md) 给 dock 加角标并跳动。

## 测试

`apps/desktop/tests/titlebar.spec.ts` 断言两个变体的 drag inset、无自绘按钮以及 `titlebarVariantForPlatform` 映射。`apps/desktop/tests/host.spec.ts` 原先从 Windows 路径 `C:\Windows` 向上遍历，在 POSIX 上它相对仓库 cwd 解析并错误地找到根目录；现在从 `tmpdir()` 子目录遍历。该文件的快捷方式用例断言 `.ico` 图标，但 `desktopIconPath` 在非 win32 开发机上返回 PNG，而 `windowsShortcutSpec` 只在 Windows 上运行；`desktopIconPath` 现在接受显式平台参数，快捷方式固定传 `'win32'`。
