---
description: "Web GUI 的产品更新插件：Host 侧轮询 GitHub Releases、通用设置行、叠加层 toast，以及打包桌面端的安装。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-update

[English](README.md) | 中文

## 概述

本包是 CLI/Web 与打包桌面端的应用内产品更新信号。Host 侧按 24 小时间隔轮询 GitHub Releases，把最近一次成功结果缓存在 `product-update` settings namespace，并通过 Host Connection RPC 注册表提供 `/product-update`。浏览器侧挂载通用设置行和 shell 叠加层 toast。检查本身不下载归档；**打开发行说明**会打开 GitHub URL。在打包后的桌面端，匹配的归档还可以通过 `window.dshDesktop` **安装**。

通道选择默认 `auto`：Electron 窗口启动 `dsh web` 时写入 `DSH_PRODUCT_CHANNEL=desktop`，匹配 `StarPivotNet/deepseek-harness` 上的 `desktop-v*` 标签；否则匹配 `deepseek-ai/deepseek-harness` 上的 `dsh-v*` 标签。显式 `repo` 配置仍然优先。比较版本优先使用 `DSH_PRODUCT_VERSION`，否则使用已发布 CLI 包版本，再否则使用本包自身的 package.json。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 Web bundle 已经挂载本插件。打开 **设置 → 通用** 即可看到已安装版本、上次检查和 **立即检查**。当存在尚未忽略的更新标签时，叠加层 toast 提供 **发行说明** 与 **忽略**。在打包后的桌面窗口中，匹配的归档还会提供 **安装**，然后是 **重启**。**立即检查** 是唯一由客户端发起的轮询；新打开的标签页从 Host 缓存注水，而不会自己请求 GitHub。

### 何时选用

当 Web GUI 需要告知用户存在更新的 GitHub Release 时挂载本插件。没有产品通道、或已经自有更新器的自定义 profile 请不要挂载。CLI 与浏览器标签页仍然只打开 GitHub URL。打包桌面端的安装由 `apps/desktop` 实现，而不是由本 Host 轮询器实现；本包只附加产物并渲染 **安装**。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `channel` | `auto` | 发行通道；`auto` 读取 `DSH_PRODUCT_CHANNEL` |
| `repo` | — | GitHub `owner/repo`；省略时跟随通道 |
| `checkIntervalMs` | `86400000` | GitHub 轮询间隔，单位为毫秒 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-client-ui-update)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 失败

轮询失败时保留最近一次成功结果 24 小时，因此 GitHub 中断不会让该行变空。没有缓存时，该行显示 **无法检查更新。** 插件从不写入不是 `https://github.com/...` 的发行 URL。桌面端 SHA256SUMS 拉取失败时仍然保留该标签，并省略 `artifact`，因此 **安装** 保持隐藏。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明 Host 轮询器与浏览器行如何搭建；可观察行为见[使用本包](#use-this-package)。

Host fiber 注册持久缓存、`/product-update` 通道（`check` / `dismiss`），以及 24 小时 `setInterval`。dispose 时清除计时器并中止进行中的 fetch。每次轮询在已缓存 ETag 时发送 `If-None-Match`，对响应体做哈希，并在 304、哈希未变、速率限制或间隔内的网络错误时复用 `lastResult`。`auto` 通道读取 `DSH_PRODUCT_CHANNEL`；默认 GitHub `owner/repo` 跟随具体通道，除非配置了 `repo`。在 desktop 通道上，成功选出标签后会再拉取 `SHA256SUMS`，并在名称、下载 URL 与摘要匹配时为 darwin/arm64、linux/x64 或 win32/x64 附加归档。浏览器侧绑定 settings scope、采纳 `lastResult`，并且只从 **立即检查** 和 **忽略** 调用 RPC。`window.open` 仅在 `isGithubHttpsUrl` 通过后执行。**安装** 仅在 `canInstall()` 为 true 时调用 `window.dshDesktop`。Host 与浏览器分别在 `tsconfig.host.json` 和 `tsconfig.client.json` 中类型检查，这样 `src/index.ts` 可以使用 Host 的 `ctx.connection`，而不会把该形状合并进浏览器的 `ConnectionHandle`。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 半侧：settings 缓存、`/product-update` RPC、24 小时轮询 |
| [`src/checker.ts`](src/checker.ts) | GitHub Releases 轮询器（ETag、body-hash、陈旧回退、桌面产物） |
| [`src/artifact.ts`](src/artifact.ts) | 归档名称、SHA256SUMS 解析、产物附加 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器半侧：字典、设置行、叠加层 toast、桌面端安装 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当更新行不够用时阅读以下页面。它们从本插件进入设置外壳、桌面窗口与客户端包映射。

- [ui-settings-general](../ui-settings-general/README.zh.md) — 声明 `settings.general.item` 并拥有设置外壳。
- [settings](../../settings/README.zh.md) — 存储产品更新缓存的持久用户设置缝。
- [`@deepseek-ai/dsh-desktop`](../../../apps/desktop/README.zh.md) — 下载并应用已附加归档的打包窗口。
- [客户端包映射](../README.zh.md) — 相邻的浏览器 UI 包。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-client-ui-update) — 每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

无。该插件轮询 GitHub 并渲染浏览器 UI；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前更新表面。它们是当前包约束，不是打包对比或任务积压。

- **CLI/Web 从不下载或安装** — 这些表面只打开 GitHub Release URL。打包桌面端的安装由 [`apps/desktop`](../../../apps/desktop/README.zh.md) 拥有。
- **仅匹配的归档** — 安装需要 `SHA256SUMS` 以及 darwin/arm64、linux/x64 或 win32/x64。其他三元组仍只用 **打开发行说明**。
- **仅 GitHub Releases** — 每个通道一个公开仓库源；不支持私有源或镜像。
- **陈旧缓存回退** — 轮询失败时保留最近一次成功结果 24 小时，因此 GitHub 中断不会让该行变空。
- **未签名桌面产物** — 首次启动时的 Gatekeeper / SmartScreen 警告仍属于打包问题，不属于本插件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
