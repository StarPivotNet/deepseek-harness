---
name: using-superpowers
description: Use when starting non-trivial work, choosing which catalog skill to load, or tempted to skip debug/review/explore-first — skill invocation before action. Do not use as a subagent (skip this skill), or for a one-line answer / file-location question.
---

# Using skills (DSH Grok)

Iron laws stay. Ceremony that fights this preset does not.

<SUBAGENT-STOP>
If you were dispatched as a `subagent` / `subagent_fork` / AgentTeams member to execute a specific task, ignore this skill. Still load any *other* catalog skill the assigned task clearly needs. Do not load `agent-teams` as a member — that protocol is captain-only.
</SUBAGENT-STOP>

## The rule

If there is even a small chance a session-catalog skill applies, call `skill` with that exact name **before** exploring the repo, asking a clarifying question, or writing code. If it turns out wrong, you do not have to follow it.

Knowing the idea is not using the skill. Skills evolve — load the current file.

Announce the skill only in thoughts, never as user-facing "Using [skill] to…".

**Before `enter_plan_mode`:** if you have not designed yet, load `design-before-build` first.

User instructions and an explicit "skip tests / no plan / just patch" win.

Do not load this skill in a loop before every other `skill` call — once per turn is enough; then load the matching implementation skill.

## Iron laws

1. **Process first.** If a skill in the route below applies, load it before proposing a fix, writing production code, or claiming done.
2. **Root cause before fixes.** Symptom patches are failure. `systematic-debugging`.
3. **Independent review after a non-trivial multi-file change.** Do not be the only reviewer of your own non-trivial diff. `requesting-code-review`. Quality is the reviewer.
4. **Evidence before claims.** If you did not run the proof in this turn, you cannot say it passes. Persona `<validating>` (already loaded; do not call `skill`).
5. **Design scales with blast radius.** Spike / bounded / architectural. `design-before-build`.
6. **YAGNI + DRY + smallest change.** No speculative helpers, no drive-by refactors, no extra files to look busy. Smallest change is fewest mechanisms, not the dumbest primitive: if a stronger algorithm hits the goal with less stacking, use it.

## Don't

- Skip a matching skill because you already know the idea.
- Load this skill as a `subagent` / AgentTeams member (skip it; still load the assigned task's other skills).
- Claim done without this-turn proof (persona `<validating>`).

## Route (thoughts only)

| Request | Load |
|---|---|
| Starting non-trivial work / tempted to skip | this skill, then the matching row below |
| Bug, test failure, unexpected behavior, hard bug, flake, or performance regression | `systematic-debugging` |
| About to say done / tests pass | persona `<validating>` (already loaded; do not call `skill`) |
| New feature, subsystem, "build X" | `design-before-build` |
| Outcome named but the pieces are not, and the work is non-trivial | persona `<goal_completion>` (already loaded; do not call `skill`) |
| Take over a large existing repo | `takeover-codebase` |
| Work must survive compaction | `session-cognition` |
| Session notes / user preferences | `session-notes` |
| Non-trivial multi-step work / think-act-queue | `agi-loop` |
| Work that will outlive this turn / multi-file long DAG | `super-goals` |
| This-turn short queue | `todo_write` |
| Major slice you would otherwise self-review, or a branch / PR / diff since a fixed point against repo standards and the originating spec | `requesting-code-review` |
| 2+ independent domains, no shared state | `dispatching-parallel-agents` |
| Durable team / implement + independent review / quality gates | `agent-teams` |
| Review feedback arrived, including a Standards / Spec report | `receiving-code-review` |
| Reverse-engineer a shipped file the user named, including a VMProtect PE they own (identify, Unicorn unpack, import rebuild, string keys, or captured decrypted text), a Quick App / Vela `.rpk` (analyze all logic, or unpack/patch/resign and bypass lock/activation), or another PE, ELF, Mach-O, APK, firmware, a capture, managed bytecode, or a protocol. A VMProtect PE is `library\re-vmp\SKILL.md`. A `.rpk` is `library\re-rpk\SKILL.md`. Do not call `skill` for `re-vmp` or `re-rpk` | `agi-reverse` |
| Math (proofs, counterexamples, calculation, homework/contest problems, solution checking, modeling, formalization, open research, papers/notes, inventing concepts/tools/frameworks, or a mathematical construction for a research or design question) | `agi-math` |
| Published DSH plugin / bundle / profile / cordis.yml layers / defineTool / official plugin contract | `dsh-plugin-guide` |
| Remotion video: create, markup, captions, maps, 3D, render, Studio, SaaS, docs, or upgrade | `remotion-best-practices`, then `file_read` the domain file it names under that skill. Do not call `skill` for a nested `remotion-*` name. |
| Music written as scribbletune plus a SoundFont render: a song, a beat, a loop, a score | `agi-music` |
| Build or reshape a web page's visual design: aesthetic direction, typography, palette, layout, and copy | `frontend-design` |
| Design or improve a module's interface, seam, depth, or testability | `codebase-design` |
| Throwaway prototype that answers whether a state model or UI feels right | `pocock-prototype` |
| Writing or editing a skill, `AGENTS.md`, or `CLAUDE.md` | `writing-for-agents` |
| Hand this conversation to a fresh background agent that continues now | `session-handoff` |
| A Blockbench `.bbmodel`, Minecraft cube model, voxel rig, or GeckoLib export | `blockbench` |
| A Minecraft structure, terrain, or scene exported as a structure dictionary | `minecraft-build` |
| Nukkit-MOT Java plugin, plugin.yml, MOT-SNAPSHOT, DDUI, or PyRpc | `nukkit-mot-plugin-dev` |
| A pixel image at any width and height: a pixel texture or sprite | `pixel-art` |
| 币市, OKX 现货, OKX 永续, or 美股 quotes and candles | `market-desk` |
| A named http(s) page | persona `<fetch_url>` (`read_page` on the host `@liustack/modsearch`; do not call `skill` or the `modsearch` CLI) |
| Current web facts or posts on X | `web_search` or `x_search` (same host package; do not call `skill` or the `modsearch` CLI) |
Several can apply. Process first, then implementation.

## Independent review

Do not be the only reviewer of your own non-trivial diff. Load `requesting-code-review` and reuse the standing session reviewer exactly as `<parallel_work>` states (`list_agents`, then `send_message`; never `run_in_background: false`; never fork), or hand the work to an AgentTeams reviewer, with a complete six-slot prompt (goal / scope / constraints / inputs / output / acceptance), the requirement, the paths, and `git diff` / the files — not this session's thought chain. Call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low` — not `medium`, `high`, or `xhigh`. When feedback returns, load `receiving-code-review` before implementing it. Fix Critical/Important before proceeding. Push back with code evidence when the reviewer is wrong.

Skip for a one-file typo, a small wording / policy-text tweak, a question, or when the user is the reviewer.

## DSH mapping

Skills speak in actions. On this preset they resolve as:

| Action | DSH |
|---|---|
| Invoke a skill | `skill` with the exact catalog `name` |
| Dispatch a one-shot **read-only** child | `subagent` (fresh) or `subagent_fork` (inherits this conversation). Code review is not this row; it reuses `session reviewer` and never forks. Before `subagent` or `subagent_fork`, call `set_subagent_reasoning_effort`. Reviewers and other non-edit children use `reasoning_effort` `off` or `low` — not `medium`, `high`, or `xhigh`. Children that are not reviewers: `off`, `low`, or `medium`. Fork inherits the parent effort; prefer spawn when the child should stay cheap, and clear the override first if that fork must keep the inherited effort. |
| Any edit that is multi-file, independent parallel implementation, durable handoff, or quality gates | Load `agent-teams`, then AgentTeams (`agent_teams_*`). Do not start AgentTeams for one-file or this-turn-only work — edit those yourself. Do not demote an edit onto a write-capable `subagent`. A member contract must be complete, standalone: the member does not share this conversation, so include goal / scope / constraints / inputs / output / acceptance. Members that are not reviewers pass `reasoning_effort` as `off`, `low`, or `medium` — not `high` or `xhigh` on `agent_teams_add_member`. Reviewer members pass `off` or `low` — not `medium`, `high`, or `xhigh`. A nested `subagent` uses `set_subagent_reasoning_effort` instead of a tool argument. |
| This-turn short queue | `todo_write` (load `agi-loop` on multi-step this-turn work) |
| Durable DAG that outlives this turn / multi-file long plan | `super_goals_*` (load `super-goals`). `PLAN_NOT_FOUND` → `super_goals_edit` `init_board` + `add_node`, no path parameter. Module `completion` defaults to required (auto-settles); `optional` stays open until `super_goals_update` |
| Ask the user a choice | `ask_user_question` |
| Design gate | `enter_plan_mode` / `exit_plan_mode` |
| Read / edit files | `file_read` / `file_edit` / `file_write`. Relocate a file or directory with `file_move` (`from`, `to`); the source stays until the destination matches. `file_write` creates or replaces a whole file, including missing parents. `file_edit` applies ordered exact `old_string` / `new_string` replacements and cannot create a file. A config key, an error string, or comment text is `grep` / `glob`. A symbol, a flow, or code you can name goes through the host plugin `dsh-codegraph` core surface (bundled Windows CLI; do not install `codegraph` onto PATH): `codegraph_status`, then `codegraph_explore` (`codegraph_init` once if status says the project is not initialized; `codegraph_sync` after a source edit). Do not re-check an explore result with grep. Do not call `codegraph_reindex`, `codegraph_overview`, `codegraph_search`, `codegraph_callers`, or `codegraph_impact` unless that exact name is in this session's tool list. There is no `codegraph_reindex`. Do not write `codegraph.json` and do not shell out to `python -m codegraph`. If a codegraph tool says the project is not indexed and you did not init, stop calling codegraph and use `grep` / `file_read` |
| Shell | `pwsh` on Windows, `bash` elsewhere. No `tools.shell` |
| Deliver files the user asked to receive | `present` |
| Project instruction files | Persona `<project_instructions>`: nested files win; user chat wins; do not re-read root files already in context |

Trust this session's tool list.

## What this preset does not copy

- No spec or plan files in the repo unless the user asked for a file.
- No git worktree / branch / commit / PR unless asked.
- No "Using [skill] to…" in the user-facing message (thoughts only).
- No approval pause for reversible local work they already requested.
- Plan mode is the design gate (`enter_plan_mode`), not a spec file in the repo.
- No companion server; visual questions use live browser tools or `present`. Design process lives in `design-before-build` (shared understanding, 2–3 approaches, plan self-review).
- AgentTeams for multi-file / parallel / durable / quality-gate edits and read-only `subagent` for probes. Dispatch stays on in every mode. Do not start AgentTeams for one-file or this-turn-only work. A handoff prompt must be complete, standalone: the child does not share this conversation.
- Use `todo_write` (this-turn), `super_goals_*` (durable DAG; load `super-goals`), `file_edit`, `subagent`, `job_output`/`job_kill`, the cognition ledger, live catalog tools, hidden thoughts, stop, and `ask_user_question` (`agi-loop`).

## Red flags — you are rationalizing (general excuses shared by all skills)

| Thought | Reality |
|---|---|
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "This doesn't need a formal skill" | If it matches, load it. |
| "I remember this skill" | Skills evolve. Load the current version. |
| "I'll just do this one thing first" | Check before doing anything. |
| "Simple, I'll just patch it" | Simple bugs have root causes. Debug skill first. |
| "I know the process, no need to load the skill" | Load the current skill. |
| "Should pass now" | Run the command this turn. |
| "I'll review the diff myself" | Dispatch a reviewer on a non-trivial slice; keep this context for driving. Skip for a one-file typo or a small wording / policy-text tweak. |
| "Plan later, code now" on a new subsystem | `design-before-build` / plan mode. |
| "Keep it simple, just stack more of the same" | Name the mechanism; use the strongest primitive that hits the goal. |
| "Add a sleep so the test is stable" | Wait on the condition, not a guess. |
| "While I'm here, also clean this up" | Out of scope. Don't. |
| "I'll stop and offer to continue" | Grok keep-going: act until resolved or blocked. |
