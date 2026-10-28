# Agent Note: Web GUI 中的运行时模型身份

Status: implemented

[English](2026-08-27-web-running-model-identity.md) | 中文

## 问题

Web 对话页无法回答「这一轮是谁在跑」。输入栏的模型席位（[会话模型选择器](../../archived/feature/2026-07-24-web-session-model-selector.md)）命名的是下一个组装步的路由，且静止时容易错过；会话顶栏只显示 agent 预设。对比模型的用户、或在换模型后回读会话的用户，在页面上看不到哪条回复出自哪个模型的证据——这个事实只存在于 `request/header` 事件和轨迹视图里。

## 决策

模型身份从会话日志呈现，绝不取自选择器状态，呈现在两个只读表面上。

新投影单元 `requestRoute`（`@deepseek-ai/dsh-session-route`，与 `session-stats` 并列挂载）把全日志的 `request/header` 事件按最新优先折叠为 `{provider, model, reasoningEffort?}`（首个请求前为 `null`，沿用 title/goal 的无值约定）。作为全日志 host 投影，该值在分页与压缩下不变。`ui-model-selection` 在 `conversation.session.header.actions` 注册顶栏芯片（id `model-identity`，order −5），读取投影，通过与输入栏席位相同的逐会话 `modelDirectories` 目录解析目录显示名与推理等级，渲染 `名称 · 等级`，目录缺失时回退裸 id。首个请求发出前不渲染任何内容，因此绝不会把未发送的选择器选择当成事实。

逐会话身份随聊天折叠携带。`finalNode` 现在把 `assistant/message.source` 映射为 `provenance`（轨迹折叠的既有映射），隐藏的 `chat-request-header` 载体定义让 `ChatSnapshotBuilder` 用轨迹 join 语义为每条 `AssistantChatData` 盖上该步自己的 header 的 `requestConfig`：步键精确匹配、同步后写者胜，否则继承早于该步的最新 header。新单槽 `conversation.chat.assistantRoute`（owner：`requestConfig?`、`provenance?`）渲染在助手叙述的时钟下方；`ui-model-selection` 占用它，身份优先取 `provenance`（实际服务的提供商），等级段取 `requestConfig.reasoningEffort`。

时钟行的身份优先取 `provenance`，因为 `assistant/message.source` 记录的是该步实际由谁服务（即使发生提供商层重试），而请求头记录的是组装了什么。顶栏芯片读投影而非折叠，因为它必须能回答最后一轮已在分页窗口之外的会话。

## 备选方案

**复用输入栏席位作为身份表面。** 席位命名的是下一步路由，是另一个事实；切换了选择器但未发送的用户会看到一个谎报运行情况的标签。

**从轨迹视图派生顶栏标签。** 轨迹折叠归 `ui-trajectory` 所有，会把芯片耦合到一个可缺省的包上；投影才是为穿越窗口分页而设计的接缝。

**把逐消息模型标签持久化为会话事件。** 身份已可从已记录事件（`request/header`、`assistant/message.source`）重建；新事件会在不增加信息的情况下违反 model-visible-⟺-logged 的经济性。

**也给用户气泡和工具卡加标注。** 只有助手行承载模型决策；纯工具步骤和用户消息没有自己的路由。

## 结果

每个对话页现在一眼可见已发出的路由：顶栏芯片回答「最后跑的是谁」，每条助手行的时钟行回答「这条是谁写的」。中途换模型在两个表面都正确呈现，且不改变输入栏席位的职责。芯片为每个会话作用域增加一次目录加载（与输入栏席位共享实例）。无提供商目录的部署上的会话显示裸 id。顶栏芯片命名的是最后一次「已发出」的请求，因此回合一结束后，它会刻意滞后于未发送的选择器变更，直到下一步组装。

## 测试

`session-route` 包测试锁定折叠：空日志 → `null`、单 header、最新优先含等级变化、resume 静默、change-feed 触发序、懒挂载、HMR 卸载、loader 组合。`ui-conversation` 测试锁定 provenance 映射、步 join（切换中 精确→继承→精确）、活动晚到 header 重盖、前插不降级、时钟行槽位共享。`ui-model-selection` 测试锁定显示名解析（目录命中/未命中、适配器等级词汇、裸 id 回退）、null 路由静默、provenance 优先于 requestConfig、四个入口共享目录实例。Keyless web e2e `model-identity.e2e.ts` 在两条已声明的路由上种入两个完整回合，经真实 host 与浏览器锁定顶栏芯片、两条时钟行、空白会话静默、以及会话 aria 金样。
