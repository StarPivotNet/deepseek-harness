# Agent Note: Compaction inherits the conversation's same-route reasoning effort

Status: implemented

[English](2026-08-19-compaction-inherits-same-route-reasoning-effort.md) | 中文

## 问题

自动压缩会发出一次性 `ctx.llm.stream()` 调用，并设置 `purpose: 'compaction'`。该调用会复制会话的提供方、模型、系统提示词、工具与已遮蔽消息，以便复用提供方的前缀 cache，但不点名 `reasoningEffort`。

在 `openai-responses` 上，已声明推理能力的模型如果没有选定强度，会按模型的 `off` 映射序列化 `reasoning.effort`。把 `off` 映射为 `none` 的 profile 会发出 `effort: "none"`。网关背后的 GPT-5.6 模型会以 HTTP 400 `invalid_request_error` / `Upstream rejected the request` 拒绝该载荷。同一路由上带 `xhigh` 的会话请求则能成功，于是压力一直高于阈值，压缩反复重试；未回收历史加上新输入不再放得下时，后续会话轮次也会以同样方式失败。

失败的野鸡验证会话 `session-4f5ac887-1b6f-4cd8-96ff-07d5000638d1` 记录了 88 次带该 400 的 `compaction/end`，而其会话 `request/header` 携带的是 `mqj-gpt` / `gpt-5.6-sol` / `reasoningEffort: "xhigh"`。

## 决策

`summarizeWithLlm()` 在解析摘要提供方／模型之后，复制同一路由上的 `reasoningEffort`。来源是最新已记录请求头——当该请求头使用摘要器的提供方／模型对时；否则是同一对上的 `AgentOptions.reasoningEffort`。已配置或其它不同的摘要路由则不设置推理强度，以便应用新模型的适配器默认值。`prepareCall()` 仍会在提供方 I/O 前拒绝不支持的标识。

会话标题辅助调用继续走各自的用途路径。DeepSeek 适配器已经为 `purpose: 'session-title'` 禁用思考；其他适配器自行负责该用途。

这与[进程内子 agent 继承](2026-08-19-subagent-inherits-parent-reasoning-effort.zh.md)是同一条同路由规则，应用到压缩摘要器而不是子 agent。

## 考虑过的替代方案

**让 pi-ai 在 `openai-responses` 未选定强度时省略 `reasoning.effort`。** 否决，因为责任不在这里：会话已经选定了显式强度，同一路由上的摘要器必须发送同一请求。即使网关接受该请求，省略字段仍会丢掉 `xhigh`。

**强制摘要器使用 `off`。** 否决，因为把 `off` 映射为 `none` 的 profile 正是失败载荷；同一路由上的摘要器本应复用会话前缀，而不是另造一种思考模式。

**即使摘要器更换模型，也复制会话推理强度。** 否决，因为推理强度标识由适配器所有、且按模型而定。把 `xhigh` 带到未公布该档位的模型上，会在压缩落地前以 `UNSUPPORTED_REASONING_EFFORT` 失败。

## 测试

`packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` 断言同一路由上已记录的 `xhigh` 会到达摘要调用，而已配置的不同摘要路由会丢掉它。`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 断言带 `off: none` 的 `openai-responses` 模型在未选定强度时发送 `reasoning.effort: "none"`，点名 `xhigh` 时发送 `xhigh`。

不新增无密钥快照：已交付示例不组合该网关 profile，缺陷是摘要器 `GenerateOptions` 缺少继承字段，现已由聚焦测试钉住。

## 后果

同一路由上的自动压缩现在会发送会话选定的推理强度，因此 Web 会话在 `gpt-5.6-sol` / `xhigh` 上不再产生序列化为 `effort: "none"` 的摘要请求。不同摘要路由仍不设置推理强度。已经覆盖 `AgentOptions.reasoningEffort` 的调用方，在同路由回退时保留该覆盖。
