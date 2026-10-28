# Agent Note: Infer Host Automation create intent

Status: implemented

[English](2026-08-23-automation-infer-create-intent.md) | 中文

## 问题

用户会用日常说法让 live root Agent 创建 Host Automation 规则：创建自动化、每天跑一次、或稍后执行。五个 tool 已经存在，但模型常常在当前会话里立刻开工，而不是调用 `automation_create`。tool 描述提到了稍后或重复日程；组装后的系统提示没有 [goal tools](../../../../packages/goal/tool-goal/README.zh.md) 那种 Host Automation 策略，因此「创建一个自动化」会和普通编码工作抢路由。

[Host 拥有的 Automation 开火](../feature/2026-08-15-host-owned-automation-runs.zh.md) 的决策仍然成立：harness 不解析自然语言日历。缺的是点名产品意图的模型指引。

## 决策

`dsh-tool-automation` 注册固定的 `tool:automation` 系统提示章节，并在 `automation_create` 上写同一条推断意图规则。模型可从任意语言的直接人类请求推断 Host Automation 创建，不必出现 Host Automation 字样。它必须把 `task` 写成未来会话提示词，恰好选择一个选择器，且不得在当前会话开工，也不得改走提醒、goal、jobs 或 workflow。每天或每周的本地时间使用 `local_clock`，时区取自 time context 的请求时区。执行权威不变：live root Agent、打开的 turn、`{ kind: 'user' }`。

## 考虑过的替代方案

**在 harness 里解析请求并自动填规则。** 被 Host Automation 记录拒绝：time-context 已经提供时区，再做一个解析器会发明一种日历语言。

**只靠现有 tool 描述。** 被报告的会话已经有那份描述，仍把「创建一个自动化」当成立刻开工。goal、workflow 和 Ralph tool 已经为同类路由错误提供提示词章节。

**藏起 tool，直到出现精确斜杠命令。** 这会挡住日常说法创建，而侧栏已经把会话内创建写成产品路径。

## 后果

加载本插件的 root Agent 会收到稳定的提示词前缀，说明何时创建规则。语义意图仍由模型判断；执行仍然不能证明人类要的是定时器而不是立刻开工。开火 Session 仍然不能再创建规则。

## 测试

包测试钉住指引文本、create tool 描述、Loader 安全导出，以及提示词章节的 dispose。
