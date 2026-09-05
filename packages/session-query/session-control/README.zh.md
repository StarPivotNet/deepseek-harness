# `@deepseek-ai/dsh-session-control`

[English](README.md) | 中文

`ctx.sessionControl` 是覆盖全部逻辑会话的可信进程内目录。它按实时驱动状态搜索身份、停止已附着轮次，并向在线 Agent 投递后续用户角色消息。它消费 `ctx.sessionQuery`、`ctx.agents` 和 `ctx.sessions`。宿主与插件可选择挂载该服务；它不注册面向模型的工具。

## 公共 API

- `search(request?, signal?)` 从 `ctx.sessionQuery.listSessions()` 列出在线优先语料，为每行附加最新标题、在线 Agent 状态，以及挂载 `ctx.workspaceRegistry` 时的注册表级 `archived` 位。它以不区分大小写的子串过滤会话 id、cwd 和标题。`archive` 默认为 `all`，也可为 `only` 或 `exclude`；该过滤在 `limit` 之前生效。没有注册表时每行都是 `archived: false`，且 `only` 为空。空查询按最新优先返回最多 `limit` 条。标题按语料的最新优先顺序分批读取，每批大小为尚缺的结果数，收集满 `limit` 条匹配结果后即停止。不搜索消息正文。
- `get(sessionId, signal?)` 返回一行目录，包含 `archived`。缺失身份以 `SESSION_CONTROL_SESSION_NOT_FOUND` 失败。
- `stop(sessionId, signal?)` 以 `keepInbox: true` 取消在线 Agent 的当前轮次。已知身份若没有在线 Agent，则是被接受的空操作。该调用从不恢复冷会话。
- `send(request, signal?)` 通过 `followup()`（`queue`）或 `steer()` 投递一块非空文本。必须有在线 Agent。已知但仅存于存储的身份以 `SESSION_CONTROL_RESUME_REQUIRED` 失败，而不会调用 `ctx.agents.resume()` 拿走调用方或 subagent continuation manager 必须持有的 `AgentHandle`。未知身份以 `SESSION_CONTROL_SESSION_NOT_FOUND` 失败。

## 活动状态

| 值 | 含义 |
|---|---|
| `running` | 在线 Agent 有活动驱动。 |
| `idle` | 在线 Agent 已附着且处于轮次之间。 |
| `ready` | 身份存在于逻辑语料中，且没有在线 Agent。 |

`archived` 与活动状态无关：它是分组隐藏，不是语料删除。仅当该 id 位于 `ctx.workspaceRegistry.archivedSessionIds` 时为 `true`。

## 配置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `searchLimit` | `50` | 请求省略 `limit` 时 `search()` 的默认结果上限；必须是正安全整数。 |

## Model Experience

None, as this trusted directory returns cloned session records only to its callers and registers no model-facing prompt, schema, tool, or message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **无调用方授权** — 这是可信的上下文范围基础设施；模型工具或 UI 必须约束调用方可检查或变更的会话。
- **无冷恢复** — `send()` 拒绝仅存于存储的身份，而不是调用 `ctx.agents.resume()`，因为 resume 返回的 `AgentHandle` 必须由 continuation manager 或 Host resolver 持有。
- **无正文发现** — 搜索检查 id、cwd 和折叠后的标题。全文正文搜索仍属于 `ctx.sessionQuery` 及其可选模型消费方。
- **冷标题扫描** — 匹配很少或没有匹配的查询仍可能检查全部符合归档条件的会话。没有缓存的标题可能需要读取并解压完整日志；`limit` 限制结果数，不限制耗时或扫描总字节数。调用方可传入 `AbortSignal` 取消搜索。
