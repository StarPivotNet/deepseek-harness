# Agent Note: Packaged desktop in-app update

Status: implemented

[English](2026-09-16-desktop-in-app-update.md) | 中文

## Problem

产品更新插件已经能告诉打包桌面端用户存在更新的 `desktop-v*` GitHub Release，然后打开 Release URL。安装仍然需要用户自己下载 zip 或 AppImage。checkout 上的 Electron 不得用打包归档替换自己的二进制。

## Decision

打包桌面端（`app.isPackaged`）从 Host 已经在轮询的同一源安装匹配的 GitHub Release 归档。

`@deepseek-ai/dsh-client-ui-update` 仍然负责轮询和 UI。在 `desktop` 通道上，`pickLatestRelease` 之后 Host 会拉取 `SHA256SUMS`，并在归档名、`https://github.com/<repo>/releases/download/<tag>/<name>` URL、大小和摘要匹配 darwin/arm64、linux/x64 或 win32/x64 时附加 `ProductRelease.artifact`。SHA256SUMS 失败时仍保留该标签，并省略 `artifact`。CLI/`dsh` 通道从不附加归档。Host 从不把归档字节写到磁盘。

`apps/desktop` 拥有下载与应用。隔离 preload 暴露 `canInstall`、`installUpdate`、`cancelUpdate`、`onUpdateProgress` 和 `relaunchToUpdate`。`canInstall` 仅在打包后为 true。主进程钉死 `StarPivotNet/deepseek-harness`，拒绝任何其他下载 URL，边下载边哈希，并在大小或 SHA-256 不匹配时失败关闭。Zip 解压只允许 store 与 deflate，并拒绝 zip-slip、加密、zip64 和非文件条目。用户点击 **重启** 后，辅助脚本等待该 PID，然后：

- Windows：用 `robocopy` 把暂存树覆盖到 `dirname(execPath)`，再 `start` `DeepSeekHarness.exe`
- macOS：替换外围 `.app` 并 `open`
- Linux：替换 `$APPIMAGE` 并 `exec`

设置和叠加层 toast 仅在存在 `latest.artifact` 且 `canInstall()` 为 true 时显示 **安装**。**立即检查** 仍然不下载归档。

[产品更新插件](2026-08-28-in-repo-product-update.zh.md) 仍然拥有轮询、缓存和忽略。[desktop GitHub Release 序列](../process/2026-08-17-desktop-github-release.zh.md) 仍然拥有打包和 `SHA256SUMS` 上传。

## Alternatives considered

**electron-updater / Squirrel / NSIS。** 不予采纳：本产品已经在 GitHub Releases 上发布未签名的 zip 与 AppImage 归档，且打包器已经拒绝 NSIS。GitHub 下载加上退出后的辅助脚本就能覆盖这三种产物，不需要第二个发布器。

**由 Host 下载归档。** 不予采纳：Host 是窗口里的 `dsh web`。替换 `DeepSeekHarness.exe` / `.app` / AppImage 是 Electron 主进程的工作，而且 checkout 上的 Host 不得安装。

**静默后台下载。** 不予采纳：用户点击 **安装**。检查仍然只是元数据轮询。

**在打包应用里加入 npm zip 库。** 不予采纳：`apps/desktop` 的 electron-builder `files` 列表没有运行时 `node_modules`。`node:zlib` 的 inflateRaw 加上 zip-slip 防护对这些归档足够。

## Consequences

- 打包后的设置 → 通用和叠加层 toast 增加 **安装** / **重启**。CLI 与浏览器标签页不会。
- 缺少或无效的 `SHA256SUMS` 仍显示更新标签；**打开发行说明** 仍然可用。
- Windows 和正在运行的 AppImage 不能覆盖自己，因此应用总是在 `app.quit()` 之后通过 Electron userData 里的辅助脚本完成。
- 归档保持未签名。新安装的二进制首次启动时 Gatekeeper 和 SmartScreen 仍会警告。

## Testing

`packages/client/ui-update` 规格固定资源解析、SHA256SUMS、下载 URL 防护、schema `artifact`、desktop 通道附加、SHA256SUMS 中止、设置/toast 安装，以及 preload 转发。`apps/desktop` 规格固定 payload 防护、zip 解压、校验下载、应用辅助脚本、updater 状态（忙碌/取消/暂存不完整）、IPC 接线，以及 preload/main 字符串。
