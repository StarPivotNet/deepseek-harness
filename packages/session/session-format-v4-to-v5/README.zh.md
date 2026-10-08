---
description: "恢复 V4 会话并保留 Automation 来源。"
kind: package-library
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 摘要

在保留来源的同时持久化 Automation 会话，并将 V4 会话读取为 V5。格式目录自动消费此库。历史分支的 Automation 日志通过专用 V0–V3 导入器进入；已发布 V4 的接纳规则保持不变。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

调用方使用[格式目录](../session-format-catalog/README.zh.md)完成完整恢复。此库没有挂载插件或配置档配置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

V4 到 V5 仅更改头部版本。事件值、标识、时间、序号引用和继承切点保持不变。V4 投递确认保留原代际及坐标；迁移在它们成为历史记录前校验其 V4 归属。声明 V5 的源标记被拒绝。

V5 头部在 `subagent` 之外接纳可选的 `origin: automation`。编解码器复用 V2 物理编码和 V4 工具角色行校验。原生恢复结合 V5 头部与投递规则，以及 V4 消息、生命周期和目录规则。V5 接纳具有非空 `plugin` 的插件来源，以及具有非空 `ruleId` 的自动化来源；已安装的 Session 校验补充当前事件词汇和投影。未知必读事件被拒绝，未知可忽略事件保持不透明。

目录导入版本 0 至 3 的历史分支输入，包括 `automation/start` 和 `workspace/home` 事件。它单独保留可选的 `origin: automation`，解码历史头部和事件体，再将 V3 事件内容直接转换为经过校验的 V5 制品。它不发布中间 V4 制品。父会话对应的子会话证据是必需输入。源代际保持不变。

此库没有可独立观察的运行时状态，因此不提供运行时不变量安装器。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [格式版本状态](../../../docs/session-format-status.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 历史恢复

#### 模型看到的内容

恢复保留已记录的消息文本和工具结果。若 `step/end` 后紧接 `reason.kind: error` 的 `turn/end`，可以保留尚无结果的工具调用；恢复不会添加结果或断言这些工具是否已执行。

#### Token 影响

恢复不添加请求文本或承载 Token 的数据。

#### KV Cache 影响

已记录的消息前缀保持不变。提供方的缓存可用性不由此库管理。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **历史分支词汇** — 超出已发布 V3 词汇的分支必读事件可能被拒绝；头部往返不代表完整历史事件体兼容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
