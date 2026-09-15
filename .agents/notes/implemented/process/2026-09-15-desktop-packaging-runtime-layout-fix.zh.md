# Agent Note: 桌面打包运行时布局修复

Status: implemented

[English](2026-09-15-desktop-packaging-runtime-layout-fix.md) | 中文

## 问题

自 `desktop-v0.1.3-alpha.2.1`(2026-09-05)起的所有桌面 mac 归档——包括 `0.1.5` 全线直到 `rc.2.2`——启动即挂死:无窗口、无 Host、无输出。对卡住的主进程采样显示它阻塞在 `-[NSAlert runModal]`,即 Electron 默认的未捕获异常对话框。

两个互相独立的打包缺陷造成这一状态:

1. **asar 缺运行时依赖。** 仓内产品更新检查器(PR #3)把 `electron-updater` 与 `semver` 加进 `dependencies`,而 tsdown 默认外置 `dependencies`,于是 `lib/main.js` 保留了两个裸的顶层 import。`scripts/desktop/pack.ts` 暂存的是无依赖清单(`pinStagedElectronVersion`),`files` 又不含 `node_modules`,归档里没有任何东西能解析它们。模块错误发生在 `app.whenReady()` 之前,模态框永久阻塞进程。CI 看不到它,因为冒烟步骤只跑暂存的 Host 树,从不跑 Electron 主 bundle。
2. **资源布局错配。** `0.1.5` 主进程加载 `Resources/runtime/node`、`Resources/runtime/pnpm/bin/pnpm.mjs` 与 `Resources/dsh`,桌面首启管理器用它们构建 `~/.dsh/profiles/desktop`。`pack.ts` 仍按 `0.1.3` 时代的 `Resources/host` 树从 `pnpm deploy` 组装,即使 bundle 能加载也找不到运行时。

`apps/desktop` 的 `package-target.ts` 链(runtime + 包集 + 带启动冒烟的 `dsh`)正是为该布局所写,但从未接进 `Release (desktop)`。

## 决策

`pack.ts` 继续拥有 fork 发布流——锁定版 electron-builder、无签名 `identity: null`、中文 Release 说明、tag 校验——并把资源准备委托给 `apps/desktop` 链,替换自己的 `pnpm deploy`:

- `prepareDesktopRuntime()` 运行 `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts <target> --prepare-only`,后者执行官方构建、打包 dsh/vendor/Landlock 家族、准备 `runtime/`(Node 24 + 锁定版 pnpm)与 `dsh/`,并对确切的资源树做启动冒烟(`smokeDesktopRuntime`)。`--prepare-only` 在 electron-builder 之前停下,因为官方路径要求 Apple 凭据。
- `extraResources` 改为装配 `runtime` → `runtime`、`dsh` → `dsh`,并显式加入 `dsh/node_modules`,因为 electron-builder 会丢弃源目录根部的 `node_modules`。
- `prepare-dsh.ts` 接受 `DSH_DESKTOP_UNSIGNED_RUNTIME=1` 以跳过 `signMacOSRuntime`:fork 发布无签名,外壳 app 即信任根,原生文件保留链接器 ad-hoc 签名。`verifyDesktopRuntime` 校验的是清单而非签名,链路其余部分不变。
- tsdown 增加 `deps.alwaysBundle: ['electron-updater', 'semver']`,`lib/main.js` 重新自包含,无依赖暂存清单保持诚实。
- `linux-x64` 加入 `DesktopPackageTargetName`、`desktop-build-paths` 与 auto-update target 联合类型,因为 fork 发布 AppImage,而 prepare 链经这些表解析路径。`package:linux:x64` 脚本暴露它。
- workflow 的 `Boot-smoke the staged Host` 步骤删除:pack 内部的 prepare 链拥有启动覆盖,且针对真实 DesktopHostProcess 而非已退役的 `host/` 树。

## 插件市场在桌面上的恢复

第一版可用包禁用了市场三行:`plugin-catalog` 注入 `webServer`(桌面走管道),市场 Host 半边注入 `profile`(桌面由 Electron 主进程管理 profile),两者永远 pending 并触发 Host 激活检查失败。这丢掉了 fork 的 Discover UI,不可接受——现在通过三个窄适配让这些行在桌面运行:

- `runDesktopHost` 用 Electron 拥有的桌面工程目录调用 `provideProfile`,profile 感知的 Host 行(市场读取、安装、命令)解析到与 Electron 管理者相同的目录;变更仍受 Electron 侧下次启动的锁对账约束。
- 无 `webServer` 端口时,`fetchCatalog` 直接从 profile 内安装的 `dsh-host-plugin-catalog` 包读取内置目录;Web profile 的 HTTP 自取路径保持原样。
- `prepare:runtime` 在 `runtime/pnpm/bin` 写入可执行 `pnpm` shim(`.cjs` 由 `node` 驱动),Electron 的 Host 环境把该目录前置到 `PATH`,Host 内的 `runProfilePnpm` 安装解析到包内 pnpm 而非系统 pnpm。

`plugin-catalog` 行本身仅在桌面上保持禁用:其 HTTP 路由在桌面没有消费者,Discover 经 `readShippedCatalog` 读同一文件;Web 组合行未动,仍由 `verify-fork-customizations` 门禁守护。

## 验证

- `tsc -b apps/desktop` 与桌面 bundle 构建通过;`grep` `lib/main.js` 的外部 import 只剩 `electron` 与 `node:` 内置。
- `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts mac-arm64 --prepare-only` 配合 `DSH_DESKTOP_UNSIGNED_RUNTIME=1` 完成,留下 `.desktop-build/targets/mac-arm64/{runtime,dsh}`。
- `pnpm exec tsx scripts/desktop/pack.ts --platform darwin` 消费这些根;产出的 zip 必须解包检查 `Contents/Resources/runtime/node`、`Contents/Resources/dsh`,以及 asar 内 `main.js` 无裸 npm import,再安装。打包后的 app 在不出现模态框的前提下到达首启 profile 构建,即视为存活。
