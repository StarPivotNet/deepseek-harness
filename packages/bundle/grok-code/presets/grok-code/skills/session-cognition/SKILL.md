---
name: session-cognition
description: Use when a task must survive compaction, span files, launch subagents or AgentTeams, or carry kills/constraints across turns — session cognition, cognition ledger, working memory, $DSH_HOME/cognitions/<project>/<sessionId>/cognition.md. Do not use for a single-file read or a question that needs no extra probe.
---

# Session cognition ledger

Durable file: `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` (create the directories if needed). `$DSH_HOME` is `$env:DSH_HOME` on Windows or `$DSH_HOME` elsewhere. `<project>` is the last path component of the session workspace (`{{cwd}}`), with characters illegal in a directory name replaced by `_`. `<sessionId>` is the current session id (non-alphanumeric characters replaced by `_`). Example: workspace `D:\desktop\desktop\Jnic` in session `abc123` → `$DSH_HOME/cognitions/Jnic/abc123/cognition.md`. One ledger per session: same-workspace sessions never share it.

This is durable working memory for the current project, not a product doc, not a chat log, and not a repo file. Keep it out of the workspace so it is not committed with the project. Map thought headings into it: Goal (one intent line plus `board at <cwd>/.super-goals/<session>/board.json` when a durable DAG exists — do not paste the whole DAG here); Constraints; Kills; Live; Next. This-turn plan steps go to Queue (`todo_write` is the live this-turn list; this section is the durable copy of that short queue, not the `super_goals_*` board). Leave Choice in thoughts as keep/kill only; code lands in `file_edit`/`file_write`, never in the ledger.

A later turn (or a child) must be able to resume from this file alone. Each bullet is a fact: named file / API / function, measured number, rejected hypothesis with why, or the next concrete check. Slogan rows (`gate unchanged`, `do not edit shipped presets` with no reason) fail — rewrite them with the evidence. Do not dump the six-heading thought chain.

Never write workspace `.dsh/cognition.md`. If that leftover exists, ignore it unless the user asks to migrate; then copy live rows into the home path and stop touching the workspace copy. The ledger does not store notes; if a receipt must survive `[x]` rotation, write notes.md (session-notes). Never write workspace `.dsh/notes.md`.

## When to load this skill

- First non-trivial turn in a workspace (two or more files, a diagnosis, a launch, or work that will outlive this turn)
- After a `<compacted-summary>` checkpoint, before the next edit or launch
- Before `subagent` / `subagent_fork` / `agent_teams_create`
- When a keep / kill / constraint / next check must survive this turn

Skip for one file with no sibling work, or a question that needs no extra probe.

## Don't

- Write workspace `.dsh/cognition.md` or reuse another session's ledger.
- Append a second `## Goal` / `## Queue` or a second pending / current / completed / blocked.
- Park the durable DAG here — that is `super_goals_*`.
- Escalate `sandbox_permissions` to dodge a denied home-ledger edit.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "I'll remember this across compaction" → write the ledger now.
- "Append a diary so nothing is lost" → replace live rows; receipts are `[x]` then drop.
- "Child can have its own Goal/Queue" → children read this session's file; they do not rewrite it.

## Path

Resolve once per turn from cwd plus the current session id; do not invent a second project slug and never reuse another session's ledger.

1. Project dir = last component of the workspace cwd.
2. Session dir = current session id with non-alphanumeric characters replaced by `_`.
3. Ledger = `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md`.
4. Pass that absolute path to `file_read` / `file_edit`. A missing ledger file is created with `file_write` from the template. An existing file is `file_edit` only.
## Sandbox

The home ledger sits outside the session workspace. Reads are always allowed. Use the session's default sandbox mode for `file_edit` — do not pass `sandbox_permissions` and do not escalate. If an edit is denied, stop and report it; do not retry with a wider mode and do not write the ledger into the workspace to dodge the fence. Create the file with `file_write`, then continue with `file_read` / `file_edit`.

## Read

`file_read` the absolute home ledger once per turn when the skill applies, if the file exists. After compaction, read it before acting even if Problem Solving is in the checkpoint. On conflict: tool evidence wins, then this ledger, then the checkpoint recap. Do not reread it in the same turn to reconfirm.

If the file is missing and the skill applies, create it from the template below — this file is the exception to "do not create `*.md` unless asked".

## Write

Use `file_edit` for the headings that changed. Do not append a diary. Do not paste conversation, planned C/Java, or file dumps. Create from the template only when the file is missing; after that, 写前先读现有账本再写, then replace live rows in place (Goal / Constraints / Kills / Live / Next / Paths / Queue), not the whole file every time. 不要追加第二套 `## Goal` / `## Queue` 或第二份 pending / current / completed / blocked — each heading and each Queue key appears once.

Write when any of these change: Goal, a constraint, a kill, the live hypothesis, the next check/edit/launch, a path that children must know, or the Queue (pending / current / completed / blocked). Write before launching children so they can read the same facts. After a child returns, fold keep/kill into the ledger in the same turn you act on it.

When a Goal or Queue item is done, mark it `- [x] ...` so a later turn can see the check. On the next ledger write（下次写）, delete those `[x]` rows and set Queue `completed:` to `(none)` unless the user explicitly asks to redo（重新做） or continue（继续改） that work. Checked-off rows are receipts, not open tasks; `ledger-inject` omits them so finished work is not reopened as a to-do.

No numeric cap. Prefer fewer thick rows over many slogans. Drop stale rows when they no longer help a later turn resume. Kills stay until the hypothesis is gone. If the file is getting long, merge overlapping rows — do not invent a bullet quota.

## Template

```markdown
# Cognition

## Goal
- [one intent line — what the user still wants]
- board at <cwd>/.super-goals/<session>/board.json

## Constraints
- [must hold — and why, if a later turn would otherwise violate it]

## Kills
- [dead hypothesis — evidence that killed it]

## Live
- [current hypothesis; what already landed; what is untested]

## Next
- [one check, edit, or launch]

## Paths
- [path — why a later turn must open it]

## Queue
- pending: [ordered tasks not started]
- current: [in_progress item(s), or (none)]
- completed: (none)
- blocked: [waiting on what]
```

## Plan mode

Read is always allowed. Updating `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` is allowed in plan mode: it is planning state, not implementing the user's feature. Do not use that exception to edit other files. Use the session's default sandbox mode; do not pass `sandbox_permissions`.

## Children

Subagents and AgentTeams members: `file_read` this session's ledger first when it exists (absolute `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` for the parent session id). Do not rewrite it unless the task says to fold a finding. Never replace Goal/Constraints/Queue with a local recap. Return keep/kill in the result; the parent folds.
