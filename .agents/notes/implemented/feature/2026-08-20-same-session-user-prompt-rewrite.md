# Agent Note: Same-session user prompt rewrite

Status: implemented

English | [中文](2026-08-20-same-session-user-prompt-rewrite.zh.md)

## Problem

A settled user prompt, including an earlier round, could not be corrected in the same session. Copy and clock remained on the bubble; branch lived only under completed assistant tails and always created a child session. The earlier edit stub was removed because it had no host mutation ([drop the user-message edit stub](../simplification/2026-07-31-drop-user-message-edit-stub.md)). Queue edit still only covers pending inbox rows.

Readers needed to change an already-sent prompt and continue in this conversation, without mixing that gesture with fork.

## Decision

`session.rewrite` edits a current-surface `user/message` in this same session. The Host waits for an idle Agent, cancels a running turn first, then appends a replacement `user/message` with `surfaceOp: { op: 'replace', start, end }` covering the edited prompt through the current surface tail. `Agent.continueFromSurface()` then starts a new turn without claiming inbox input, so the replacement already on the surface is the only user message of that turn. The operation never creates a child session.

`atSeq` names the current-surface user prompt, including a previous rewrite. Unknown seq, a non-user prompt, a prompt off the current surface, or a still-running Agent after cancel returns `rewrite-unavailable`. Session-backed subagents reject with `agent-busy`. A text-only payload keeps already-admitted non-text blocks from the original prompt, matching queue text edit.

Chat matches user-source replacement copies as user nodes and hides every node whose `anchorSeq` falls inside a rewrite's `replacedRange`. Compact plugin replacements stay compaction checkpoints, not user edits. `ui-chat` injects `rewriteAt` from `session.rewrite`. User bubbles show clock, copy, and an edit control that opens an in-place editor; save calls `rewriteAt(seq, text)`. Steering and pending bubbles stay copy-only. Branch remains only under completed assistant tails. `verify-fork-customizations` asserts this Chat wiring so an upstream merge cannot drop the control again.

## Alternatives considered

**Reuse `session.fork` from the user bubble.** Rejected: fork creates a child session from a completed assistant tail. Editing a sent prompt must stay in this session and must not inherit the later answer.

**Reuse the queue editor.** Rejected: queue edit mutates a pending inbox occurrence that the driver has not claimed. A settled prompt is already on the surface and in model history.

**Wake the driver with `followup` after the replacement.** Rejected: `followup` claims an inbox item and would append a second user message. `continueFromSurface` opens the turn from the replacement already on the surface.

**Keep compact-style replacements model-only.** Rejected for user-source rewrites: the visible transcript must show the edited prompt and drop the shadowed later turns. Compact plugin replacements remain model-only checkpoints.

## Consequences

Editing an earlier round discards that prompt and every later surface node from model history and from the visible transcript, then starts a new turn in the same session. Fork stays a separate child-session cut under settled assistant answers. Failures land in `promptError` with `op=rewrite`.

## Testing

Host proxy tests pin a current-surface rewrite, a missing-seq `rewrite-unavailable`, and the rewrite RPC route. Agent-loop tests pin `continueFromSurface` consuming the replacement without a second inbox claim, and a throw while running. Runtime tests pin same-session rewrite, `SessionRewriteError`, and subagent refusal. Conversation node tests pin a visible rewrite node and hidden shadowed turns. MessageItem and ChatView tests pin the edit control on user bubbles only, in-place save through `rewriteAt`, and no branch on those bubbles.

## Related

The unbound edit stub was removed in [Drop the user-message edit stub](../simplification/2026-07-31-drop-user-message-edit-stub.md). Branch stays off user bubbles per [User and steering bubbles drop the branch action](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md). Queue text edit remains a pending-inbox operation per [Edit text of mixed-content queued messages](2026-08-19-queued-mixed-content-text-edit.md).
