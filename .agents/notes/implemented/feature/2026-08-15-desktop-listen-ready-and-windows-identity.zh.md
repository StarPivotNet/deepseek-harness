# Agent Note: 桌面端在监听就绪后加载并使用 Windows 身份

Status: implemented

[English](2026-08-15-desktop-listen-ready-and-windows-identity.md) | 中文

## 问题

`dsh desktop` 要等整棵 Host Loader 树就绪后，窗口才能离开加载页，因此首屏绘制被后续每一行 Host 挂载拖住。Windows 无边框窗口把注入的 HTML 标题栏按钮放在拖拽区下，最小化、最大化和关闭收不到点击。固定正在运行的 `electron.exe` 进程时，任务栏也会显示 Electron 图标，因为该进程映像没有 DeepSeek 身份。

## 决策

桌面进程一旦存在就启动 `dsh web`，让 Host 启动与 Chromium ready 重叠。首次启动使用 `--port 0`；之后从 Electron userData 复用上次成功的 loopback 端口，让 Chromium 保持同一 origin，记住的端口被占用时回退到 `--port 0`（[origin 复用](../bug-fix/2026-08-24-desktop-reuses-host-origin-for-localstorage.zh.md)）。`web-runtime` 一旦能用 `ctx.webServer` 拼出 `dsh web: http://127.0.0.1:<port>` 就打印该行。HTTP 服务器此时已经在听；尚未注册的路径继续 404，浏览器 boot 内核自己等待客户端插件。窗口加载该 loopback origin，不通过 `file://` 提供 GUI。

Windows 用 Electron `titleBarOverlay` 提供系统标题栏按钮。注入条只负责拖拽带和双击最大化，右侧保留 138px 内边距，避免 overlay 落在拖拽目标上。

窗口图标是随包装载的 DeepSeek 鲸鱼标（`apps/desktop/assets/icon.{png,ico}`）。Windows 上 CLI 直接启动 `electron.exe`，进程设置 AppUserModelID `ai.deepseek.dsh.desktop`，首次启动会在开始菜单写入带该图标和 ID 的 `DeepSeek Harness.lnk`。任务栏保留的是固定这个快捷方式后的身份，而不是裸的 `electron.exe` 进程。

`DSH_NODE_EXEC` 与 Electron userData 里上次成功的 Node 路径用来选择 Host 的 Node 可执行文件，因为 Electron 的 `process.execPath` 不能运行 CLI。

`web-server/listening` 记录第一次 bind，让其他行在不等 Loader 结算的情况下观察监听就绪。

## 考虑过的替代方案

**等 `loader.await()` 后再打印 URL。** 不予采纳，因为桌面端和其他监督进程把 URL 行当作可以打开 origin 的时刻。浏览器 boot 内核已经会等待客户端插件；把该行拖到每一行 Host 挂载完成只会推迟首屏。

**保留自定义 HTML 标题栏按钮。** 不予采纳，因为 Windows 上无边框窗口的 `-webkit-app-region: drag` 条会吞掉这些点击。`titleBarOverlay` 才是平台标题栏。

**只设置 `BrowserWindow.icon`。** 不予采纳，因为 Windows 任务栏身份跟随进程映像和 AppUserModelID。开始菜单快捷方式写明鲸鱼 ICO 与同一 ID，固定后任务栏才会保留该身份。

**打包一个改写了 PE 图标的自定义 Electron helper。** 对 checkout 启动不予采纳。改写 PE 图标仍不是 Windows 身份的声明方式；[desktop GitHub Release](../process/2026-08-17-desktop-github-release.zh.md) 改为发布 electron-builder 安装包。

## 后果

首屏不再等待其余 Host 树。固定开始菜单快捷方式的操作者会看到鲸鱼标；固定裸的 Electron 进程仍显示 Electron 图标。Windows 上不再使用自定义 HTML 标题栏按钮。把 URL 行当作「`/api` 所有者已挂载」的监督进程现在会与后续 Host 行竞态；交互就绪仍以 SPA 和客户端 boot 内核为准。

## 测试

桌面端单元测试固定鲸鱼资源、快捷方式目标／图标／AppUserModelID、记住的 Node 路径，以及不含 HTML 标题栏按钮的标题栏标记。web-app 测试固定在不等 `loader.await()` 的情况下立即打印 URL。webserver 测试把 `web-server/listening` 钉在真实监听端口上。
