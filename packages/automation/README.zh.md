# automation/：Host 拥有的定时新会话

[English](README.md) | 中文

Automation 家族拥有进程级规则：定时器到期时 **创建全新 Session**。持久状态在 storage domain，不在任何 Session 日志里。进程内 owner 只在 Web Host 存活时等待；冷 Host 不做外部通知。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`automation/`](automation/README.zh.md) | 规则表、计时 owner 与开火路径 | `ctx.automation` |
| [`tool-automation/`](tool-automation/README.zh.md) | 面向模型的创建／列出／更新／删除工具 | — |

Settings、Host RPC 和模型 tool 必须调用 `ctx.automation`，不得自己写 domain 表。

持久记录、互斥策略和开火约定见 [Host 拥有的 Automation](../../docs/subsystems/automation.zh.md)。
