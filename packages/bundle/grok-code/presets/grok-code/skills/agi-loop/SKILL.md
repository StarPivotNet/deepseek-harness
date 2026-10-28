---
name: agi-loop
description: Use on non-trivial multi-step work that needs a think-act-queue loop — todo_write as the this-turn plan, finish when that queue is empty. Durable DAG is super_goals_*. Do not use for a one-line answer or a single-file typo.
---

# Think-act-queue (DSH Grok)

Be fast, accurate, strong, and smart: use live catalog tools, dispatch Agents on 2+ independent domains, never invent tools/facts/file content, never claim without this-turn evidence. Hidden thoughts stay decisions/kills/constraints; the this-turn short queue is `todo_write` (official projection clears each turn); the durable DAG is `super_goals_*` (load `super-goals` when work outlives the turn); other durable state is the cognition ledger.

This is how the preset aims at general intelligence: learn few-shot, model causes, act through tools, plan, and correct from evidence. It does not make the model a finished AGI.

<SUBAGENT-STOP>
If you were dispatched as a `subagent` / `subagent_fork` / AgentTeams member to execute a specific task, still run think-act on that assignment. Do not rebuild the parent's whole queue. Honor a Queue section in the cognition ledger if present.
</SUBAGENT-STOP>

## Iron laws

1. **Think then act.** Reason on the current queue item and live evidence, then emit the next tool calls in the same turn. Do not narrate a plan in user-facing text and then stop.
2. **This-turn short queue vs durable board.** `todo_write` is THIS TURN's 1–N short steps only (official projection clears each turn). Statuses: `pending` (not_started), `in_progress`, `completed`. Blocked this-turn work stays `pending` with the blocker in the text, and in the ledger Queue. The DAG that must outlive this turn is `super_goals_*` (load `super-goals`); `PLAN_NOT_FOUND` from `super_goals_map` means `super_goals_edit` with `init_board` + `add_node` in the same `ops`, not a path argument. Module `completion` defaults to required; `optional` stays open until `super_goals_update`. Do not park that DAG on `todo_write`.
3. **No numeric cap.** Put as many tasks as the work needs. No first-cut limit and no later-follow-up limit. Add a follow-up when it is required and is not already pending or completed.
4. **Parallel when independent.** Independent slices may run `in_progress` together (still one owner per file). Serial work still has a current task; do not fake completion to keep the list short.
5. **Evidence closes a task.** After a tool result, mark completed / blocked / replaced from that result. Never mark completed from a guess. Evidence already in this turn, the ledger, or the parent prompt is a BINDING — cut; do not `file_read` / `glob` / `skill` 确认 it.
6. **Finish when empty.** When the queue is empty and the request is met, stop. Deliver the result then, not a tool-by-tool recap. A turn ends on its own once the message has user-facing text and no further tool calls remain. Do not yield with an offer to continue later while you can still act.
7. **Stuck → change strategy.** If the same tool name and arguments fail twice, or two consecutive actions produce the same failed result, 回溯 to the nearest CHOICE — change tool, arguments, or decompose. Never a third time with the same name and arguments. Never silently retry the same failing call. Never restart as if the attempt never happened.
8. **Ask only when blocked on the user.** Use `ask_user_question`. Irreversible ambiguity, a choice they own, or a hard permission. Not for reversible local work they already requested.

## Loop

```
Goal (user request)
  → super_goals_map (durable DAG; PLAN_NOT_FOUND → super_goals_edit init_board + add_node in the same ops; load super-goals for required vs optional roots)
  → super_goals_next → initialize todo_write with this turn's 1–N short steps for that leaf
  → while queue not empty and request not met:
       think: current task + evidence + constraints + kills
       act: live catalog tools (file_read/edit/codegraph_*/pwsh/bash/web_search/read_page/x_search/read_image/skill/subagent/…)
       observe: keep / kill / narrow from the tool result
       complete / block / replace the current task
       maybe follow-up tasks if required and not already covered
  → stop
```

When the queue is empty (or the user must choose), the visible reply says what was done, what the outcome is, and what remains. Reasoning, plan, and self-criticism stay in hidden thoughts (`text` / `reasoning` / `plan` / `criticism` map onto the six headings when those headings are in use).

## Files

- `file_write` creates or replaces a whole file. Append and targeted deletion are `file_edit` exact replacements. Relocate a file or directory with `file_move` (`from`, `to`). The source stays until the destination matches. Delete a file with `pwsh`/`bash`. 
- Specs and tests are `file_write` / `file_edit` plus `design-before-build`. Quality is `requesting-code-review`.
- Change existing code with `file_edit`. Do not dump a rewrite as a new file.
- Live catalog only.

## Few-shot learning (any new domain)

1. Read first, matched to the question: `grep` / `glob` / `file_read` for a config key, an error string, or comment text. For a symbol, a flow, or code you can name, call `codegraph_status` then `codegraph_explore` (`codegraph_init` once if the project is not initialized; `codegraph_sync` after a source edit). Do not call `codegraph_reindex`, `codegraph_overview`, or `codegraph_search` unless that name is in this session's tool list. Do not write `codegraph.json`. If codegraph says the project is not indexed and you did not init, stop and use `grep` / `file_read`. Also `web_search` / `read_page` (`<fetch_url>`) / `x_search` / `read_image` / `skill` when the question is outside the tree.
2. Cheapest reversible probe next.
3. Name the closest known pattern; state what carries over and what does not; test the uncertain part first.
4. Fold a durable fact into the cognition ledger. Do not claim mastery from text matching.

## World model

Track causes, not correlations: physical constraints, social rules, the other person's likely intent. If the request stays ambiguous and the action is irreversible, ask. Never invent motives, facts, or file content.

## Durable Queue

When this-turn short steps must be recalled after compaction, fold them into this session's `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` Queue. The long-running DAG is `super_goals_*` (load `super-goals`); do not paste that board here. Mark a finished Queue/Goal item `- [x] ...`. On the next ledger write（下次写）, delete those `[x]` rows and set `completed:` to `(none)` unless the user explicitly asks to redo (`重新做`) or continue (`继续改`) that work. `ledger-inject` omits checked-off rows so they are not reopened as to-dos. Control tape stays in cognition; facts that must survive Goal/Queue rotation go in notes.md (session-notes).

```markdown
## Queue
- pending: [ordered tasks not started]
- current: [in_progress item(s), or (none)]
- completed: (none)
- blocked: [waiting on what]
```

Load `session-cognition` for the rest of that file. 写前先读再写. Replace the Queue section; do not append a diary. 不要追加第二套 `## Queue` 或第二份 pending / current / completed / blocked.

## Don't

- Park the durable DAG on `todo_write` (that is `super_goals_*`).
- Retry the same tool name and arguments a third time after two failures.
- Stop when the this-turn queue is empty.
- Narrate a plan in user-facing text and then stop without the next tool call.

## Red flags

| Thought | Reality |
|---|---|
| "I know the plan, skip the queue" | If it is multi-step, `todo_write` first |
| "Add every sub-step now" | Put as many tasks as the work needs; no numeric cap |
| "Retry the same call, it might work" | Stuck. Change strategy |
| "Call a tool that is not in this session" | Live catalog only: `file_edit` or `file_write` / `subagent` / `job_output` / `job_kill` / `pwsh`/`bash` / `ask_user_question` / `web_search` / `read_page` / `x_search` / `present`. A successful `file_edit` can be followed immediately without another read |
| "Invent a planning tool" | `todo_write` is the this-turn plan; the durable DAG is `super_goals_*` |
| "I am AGI now" | You are running a loop. Still verify with tools |
