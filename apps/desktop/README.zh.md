# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

包裹本地 `dsh web` Host 的 Electron 窗口。聊天界面仍是官方 Web GUI；本包只负责窗口、Host 进程和标题栏。

## Run

在仓库根目录完成 `pnpm run build` 后：

```sh
pnpm desktop
```

或：

```sh
pnpm dsh desktop
```

窗口在 Electron 进程一存在时就启动 `dsh web`，让 Host 启动与 Chromium 就绪重叠。首次启动绑定 `--port 0`；之后从 Electron userData 复用上次成功的 loopback 端口，让 Chromium 保持同一 origin（因此置顶会话等浏览器本地 GUI 状态得以保留）。记住的端口被占用时回退到 `--port 0`。`dsh desktop` 转发的显式 `--port` 仍然优先。它先等待 `dsh web: http://127.0.0.1:<port>`，再等待 `/plugins` 能提供客户端 bundle，然后才加载该 loopback URL，这样第一批插件脚本不会在后续 Host 行仍在挂载时拿到 404。若 Host 在打印该行之前退出，窗口会显示退出状态以及捕获到的 stdout 和 stderr。关闭窗口会停止 Host。Windows 使用系统标题按钮 overlay 完成最小化、最大化和关闭。任务栏与窗口图标是与 Web favicon 相同的 DeepSeek 鲸鱼标识。Windows 首次启动会把带该图标与 AppUserModelID 的 `DeepSeek Harness.lnk` 写入开始菜单；请固定该快捷方式，而不是裸的 `electron.exe` 进程。

macOS 上窗口使用 `titleBarStyle: hiddenInset`：原生红绿灯按钮位于标题栏左侧预留区域，标准应用菜单（Edit、Window 各 role 及 Quit）提供常规 Cmd 快捷键。关闭窗口后进程保留在 dock；点击 dock 图标会重新打开窗口并重启 Host。预留条是空白拖拽区：`insertCSS` 在 `dom-ready` 安装 `-webkit-app-region: drag`，拖拽节点用绝对定位块提供命中盒。Web GUI 报告未读已完成计数时，隔离 preload 发送 `dsh-desktop:set-completed-unread`，主进程把绿色数字圆标合成到鲸鱼 PNG 上，再 `app.dock.setIcon`。计数上升时还会调用 `app.dock.bounce('informational')`。应用处于前台时 Electron 返回 `-1`，因此已聚焦窗口不会跳动。

## Release

`desktop-v<version>` 标签上的 GitHub Release 为每个 runner 提供一份归档：macOS arm64 zip、Linux x64 AppImage 和 Windows x64 zip。每个归档内嵌 Electron 窗口、该 runner 上的 Node 24 二进制，以及对 `@deepseek-ai/dsh` 的 `pnpm deploy`。窗口仍在记住的 loopback origin 上启动 `dsh web`（首次启动用 `--port 0`）并加载该 URL；打包后的 Host 不再需要仓库 checkout 或系统 Node。

在仓库根目录完成 `pnpm run build` 后：

```sh
pnpm run desktop:pack -- --platform darwin
```

`Release (desktop)`（`.github/workflows/release-desktop.yml`）打包这三份安装包，并把它们发布为该标签的 GitHub Release。说明会列出距上一个 `desktop-v*` 标签的提交。desktop 包保持 `private`，不是 npm family 成员。序列说明见 [desktop GitHub Release Agent Note](../../.agents/notes/implemented/process/2026-08-17-desktop-github-release.zh.md)。打包后的窗口可以从该 Release **安装** 更新的 `desktop-v*` 归档（用 `SHA256SUMS` 校验 SHA-256）并 **重启** 以替换正在运行的应用；checkout 启动不会这样做。该路径见 [应用内更新 Agent Note](../../.agents/notes/implemented/feature/2026-09-16-desktop-in-app-update.zh.md)。

## Known Limitations and Deferred Work

- 应用内安装只在打包构建（`app.isPackaged`）中运行。checkout 启动方式仍是 `pnpm desktop` / `dsh desktop`。
- 没有代码签名、托盘或多窗口。归档保持未签名。
