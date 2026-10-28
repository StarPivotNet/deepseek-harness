---
name: session-notes
description: Use when the context window is small, before compaction, or when a preference, decision, measured fact, or discovery must survive Goal/Queue rotation — session notes, notes.md, $DSH_HOME/cognitions/<project>/<sessionId>/notes.md. Write that turn. Do not use for the cognition control tape (that is session-cognition) or a one-line lookup you will not need again.
---

# Session notes

Durable file: `$DSH_HOME/cognitions/<project>/<sessionId>/notes.md` (create the directories if needed). `$DSH_HOME` is `$env:DSH_HOME` on Windows or `$DSH_HOME` elsewhere. `<project>` is the last path component of the session workspace (`{{cwd}}`), with characters illegal in a directory name replaced by `_`. `<sessionId>` is the current session id (non-alphanumeric characters replaced by `_`; implementation keeps hyphens). Example: workspace `D:\desktop\desktop\Jnic` in session `abc123` → `$DSH_HOME/cognitions/Jnic/abc123/notes.md`. Same directory as `cognition.md`; one notes file per session: same-workspace sessions never share it.

This is durable session notes for the current project — user preferences, facts that must survive Goal/Queue rotation, decided choices that must not be re-asked, discoveries that must survive compaction. It is not a product doc, not a chat log, not a repo file, not a second `todo_write`, not `super_goals_*`, and not a copy of Goal / Constraints / Kills / Live / Next / Paths / Queue. Keep it out of the workspace so it is not committed with the project. The four columns are User, Facts, Decisions, Open. Leave the control tape in `session-cognition`.

A later turn (or a child) must be able to resume preferences and still-true facts from this file without re-asking. Each bullet is a fact: a stated preference or constraint, a named file / API / number, a rejected hypothesis with why, a choice plus why, or an unresolved question that is not cognition Next. Slogan rows fail — rewrite them with the evidence. Do not dump the six-heading thought chain.

Never write workspace `.dsh/notes.md`. If that leftover exists, ignore it unless the user asks to migrate; then copy still-true rows into the home path and stop touching the workspace copy.

## When to load this skill

- The context window is small, or compaction is likely, and a preference, decision, or measured fact is not already in the injected notes snapshot
- A user preference, standing constraint, or decided choice must survive later turns
- A discovery or measured fact must survive compaction or Goal/Queue `[x]` rotation
- After a `<compacted-summary>` checkpoint, before acting on a preference that is not in the injected notes
- Before `subagent` / `subagent_fork` / `agent_teams_create` when children need parent notes

Skip for a one-line lookup you will not need again, or a pure control-tape update (Goal / Constraints / Kills / Live / Next / Paths / Queue — that is `session-cognition`).

## Don't

- Write workspace `.dsh/notes.md` or reuse another session's notes.
- Use Goal or Queue as note section names. Columns are User, Facts, Decisions, Open only.
- Duplicate `todo_write`, `super_goals_*`, or the cognition control tape here.
- Escalate `sandbox_permissions` to dodge a denied home-notes edit.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "I'll remember this preference after compaction" → write notes.md now.
- "Ask before saving a preference" → write notes.md this turn.
- "Park the queue in notes so it survives" → that is cognition Queue, not notes.
- "Child can rewrite parent notes" → children read this session's file; they do not rewrite it unless the task says to fold.

## Path

Resolve once per turn from cwd plus the current session id; do not invent a second project slug and never reuse another session's notes.

1. Project dir = last component of the workspace cwd.
2. Session dir = current session id with non-alphanumeric characters replaced by `_` (hyphens kept in implementation).
3. Notes = `$DSH_HOME/cognitions/<project>/<sessionId>/notes.md` — same directory as `cognition.md`.
4. Pass that absolute path to `file_read` / `file_edit`. A missing notes file is created with `file_write` from the template. An existing file is `file_edit` only.

## Sandbox

The home notes file sits outside the session workspace. Reads are always allowed. Use the session's default sandbox mode for `file_edit` — do not pass `sandbox_permissions` and do not escalate. If an edit is denied, stop and report it; do not retry with a wider mode and do not write notes into the workspace to dodge the fence. Create the file with `file_write`, then continue with `file_read` / `file_edit`.

## Read

`file_read` the absolute home notes once per turn when the skill applies, if the file exists. After compaction, read it before acting on a preference or still-true fact. On conflict: tool evidence wins, then this file, then the checkpoint recap. Do not reread it in the same turn to reconfirm.

If the file is missing and the skill applies, create it from the template below — this file is the exception to "do not create `*.md` unless asked".

## Write

Use `file_edit` for the headings that changed. Do not append a diary. Do not paste conversation, planned C/Java, or file dumps. Create from the template only when the file is missing; after that, read before write, then replace live rows in place (User / Facts / Decisions / Open), not the whole file every time. Do not append a second `## User` / `## Facts` / `## Decisions` / `## Open` — each heading appears once.

Write when any of these change: a stated preference, a fact that must survive Goal/Queue rotation, a decided choice that must not be re-asked, a discovery that must survive compaction, or an Open question that is not cognition Next. Write before launching children so they can read the same notes. After a child returns, fold keep/kill facts into notes in the same turn you act on them when the task said to fold.

Drop stale rows when they no longer help a later turn. If the file is getting long, merge overlapping rows — do not invent a bullet quota. Do not dump Open as cognition Next or as Pending Jobs.

## Template

```markdown
# Notes

## User
- [stated preference or constraint]

## Facts
- [named file / API / number / rejected hypothesis with why]

## Decisions
- [choice + why; do not re-ask]

## Open
- [unresolved question that is not cognition Next]
```

## Plan mode

Read is always allowed. Updating `$DSH_HOME/cognitions/<project>/<sessionId>/notes.md` is allowed in plan mode: it is planning state, not implementing the user's feature. Do not use that exception to edit other files. Use the session's default sandbox mode; do not pass `sandbox_permissions`.

## Children

Subagents and AgentTeams members: `file_read` the PARENT session absolute notes.md first when it exists (`$DSH_HOME/cognitions/<project>/<sessionId>/notes.md` for the parent session id). Do not rewrite it unless the task says to fold. Never write workspace notes files. Return keep/kill facts in the result; the parent folds.
