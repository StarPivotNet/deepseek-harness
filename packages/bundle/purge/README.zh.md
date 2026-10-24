---
description: "组织内置的 Purge 提示词管理、宿主兼容补丁与红队演练台。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-purge

[English](README.md) | 中文

## 概述

将完整的 Purge 插件随组织版 dsh 发布。Web、Desktop、Headless、SDK 和 ACP 默认组合都会加载它；启动后应用宿主兼容补丁，并提供提示词规则、技能、红队演练台和预设。`sdk-minimal` 不包含它。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [来源与署名](#attribution)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

无需单独安装。打开 **设置 → Purge** 管理补丁、提示词、规则、技能和红队演练台。红队演练前必须完成授权流程和本机环境配置。

启动时只修补当前宿主安装，可能需要重启。升级时，在 profile 的 `dsh.profile.bundles` 列表中保留 `!@deepseek-ai/dsh-purge` 标记可明确拒绝加入。后续 profile 补丁也可覆盖插件条目，或将 `dsh-purge.config.enabled` 设为 `false`。

此包随 `StarPivotNet/deepseek-harness` 统一发版，不提供原上游更新路由。`POST /redteam/api` 保留版本查询兼容性，但拒绝单独更新包；`/dsh-purge/update` 接口整体移除。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`cordis.patch.yml` 加载根插件、红队自举、共享 SQLite 存储和 HTTP 桥接。`src/index.ts` 是 TypeScript Loader 入口；`runtime/` 是维护中的 JavaScript 实现，独立于生成的 `lib/` 产物。`client.js` 已采用客户端模块加载器格式。`presets/` 和 `skills/` 作为包资源发布。

`LICENSE`、`NOTICE.md` 和 `DISCLAIMER.md` 保留原插件的 MIT 许可证、署名和用户声明。`UPSTREAM.md` 保存源分支文档；当前组织行为以本 README 为准。

-----

<a id="attribution"></a>
## 来源与署名

实现来自小杨的 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)，并包含 JeffKeeping 分支的 1.4.2 修改。本组织包保留原作者、维护者及引用的第三方声明；不允许声明中禁止的商业转售或其他用途。

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到的内容

根插件提供当前操作提示词和能力指引，注册 `purge_status`、`purge_apply`、`purge_revert`、`purge_audit`，并增加 `/purge`、`/rules`、`/skills` 命令。红队预设提供角色指引和 `runtime/redteam/tools.js` 定义的演练工具；工具目录从实际组合生成。

#### Token 影响

启用后，提示词增加固定文本和所选规则内容；红队角色文本取决于预设与子角色。工具 schema 增加条件性的固定开销。

#### KV Cache 影响

修改提示词、规则、预设或工具集合会替换请求前缀。未变化的会话保留已有前缀，实际缓存行为取决于模型服务。

## 已知限制与暂缓工作

- 宿主兼容补丁依赖具体版本，可能需要重启。新宿主可能留下待匹配补丁；先查看设置状态，并用 `node scripts/compat-check.mjs` 在隔离副本上验证后再修改补丁锚点。
- 红队演练台需要另行安装工具和凭据，不会自动提供 VPS、FOFA key 或目标授权。
- `sdk-minimal` 和显式禁用此层的 profile 不提供这些工具或界面。
