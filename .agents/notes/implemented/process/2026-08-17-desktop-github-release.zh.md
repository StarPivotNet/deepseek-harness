# Agent Note: Desktop GitHub Release sequence

Status: implemented

[English](2026-08-17-desktop-github-release.md) | 中文

## Problem

`@deepseek-ai/dsh-desktop` 只能从仓库 checkout 启动：窗口通过向上查找 `apps/cli` 来派生 `dsh web`，`resolveNodeExecutable` 也需要系统 Node。这对贡献者足够，对可下载的桌面应用不够。npm `dsh` family 已经发布 `@deepseek-ai/dsh` tarball；它不产出 Electron 安装包，而且 `apps/desktop` 保持 `private`，不能加入该 family。

## Decision

桌面安装包是第四条独立发布序列，与 npm `dsh`、vendor 和 Landlock family 分开。

发布版本是 `apps/desktop/package.json` 的 `version`，它已经跟随 workspace family 版本。该版本进入 `master` 后，由人创建 `desktop-v<version>` 标签。CI 从不写回仓库。

`scripts/desktop/pack.ts` 暂存一棵 Host 树和一个 Electron 应用叶子，然后运行钉死的 `electron-builder@26.15.3`：

- `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` 写入 `dist-desktop/staging/host/dsh`。
- runner 上的 Node 24 二进制复制到该树旁，名为 `host/node` 或 `host/node.exe`。
- 编译后的 desktop `lib/`、`assets/` 和 `package.json` 复制到 `dist-desktop/staging/app`，避免 electron-builder 遍历 workspace。
- electron-builder 打包该叶子，并带上 `extraResources/host`。暂存应用名是 `dsh-desktop`，Linux/Windows 可执行文件名是 `DeepSeekHarness`，因为 AppImage 拒绝 scoped npm 名。macOS 和 Linux 使用 `icon-512.png`；Windows 使用多尺寸 ICO。Windows 上打包器启动 `pnpm.cmd`，并写出 zip 而不是 NSIS，因为 `pnpm dlx` 会把 NSIS 模板嵌进 makensis 打不开的路径。

打包后的窗口先解析 `process.resourcesPath/host/dsh/lib/bin.js` 和内置 Node，再考虑 checkout 或记住的系统 Node。checkout 启动方式不变。

`Release (desktop)`（`.github/workflows/release-desktop.yml`）在每个原生 runner 上打一份安装包，并把这些字节发布为该标签的 GitHub Release：

| Runner | Artifact |
|---|---|
| `macos-latest` | `DeepSeek Harness-<version>-mac.zip` |
| `ubuntu-24.04` | `DeepSeek Harness-<version>.AppImage` |
| `windows-latest` | `DeepSeek Harness-<version>-win.zip` |

推送 `desktop-v*` 会打包并发布。`publish=false` 的手动触发只打包。发布必须来自匹配标签；`contents: write` 仅限于 publish job。publish job 只上传 `*.zip`、`*.AppImage` 和 `SHA256SUMS`；像 `linux-unpacked` 这样的 electron-builder 残留目录不会进入 Release。Release 说明先写归档约定，再列出距上一个 `desktop-v*` 标签的提交（`scripts/desktop/pack.ts` 中的 `desktopReleaseNotes`）。

## Alternatives considered

**把 desktop 并进 npm `dsh` family。** 不予采纳，因为 `apps/desktop` 是私有 Electron 外壳，npm tarball 也不是安装包。加入该 family 要么发布 Electron，要么仍让用户拿不到可下载应用。

**把 Python 单文件 `pkg --sea` 产物当作 Host。** 不予采纳，因为那份可执行文件是 JSON-RPC SDK runtime，不是 `dsh web`。desktop 需要 web profile、frontend dist 和 CLI bin。

**只发布 Electron 窗口，并要求系统已安装 `dsh` / Node。** 不予采纳，因为 Finder 和开始菜单启动会继承很短的 GUI `PATH`。可下载应用必须自带 Host。

**用一个 Ubuntu job 交叉打包所有目标。** 不予采纳，因为内置 Node 二进制必须来自匹配的 runner，而且 electron-builder 的原生目标已经按操作系统分配。

**在本序列中做代码签名和自动更新。** 作为后续产品步骤不予采纳。本序列发布未签名归档，让一个标签就能产出可下载应用。

**通过 `pnpm dlx` electron-builder 打 Windows NSIS 安装包。** 不予采纳，因为 `pnpm dlx` 会把 app-builder-lib 模板嵌进过长路径，makensis 打不开 `StdUtils.nsh`。Windows 产物改为打包后的应用 zip。

## Consequences

一个 `desktop-v*` 标签就足以产出三份安装包和一次 GitHub Release。npm `dsh` 序列不变。打包后的启动不再依赖 checkout 或系统 Node；checkout 上的 `pnpm desktop` / `dsh desktop` 仍然依赖。

代价：

- **未签名产物。** 在加入签名之前，macOS Gatekeeper 和 Windows SmartScreen 会在首次启动时警告。
- **Host 体积。** 每个安装包都内嵌 `@deepseek-ai/dsh` 的 `pnpm deploy` 和 Node，下载体积远大于 Electron 外壳。
- **deploy 时安装 peer。** `@deepseek-ai/dsh` 不是封闭 runtime manifest；pack 打开 `auto-install-peers`，暂存的 Host 才能启动 `dsh web`。
- **未签名，没有 electron-updater。** 打包桌面端仍可从该 GitHub Release 安装匹配的归档（[应用内更新](../feature/2026-09-16-desktop-in-app-update.zh.md)）。签名仍然推迟。

## Testing

`scripts/desktop/pack.spec.ts` 固定标签命名、产物名、平台 flag、Windows 上的 `pnpm.cmd` 启动、发布标签拒绝，以及 changelog 说明。`apps/desktop/tests/host.spec.ts` 固定打包 Host 识别、对内置 Node 的优先选择，以及 512px 安装包图标。工作流是实际执行的打包与发布路径。
