# Agent Note: 去掉 Host 范围的 Automation 并发开火上限

Status: implemented

[English](2026-08-21-drop-automation-max-concurrent-runs.md) | 中文

## 问题

多条每日规则可以共用一个 `local-clock` 时刻。Host 只准入两个存活的 Automation Session，后面的到期规则写入 `skipped_busy` 且 `errorCode: max_concurrent_runs`，再推进到下一天。历史只显示「已跳过」/ 0s。逐条规则的 `onOverlap` 已经决定该规则上一次 Session 仍在跑时怎么办；第二条 Host 范围上限会静默丢掉独立工作。

## 决策

`dsh-automation` 不再有 `maxConcurrentRuns`。到期或立即运行开火会打开 Session，除非同一规则上一次 `started` Session 仍有 live 且 `running` 的 Agent，并且 `onOverlap` 为 `skip`。同一到期批次里的独立规则全部启动。周期 skip 仍会推进，避免一条忙碌规则在同一时刻死循环。历史上的 `errorCode: max_concurrent_runs` 行仍可读，但服务不再写入该码，Web 面板也不再本地化它。

[Host 拥有的 Automation 开火](../feature/2026-08-15-host-owned-automation-runs.zh.md) 仍拥有选择器、origin 和逐条 overlap。

## 考虑过的替代方案

**提高默认值。** 更大的数字仍会丢掉第 N+1 条同时到期的规则，并留下一个没有产品主人的配置旋钮。

**把被跳过的规则排队，直到有空位。** 周期 skip 已经推进下一目标。再排队会发明第二种投递模式，并可能在一条长日任务结束后一起涌出。

**保留上限，只在历史里说明原因。** 历史行已经把两种 skip 都折叠成「已跳过」。产品要求是跑每一条独立到期规则，而不是把拒绝解释得更清楚。

## 验证

包测试在前两条 Session 保持 `running` 时对三条独立 `every` 规则开火，期望三次 `started`。现有 skip/replace overlap 测试仍覆盖同一规则上一次忙碌 Session。客户端 store 与面板测试不再映射 `max_concurrent_runs`。

## 后果

带有许多到期规则的 Host 可以一次打开同样多的 Session。机器负载、API 配额和工作区争用变成运维问题。逐条 `onOverlap: skip` 仍阻止一条长任务叠出自己的副本。
