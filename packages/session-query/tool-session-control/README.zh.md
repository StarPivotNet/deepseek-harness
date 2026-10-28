# @deepseek-ai/dsh-tool-session-control

[English](README.md) | 中文

[`ctx.sessionControl`](../session-control/README.zh.md)、[`ctx.sessionTitle`](../../session/session-title/README.zh.md) 与 [`ctx.workspaceRegistry`](../../workspace/workspace/README.zh.md) 的面向模型消费方：搜索、停止、发送、改名、列出工作区、归档、取消归档、改挂与同组调序。

已发布的 base 组合挂载该包。加载内置 [`dsh-session-control` skill](../../skill/skill-session-control/README.zh.md) 可获得告诉模型何时使用这些工具的目录指令。

## 工具

- `session_control_search(query?, limit?, archive?)` 按最新优先列出带实时状态的目录行。`archive` 为 `all`（默认，包含已归档）、`only` 或 `exclude`。已归档行带标记。
- `session_control_stop(session_id)` 停止当前轮次并保留已排队的收件箱工作。
- `session_control_send(session_id, message, mode?)` 向在线 Agent 投递一块文本。
- `session_control_rename(session_id, title)` 给任意逻辑会话钉住用户来源标题。空标题会失败。subagent 所有的会话会失败。
- `session_control_workspaces()` 列出已注册工作区，并省略已归档成员。
- `session_control_archive(session_id)` 归档一个已知会话。已归档则成功且不写入。
- `session_control_unarchive(session_id)` 恢复一个已知会话。已知且未归档则成功且不写入。
- `session_control_rehome(session_id, path)` 把一个会话的家和侧栏分组迁到已存在目录。规范 No Repo 目录会被拒绝。未注册的已存在目录会先注册。
- `session_control_reorder(session_id, before_session_id?)` 在当前工作区内移动一个已记账会话。未分组会话会失败。

`session_control_rehome` 在存在 `ctx.apiProxy` 时优先走 Host `session.rehome`，以便恢复冷会话。没有 Host 时，只有非 subagent 的在线会话能回退到 `workspaceRegistry.create` 加 `setSessionHome`。header origin 为 `subagent` 的会话在该回退路径上会失败。

`session_control_rename` 在存在 `ctx.apiProxy` 时优先走 Host `session.rename`。没有 Host 时，只有非 subagent 的在线会话能回退到 `ctx.sessionTitle.rename`。

## Model Experience

### Tool schemas

#### What the model sees

The generated [`session_control_*` schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-control).

#### Token effect

Three directory schemas always; `session_control_rename` while `ctx.sessionTitle` is mounted; five library schemas while `ctx.workspaceRegistry` is mounted.

#### KV Cache effect

Prefix-stable while the tool definitions stay unchanged.

## Known Limitations and Deferred Work

- `session_control_send` 不恢复冷会话。对仅存于存储的身份发送会失败，而不是拿走 `AgentHandle`。
- 搜索不检查消息正文。已归档行默认仍出现在目录中；分组工具仍会省略它们。
- 没有 Host `session.rehome` 时，`session_control_rehome` 不能恢复冷会话，且 header origin 为 `subagent` 的在线会话会失败。
- 没有 Host `session.rename` 时，`session_control_rename` 不能恢复冷会话。
- 这些工具不隐藏或显示工作区，也不会打开已取消归档的会话。
- 库管理工具等待 `ctx.workspaceRegistry`。CLI 和 TUI 组合不挂载它，因此暴露搜索、停止、发送和改名。
