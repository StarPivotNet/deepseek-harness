# Agent Note: In-process subagents inherit the parent's same-route reasoning effort

Status: implemented

[English](2026-08-19-subagent-inherits-parent-reasoning-effort.md) | 中文

## 问题

Web 父会话通过 `installModelSelection` 携带所选推理强度，并把它记入 `request/header`。进程内子 agent 只继承 `provider`、`model` 和 `maxTokens`。因此它们的第一次请求不点名任何推理强度。

在 `openai-responses` 上，已声明推理能力的模型如果没有选定强度，会按模型的 `off` 映射序列化 `reasoning.effort`。把 `off` 映射为 `none` 的 profile 会发出 `effort: "none"`。网关背后的 GPT-5.6 模型会以 HTTP 400 `invalid_request_error` / `Upstream rejected the request` 拒绝该请求，发生在子 agent 的第一轮；同一路由上带 `xhigh` 的父会话则能成功。

## 决策

`AgentOptions.reasoningEffort` 是一等创建选项。当不存在相同路由上的已记录强度时，agent loop 把它写入首次 `LlmCallConfig`；`prepareCall()` 仍会在提供方 I/O 前拒绝不支持的标识。

`resolveChildAgentOptions()` 在继承提供方／模型／`maxTokens` 之后、请求覆盖之前，复制父级相同路由上的推理强度。来源是父级最近一次已记录请求——当该请求使用子 agent 的提供方／模型对时；否则是同一对上的 `parent.options.reasoningEffort`。子 agent 更换提供方或模型时，不会继承上一模型的不透明推理强度。`dsh-tool-subagent` 接受可选的配置字符串 `reasoningEffort`，并在转发前将其品牌化。

冷恢复仍然不把按次激活的旋钮写入 `subagent/descriptor`。恢复后的子 agent 只重建持久路由，然后采用该路由当前的适配器或提供方默认值。

## 考虑过的替代方案

**即使子 agent 更换模型，也复制父级最近一次已记录的推理强度。** 否决，因为推理强度标识由适配器所有、且按模型而定。把 `xhigh` 带到未公布该档位的模型上，会在子 agent 运行前以 `UNSUPPORTED_REASONING_EFFORT` 失败。

**让 Web `api-proxy` 给每个进程内子 agent 安装 `installModelSelection`。** 否决，因为 spawn 与 fork 子 agent 由 subagent 驱动器创建，而不是 `composeAgent()`。仅限 Host 的钩子会漏掉已经在 `AgentOptions` 上声明强度的 headless、ACP 与 SDK 父级。

**改 pi-ai，使 `openai-responses` 在省略强度时继续省略该字段。** 否决，因为责任不在这里：父级已经选定了显式强度，同一路由上的子 agent 必须发送同一请求。即使网关接受该请求，省略字段仍会丢掉父级的 `xhigh`。

**把推理强度持久化到 `subagent/descriptor`，并在冷恢复时还原。** 否决，因为描述符已经把 `maxTokens` 视为按次激活预算，而不是持久组合。在父级或部署默认值变化后还原陈旧强度，会把恢复后的子 agent 钉在当前路由可能不再支持的值上。

## 测试

`packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` 断言子 agent 会继承 `xhigh`、显式子级强度会覆盖它，以及更换子模型会丢掉上一模型的强度。`packages/core/agent-loop/tests/loop.spec.ts` 断言 `AgentOptions.reasoningEffort` 会写入首次请求，且空标识在发布前被拒绝。

失败的 Web 子会话（`dae08b37-b812-44a5-9929-8d796874f3ea` 及其兄弟）记录了 `mqj-gpt` / `gpt-5.6-sol` 且没有 `reasoningEffort`；父会话 `session-5547be63-7814-4a86-831e-1b968669d463` 在同一路由上记录了 `reasoningEffort: "xhigh"` 并完成。不新增无密钥快照：已交付示例不组合该网关 profile，缺陷是子 agent 首次 `request/header` 缺少继承字段，现已由聚焦测试钉住。

## 后果

同一路由上的进程内子 agent 现在会发送父级选定的推理强度，因此 Web 父级在 `gpt-5.6-sol` / `xhigh` 上不再产生序列化为 `effort: "none"` 的子请求。更换子路由时仍不设置推理强度，以便应用新模型的适配器默认值。已经覆盖 `agentOptions.reasoningEffort` 的调用方保留该覆盖。进程外提供方仍自行持有其独立运行时配置。压缩摘要器的同路由规则由[压缩继承](2026-08-19-compaction-inherits-same-route-reasoning-effort.zh.md)负责。
