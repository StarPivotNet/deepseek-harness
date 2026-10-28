# dsh-super-goals

![banner](https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/banner.svg)

**Turns your project into a living task mind-map — and makes the agent actually follow it, blocking drift on the spot.**

Plan → module → task tree, cross-branch dependency arrows, live topological order badges, an agent GPS station marker, a human-approval gate for plan edits, an evidence gate for "done", and hard tool-scope enforcement inside a [DeepSeek Harness](https://github.com/deepseek-ai) session.

[**中文**](README.md) · [Releases](https://github.com/hoyyang/dsh-plan-board/releases) · [Changelog](CHANGELOG.md) · [Design doc](docs/DESIGN.md)

## Install

```sh
dsh plugin --profile web add github:hoyyang/dsh-plan-board
# build output is committed — no local build needed
```

Restart `dsh web`. A **SuperGoals** pill appears in the session header (left of the "⋯" menu). Open it to see the current session's plan board.

```sh
dsh plugin --profile web remove @dsh-external/dsh-super-goals   # uninstall
```

Requires `dsh >= 0.1.5-rc.1`. Zero configuration — no API key; all plan data lives inside your own project directory.

## What it looks like

<p align="center">
  <img alt="plan board panel" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/panel.png" width="420">
</p>

- **Panel** (561×720): plan → module → task tree; dashed violet lines are dependencies; the `#N` badge is the topological execution order; green means done. The top banner is a drift block, the bottom is the live event timeline (`status_changed` / `human_edit` — everything leaves a trace).
- **Header button**: rests as a 31×31 circle (left) and expands leftwards into a full pill on hover (right) — both states share the same 15.5px corner radius (= half the height), so the curvature never changes; the right edge stays pinned and the neighbouring "⋯" menu never moves.

<p align="center">
  <img alt="button collapsed" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/button-collapsed.png" height="56">
  &nbsp;&nbsp;
  <img alt="button expanded" src="https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/button-expanded.png" height="56">
</p>

## The problem

Agents do not drift out of disobedience; they drift because there is **no executable source of truth for the plan**. The plan lives in the conversation and dies at the first context compaction; nobody knows which task is in flight; "done" comes with no evidence; plan edits leave no trace. dsh-super-goals materialises the plan as a file the agent must obey — `<cwd>/.super-goals/<session>/board.json`.

## Agent tools (4)

| Tool | What it does |
| --- | --- |
| `super_goals_map` | Read the board: module/task tree, deps, topological order, station, drift block |
| `super_goals_edit` | Change the board: structural edits apply immediately and require a reason |
| `super_goals_next` | Issue **the single** next ready task (deps satisfied + priority), marking it `doing` (L1 single-issue lock) |
| `super_goals_update` | Transitions `planned/ready → doing → done/blocked`; **done requires evidence** (L3); also closes modules |

## Five anti-drift layers

| Layer | Mechanism | Default |
| --- | --- | --- |
| L1 | **Single-issue lock** — only one `doing` task; `super_goals_next` refuses otherwise | on |
| L2 | **Audited edits** — `super_goals_edit` requires a reason and applies immediately | on |
| L3 | **Evidence gate** — `done` without evidence → `EVIDENCE_REQUIRED` | on |
| L4 | **Git cross-check** — commits during a `doing` task that fall outside its `scope` raise drift | on |
| L5 | **Drift blocking** — an unhandled drift alert blocks issuing until cleared | on |
| L6 | **LLM arbitration + watchdog** | M4, not scheduled |
| L7 | **Removed** — `write`/`edit` are not denied by the current task scope, and `enforceScope` is no longer a config key | — |

## Features

- **Mind-map panel** — React + hand-rolled SVG horizontal tree, auto-grouped by module; wheel zoom (native non-passive listener, panel itself does not scroll), background panning, free node placement (`pos` is view state only, never linted).
- **Direct editing** — click a node for an edit card (title / priority / note / acceptance / scope / deps), drag nodes, drag from the violet handle to rewire dependencies, add subtasks, delete nodes.
- **Save gating** — every panel change is a draft (banner shows "N unsaved changes"); only "Save" batch-posts `/edit` and records a `human_edit` event; "Discard" rolls everything back. Cycles are rejected client-side first and server-side by lint. Status is never edited in the panel.
- **Module dependencies really count (v0.2.0)** — a dependency declared on a module bubbles down to its subtasks, so "big task 3 depends on big task 2" genuinely blocks task 3-1. A module completes when it is explicitly `done` or all of its tasks are done/canceled; empty modules never auto-complete; deadlocks that only appear after bubbling are rejected by lint.
- **Live updates** — `/stream` NDJSON push plus a 4s polling fallback for the drift banner and the event timeline.
- **Header button** — rests as a 31×31 circle showing only the galaxy icon, and expands leftwards into a full pill on hover, keyboard focus or while the panel is open (same 15.5px radius in both states) (right edge pinned, neighbours glide out of the way). A status dot polls `GET /state` every 15s (cyan = idle, amber = N in progress, red = drift/blocked, grey = unset); in the collapsed state the icon's halo colour carries that signal. Both themes, `aria-pressed`, `focus-visible`, `prefers-reduced-motion`.
- **Storage** — `<cwd>/.super-goals/<session>/`: `board.json` (machine authority, optimistic `version` + SHA-256 digest), `events.jsonl` (append-only audit), `ROADMAP.md` (human-readable mirror).

## Authority

`.super-goals/<session>/board.json` is the single authority for plan and task state.

## Usage

1. **Agent side** — `super_goals_map` first (after every new session or compaction), `super_goals_next` to take exactly one task, `super_goals_update` with evidence when done, `super_goals_edit` for plan changes (applied immediately, reason required).
2. **Human side** — open the panel from the header **SuperGoals** button, then clear drift blocks.

## Boundaries (what it does not do)

- No Kanban view — the mind map is the primary form (by decision).
- Not an issue tracker: one board per project, no multi-user/permissions/notifications.
- Status is not editable in the panel — it must go through `super_goals_update`'s evidence gate.
- It does not keep a global tool-call log, and it does not block `write`/`edit` by task scope.
- Gantt/critical-path and LLM arbitration (M4) are not scheduled.

## Development

```sh
npm install                      # local devDependencies (tsdown, …)
bash scripts/build.sh            # host: tsc → lib/
npm run build:client             # client: tsdown bundle of the panel
```

Commit `lib/` together with source changes — GitHub installs rely on it.

## Uninstall

```sh
dsh plugin --profile web remove @dsh-external/dsh-super-goals
```

Uninstalling never deletes your `.super-goals/` data.

## License

BSD-3-Clause
