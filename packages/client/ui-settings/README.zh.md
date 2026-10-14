---
description: "设置领域底座插件：共享配置表单、设置命名空间 scope 服务、schema 服务，以及 dsh Web 客户端的规范设置 slot 类型约定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings` 是 dsh Web 客户端每个偏好设置界面都依赖的底座：功能插件绑定一个命名空间，或读取共享配置表单，即可在宿主设置文档中存储或编辑自己的偏好设置行，而无需重新实现传输层或 schema 处理。`ctx.settingsScope` 从共享文档镜像派生按命名空间的 scope，并以 revision 设栅，因此来自另一界面的并发写入会被拒绝，而不是被静默覆盖；`ctx.configForms` 为每个 Host 条目共享一条已接受值写入队列；`ctx.settingsSchema` 同步重建并校验 schema、编辑不可变路径。它声明设置界面所填充的 slot 类型——`settings.trigger`（账号条界面框架，无障碍名称仍为「设置」）/`settings.header`/`settings.close`（界面框架）、`settings.action`（有序标题栏操作）、`settings.section`（每项功能一页）、`settings.plugins.tab` 与 `settings.onboarding`——而自身不渲染任何内容。由于它不依赖任何 `ui-*` 呈现包，任何持有偏好设置的功能都能够到它；设置外壳本身位于 ui-settings-general。

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

功能插件用本包存储与编辑自己的偏好设置，而无需重新实现传输层或 schema 处理。每个组合挂载一次即可；它注入 `remote` 服务及其 `settings` 命名空间，并持有浏览器中唯一的 `settings.describe` 读取方。

### 绑定命名空间

功能调用 `ctx.settingsScope.bind(spec)` 并传入按命名空间的 spec，得到一个由共享文档镜像派生的 scope。scope 快照携带解析后的分区、组合 `base`、原始 `user`、revision、可写性以及 host/内存模式；字段只要出现在 `user` 中即视为覆盖，即使其值与 `base` 相等，`unset` 会清除该覆盖。写入经 scope 进行：`set` 与 `unset` 提交一个操作，`mutate` 则原子提交多个有序操作。每次写入都以命名空间 revision 作为 `expectedRevision` 围栏，因此来自另一界面的并发写入会被拒绝，而不是被静默覆盖。暂存编辑器可以把开始草拟时读取的 revision 作为固定围栏传入；否则 scope 使用最新排队或镜像 revision。产品组合（包括 `--trusted-host` 页面）以 host 模式绑定。

### 配置表单

`ctx.configForms.developerTools` 管理代码工作工具开关与 Web 和桌面端共享的偏好 `ui-settings.enabled`，默认为 `true`。其 `enabled` 可观察值发布已接受的选择，`setEnabled` 使用相同的有序设置写入。桌面端和每个已认证的 Web 浏览器都将设置持久化到 Host 文档。此设置控制界面展示和 HTML 预览权限，不控制 Host 授权或 Session 记录。使用 Host 偏好的客户端在首个经过 schema 解析并接受的值到达前保持开发者功能关闭；首次响应缺失或失败不会启用它们。后续刷新保留已接受的选择。

功能适配器使用 `ctx.configForms.get(entryId)` 获取该 Host 条目所有编辑器共享的已接受值和写入队列。快照包含解析后的 `value`、继承 `base`、原始 `user`、修订号、可写性和持久化模式。`set` 与 `unset` 提交单个操作，`mutate` 提交一个原子操作列表。暂存编辑器传入编辑前读取的修订号；冲突时保留草稿。清除操作移除覆盖并恢复继承。

配置表单对每个已认证浏览器都通过 Host settings 服务持久化；该策略由[已认证浏览器 Host 偏好笔记](../../../.agents/notes/implemented/bug-fix/2026-09-15-authenticated-browser-host-preferences.zh.md)拥有。写入是否被接受由 `settings.describe.writable` 决定。

### 跟随被服务的命名空间

编辑另一个插件所拥有命名空间的页面通过 `ctx.configForms.whileServed(namespaces, register)` 注册：只要所列命名空间中的任一个进入共享镜像，`register` 就运行一次，收到 Host 当前服务的命名空间集合，并返回该注册的 disposer；当它们全都不再被服务，或 `whileServed` 返回的 disposer 被调用时，这个 disposer 就运行。调用方持有返回的 disposer 并把它包进 `ctx.effect`；与 `get` 不同，服务不会在调用方的 context 上注册任何东西。因此从未组合过所有者的部署看不到该页面的任何痕迹，Host 停止服务的命名空间会撤下它。插件页上的四个官方页面各自通过一个伴生包走这条路径。

### 填充设置 slot

设置界面会注册进本包声明的 slot 类型。外壳（`sidebar.settings` 占位方、导航、界面框架）位于 ui-settings-general；功能页面注册 `settings.section` 贡献；「插件」分区承载 `settings.plugins.tab` 页面；首次使用引导步骤注册 `settings.onboarding`。跨命名空间的表面（schema 内省、已服务命名空间目录、`hasDocument`）通过 `ctx.settingsScope.describe()` 与 `ctx.configForms.describe()` 读同一面镜像。

### 可观察的成功与失败

绑定后的 scope 会立即反映当前文档 revision；提交成功的写入把应答折回镜像、不再重读。被拒绝或失败的最新写入触发一次镜像恢复读取；被取代的写入把恢复留给后继者。浏览器使用序列化的 Config schema 校验；Host 校验完整配置，包括无法序列化的检查。若 spec 未提供 `decode`，则分区不是普通对象或未通过 schema 重建时一律不发布任何值，于是行渲染自己的缺失状态，而不是一份半解码的值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

可选的 `settings.launcher` 贡献接收侧栏布局、设置面板是否覆盖侧栏、设置导航回调，以及有效的设置键位标签和无障碍组合。命令未绑定时，外壳不传快捷键展示信息；未注册入口时，外壳保留普通设置按钮。

<details>
<summary>实现细节——点击展开</summary>

本包实现一条归属规则：浏览器保留设置文档的一面共享镜像，每个派生表面都读这同一真源，因此任一时刻看到的都是同一份文档 revision。

### Describe 镜像

`ui-settings` 条目的 Host Config 声明默认开启的 `enabled` 偏好。Client 插件注入 `remote` 及其 `settings` 命名空间，为该组合一次性解析 Host 持久化模式（每个已认证浏览器与 `--trusted-host` 页面为 host；memory 仅用于显式组合与测试），并持有浏览器中唯一的 `settings.describe` 读取方：一面共享镜像，在每次转发的 `settings/document-updated` 事件与 `connection/reset` 时刷新（首次连接也包含在内，关闭「提交落在急切读取与 SSE 订阅之间」的窗口）。跨命名空间表面通过 `ctx.settingsScope.describe()` 与 `ctx.configForms.describe()` 读它，这是一个读取/折叠面（`getSnapshot`/`subscribe`/`ensure`，另有把写应答折入的 `acceptView`）。

### Scope 派生

`ctx.settingsScope.bind(spec)` 在调用方的 context 上返回一个由镜像派生的按命名空间 scope：scope 的 disposer 归调用方 fiber 所有，绑定不新增任何线路读取，某一行的激活绝不会阻塞在设置传输层上。写入仍归各 scope：`set` 与 `unset` 是 `mutate` 的单操作形式，后者会复制操作列表，并把多个有序字段操作排在同一个作为 `expectedRevision` 的命名空间 revision 之后。提交成功的 mutation 把应答折回镜像，被拒绝或失败的最新 mutation 触发一次恢复读取，被取代的 mutation 把恢复留给后继者。冷启动读取次数由 `../../../apps/web/tests/startup-rpc-budget.e2e.ts` 钉住；客户端代码中新增直连 `settings.describe` 调用即是对它的回归。

### 共享条目写入

提供者为每个 Host 条目持有一个控制器，包括其订阅和写入队列；重复调用 `get(entryId)` 返回同一表单。消费者释放自己的视图订阅。启动 RPC 预算覆盖共享的 describe 读取。

### Schema 服务

`ctx.settingsSchema` 重建 schema、校验草稿并编辑嵌套值。若 spec 未提供 `decode`，则分区不是普通对象、未通过其重建后的 schema 校验、或携带本客户端无法重建的 schema 信封时，一律不发布任何值。无效的线路值不会替换已接受值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置界面家族及其背后的持久化 seam。

- [ui-settings-general](../ui-settings-general/README.zh.md)——设置外壳：触发控件、导航、「通用」分区、引导投影。
- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——围绕清单标签页的「内置插件」分区壳及其可配置宿主平面卡片。
- [ui-settings-shell](../ui-settings-shell/README.zh.md)、[ui-settings-agent-loop](../ui-settings-agent-loop/README.zh.md)、[ui-settings-subagent](../ui-settings-subagent/README.zh.md)、[ui-settings-web-search](../ui-settings-web-search/README.zh.md)——插件页上的官方配置页，各自通过 `whileServed` 跟随其命名空间。
- [ui-settings-models](../ui-settings-models/README.zh.md)——建立在本底座之上的 Models 页面与 DeepSeek 引导。
- [settings](../../settings/README.zh.md)——持久化用户设置 seam 及其文件提供方。
- [ui-sidebar](../ui-sidebar/README.zh.md)——底部席位承载设置触发控件的侧边栏外壳。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明设置传输层的覆盖范围以及谁共享同一份 settings 文档；它们是当前包约束。

- **memory 模式组合永远不会到达 Host 设置**：显式的 `memory` 镜像或 controller 保持 `unavailable` 且从不跨线路；产品 `bind()` 与配置表单始终使用 host 持久化，包括 `--trusted-host` 页面和每个已认证浏览器。[ui-settings-general](../ui-settings-general/README.zh.md) 中的「打开配置文件」仍仅限 loopback。
- **Host 偏好由各认证入口共享**：访问同一 settings 文档的浏览器共享其持久化偏好，而非各自保存浏览器偏好。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
