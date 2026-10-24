---
description: "内置红队演练台、预设、技能、工具与演练存储。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-redteam

[English](README.md) | 中文

## 概述

为组织版 dsh 提供红队演练台、角色预设、随包技能、演练工具、SQLite 存储和 HTTP 桥接。`@deepseek-ai/dsh-purge` 默认组合会加载此包，无需单独安装。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

打开 **设置 → Purge → 演练台**，完成授权流程，配置所需的本机工具和凭据。演练任务选择 `redteam` 预设。数据保存在 `$DSH_HOME/redteam`，用户预设保存在 `$DSH_HOME/.agent-presets/redteam`。

<a id="understand-the-implementation"></a>
## 理解实现

根插件安装预设和技能；`store` 发布 `ctx.redteam`；`tools` 在当前工具注册表上注册模型工具；`ui` 提供演练 HTTP 桥接与环境检查。`src/` 中的 TypeScript 入口加载 `runtime/` 中维护的 JavaScript 实现。`presets/` 和 `skills/` 作为资源发布，`lib/runtime/preset-composition.js` 在入口和运行时之间共享解析器。

代码来自 `YuJunZhiXue/dsh-purge` 及 JeffKeeping 分支。`LICENSE`、`NOTICE.md` 和 `DISCLAIMER.md` 保留原作者和声明。版本与更新由 `StarPivotNet/deepseek-harness` 统一管理，不获取上游发布或安装独立更新。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到的内容

预设提供角色指引和 `lib/runtime/tools.js` 声明的演练工具。工具 schema 以实际组合为准；Purge 层被禁用时不会出现这些工具。

#### Token 影响

角色文本与工具 schema 产生条件性的固定开销。技能正文按需加载，不会进入每次请求。

#### KV Cache 影响

修改预设或工具目录会替换请求前缀。技能和演练数据读取是独立的工具结果。

## 已知限制与暂缓工作

- 工具和凭据配置不在此包内；缺少 FOFA key、VPS 访问或二进制时，预检会明确显示。
- 演练预设通过 Host 注册表提供，需要完整 dsh 组合；`sdk-minimal` 不包含它。
