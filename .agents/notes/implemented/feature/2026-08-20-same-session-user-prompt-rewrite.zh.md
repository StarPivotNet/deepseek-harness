# Agent Note: 同一会话内改写 user prompt

Status: implemented

[English](2026-08-20-same-session-user-prompt-rewrite.md) | 中文

## 问题

已定稿的 user prompt（包括更早一轮）无法在同一会话内修正。气泡上仍有复制和时钟；分支只存在于已完成 assistant 尾部，并且总会创建子会话。更早的编辑存根因没有 host 变更而被移除（[移除 user 消息的编辑存根](../simplification/2026-07-31-drop-user-message-edit-stub.md)）。队列编辑仍只覆盖待处理 inbox 行。

读者需要改已发送的 prompt，并在本对话中继续，而不能把这个手势与 fork 混在一起。

## 决策

`session.rewrite` 在同一会话内编辑当前 surface 上的 `user/message`。Host 等到 Agent 空闲，若正在运行则先取消，再追加一条 `surfaceOp: { op: 'replace', start, end }` 的替换 `user/message`，覆盖被编辑 prompt 到当前 surface 尾部。随后 `Agent.continueFromSurface()` 在不领取 inbox 输入的情况下开启新一轮，因此已经在 surface 上的替换消息是该轮唯一的 user 消息。该操作不会创建子会话。

`atSeq` 指定当前 surface 上的 user prompt，包括先前的改写结果。未知 seq、非 user prompt、当前 surface 上不存在该 prompt，或取消后 Agent 仍在运行，均返回 `rewrite-unavailable`。会话支撑的 subagent 拒绝并返回 `agent-busy`。纯文本载荷会保留原 prompt 中已准入的非文本块，与队列文本编辑一致。

Chat 把 user-source 的替换副本匹配为 user 节点，并隐藏 `anchorSeq` 落在改写 `replacedRange` 内的全部节点。compact 插件的替换仍是 compaction checkpoint，不是用户编辑。`ui-chat` 从 `session.rewrite` 注入 `rewriteAt`。user 气泡显示时钟、复制和编辑控件，点击后打开就地编辑器；保存调用 `rewriteAt(seq, text)`。steering 与待处理气泡仍只有复制。分支仍只存在于已完成 assistant 尾部。`verify-fork-customizations` 断言这条 Chat 接线，避免上游合入再次丢掉该控件。

## 曾考虑的替代方案

**从 user 气泡复用 `session.fork`。** 否决：fork 会从已完成 assistant 尾部创建子会话。编辑已发送 prompt 必须留在本会话，且不能继承后面的回答。

**复用队列编辑器。** 否决：队列编辑改的是驱动器尚未领取的待处理 inbox 项。已定稿 prompt 已经在 surface 和模型历史中。

**在替换之后用 `followup` 唤醒驱动器。** 否决：`followup` 会领取 inbox 项，从而再追加一条 user 消息。`continueFromSurface` 从已经在 surface 上的替换消息开启该轮。

**让 compact 风格的替换继续只对模型可见。** 对 user-source 改写否决：可见 transcript 必须显示编辑后的 prompt，并去掉被覆盖的后续轮次。compact 插件替换仍是只对模型可见的 checkpoint。

## 后果

编辑更早一轮会从模型历史和可见 transcript 中丢弃该 prompt 及其后全部 surface 节点，然后在同一会话开启新一轮。fork 仍是已定稿 assistant 回答下的独立子会话裁剪。失败会进入 `promptError`，`op=rewrite`。

## 测试

Host proxy 测试固定当前 surface 改写、缺失 seq 返回 `rewrite-unavailable`，以及 rewrite RPC 路由。Agent-loop 测试固定 `continueFromSurface` 消费替换消息且不再领取第二条 inbox，以及运行中抛错。Runtime 测试固定同一会话改写、`SessionRewriteError`，以及 subagent 拒绝。Conversation node 测试固定可见的改写节点和被隐藏的覆盖轮次。MessageItem 与 ChatView 测试固定只有 user 气泡有编辑控件、通过 `rewriteAt` 就地保存，以及这些气泡上没有分支。

## 相关

未绑定的编辑存根已在[移除 user 消息的编辑存根](../simplification/2026-07-31-drop-user-message-edit-stub.md)中移除。user 气泡仍不承载分支，见[User 与 steering 气泡去掉分支操作](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)。队列文本编辑仍是待处理 inbox 操作，见[编辑混合内容排队消息的文本](2026-08-19-queued-mixed-content-text-edit.zh.md)。
