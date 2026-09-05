# Agent Note: Busy-state delivery settings for settlement, report, and jobs

Status: implemented

[English](2026-08-19-subagent-delivery-settings.md) | 中文

## Problem

作曲器繁忙 Enter 已经通过 Host settings 持久化。可继续结算、子级 `report` 和 Job 完成仍在代码里选择父级 inbox 投递位置。想让这些通知等本轮结束、或想让 report 进入最近一步的操作者没有用户设置。三条通道也不一致：结算会插话繁忙父级，report 永远排到下一轮，Job 则注入下一步且不唤醒。

[由管理器投递的结算](2026-08-06-manager-owned-subagent-settlement-delivery.zh.md) 否决过会让通知缺席的*部署*开关。该否决仍然成立。缺的是：通知仍会发送，但投递位置可配。

## Decision

Host 命名空间 `subagent-delivery` 携带三个独立繁忙态字段：`settlementBusy`、`reportBusy`、`jobBusy`。取值 `steer` 或 `queue`，schema 默认 `steer`。子代理设置插件注册该分节。设置 → 子代理在定义库上方展示「行为」组。运行时在发送时调用 `ctx.get('settings')?.get(...)`；缺少 settings 服务或未注册分节时视为 `steer`。

投递顺序：

1. 已在拆卸中的父级走注入，永不唤醒。
2. 空闲父级始终 `followup()`。
3. 繁忙父级按对应字段：`steer` → 最近一步，`queue` → 下一轮。

Job 部署配置 `completionDelivery: quiet` 或耗尽的唤醒预算会让空闲时的完成通知保持待接收状态，不唤醒所有者。繁忙 Job 仍按 `jobBusy` 投递；两种配置都不丢弃消息，也不把繁忙 Steer 改写成 Queue。

插话会在当前模型请求和工具批次结束后的下一步接收通知，不会中断正在运行的工具。运行时逐条解析投递位置，因此在子代理或 Job 执行期间更改设置，会作用于随后发出的汇报或完成通知。

已接受的产品规格见 [docs/specs/subagent-delivery-settings.md](../../../../docs/specs/subagent-delivery-settings.zh.md)。

## Alternatives considered

**省略通知或让结算变成可选。** 再次否决。面向父级的承诺仍是无条件送达；改变的只是 inbox 目标。

**一条共用繁忙开关。** 否决。结算、report 和 Job 的噪音与紧迫程度不同。

**在 UI 暴露空闲 Quiet。** 否决。停驻的父级除非另有唤醒，否则永远看不到结果。

**保持 report 繁忙默认排队。** 否决。已接受合同把三条繁忙默认对齐为 Steer。

**把 schema 注册在 `dsh-subagent`。** 否决。设置插件已经拥有子代理页；Job 完成不是 subagent 服务的职责。读取方在分节未注册时回退为 Steer。

## Consequences

繁忙 report 的 Steer 可以加入当前轮，Queue 则留待下一轮。两种选择都不会取消父级正在运行的模型请求或工具。

繁忙 Job 投递不消耗空闲唤醒预算。测试覆盖执行期间更改设置，并保留空闲时的静默投递和唤醒预算耗尽行为。

作曲器 `ui-conversation.busyEnter` 不变。
