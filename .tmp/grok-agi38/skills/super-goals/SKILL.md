---
name: super-goals
description: Use when work outlives this turn, spans files, or needs a durable DAG — session-bound super_goals_map / edit / next / update. Do not use for a one-line answer or a this-turn-only short queue (that is todo_write).
---

# Super-goals (durable session DAG)

Session-bound board for long-running work. `todo_write` lists only THIS TURN's 1–N short steps (the official projection clears each turn). The DAG that must survive compaction, children, and later turns is `super_goals_*`.

Load this skill before mapping or mutating the board. Subagents and AgentTeams members share the root session board — they do not get a private board.

The runtime binds the board to the current session. These tools take no path parameter. Do not pass a workspace, cwd, or session directory as an argument. On disk the board is `board at <cwd>/.super-goals/<session>/board.json`; mention that location in the cognition Goal line, not as a tool argument.

## When

**Do:** non-trivial multi-turn work; multi-file work; a DAG that must outlive this turn; children that must see the same plan.

**Don't:** a one-line answer; a single-file typo; a this-turn-only short list (`todo_write` + `agi-loop`).

## Iron laws

1. **Map first.** Non-trivial / multi-turn / multi-file work starts with `super_goals_map`.
2. **PLAN_NOT_FOUND or empty board → init.** `super_goals_map` with `{ok:false, code:"PLAN_NOT_FOUND"}` is the empty-board signal, not a missing path. Immediately call `super_goals_edit` with `init_board` plus the first `add_node` modules/tasks in the same `ops`, and a non-empty `reason`. This runtime applies the edit immediately (`status: "applied"`). Do not wait for panel confirmation. Do not invent a second planner. Do not retry `super_goals_map` hoping a path argument will appear.
3. **Split with edit.** Add/split/retitle modules and tasks with `super_goals_edit`. Keep tasks leaf-sized. A `task` MUST have `parent` set to an existing `module` (`BAD_PARENT` otherwise). Dependencies are real prerequisites only. `super_goals_edit` does not accept status — that is `STATUS_VIA_TASK_UPDATE`; status flows only through `super_goals_update`.
4. **Next, then act.** `super_goals_next` names the current leaf and marks it `doing`. Put that leaf's THIS-TURN short steps on `todo_write`. Independent this-turn slices may run `in_progress` together. L1: already-`doing` → `SINGLE_ISSUE` — finish or block that leaf before taking another. L5: open drift → `DRIFT_BLOCKED` — the human clears it on the SuperGoals panel; do not invent a clear tool.
5. **Update with evidence.** Finish a board step with `super_goals_update` (`taskId` + `status`). Status `done` needs a non-empty `evidence[]` (command, path, or measured result from this turn) or the tool returns `EVIDENCE_REQUIRED`. Blocked needs the concrete blocker in `note`. Do not mark done from a guess. Close an optional-root `module` the same way — children finishing does not settle it.
6. **Do not dump the DAG into todo_write.** `todo_write` is the this-turn short queue only. Do not paste the board into `cognition.md` either — Goal is one intent line plus the board location.
7. **Required vs optional roots.** A `module` defaults to required (`completion` omitted or `"required"`): it auto-settles when every child `task` is `done`/`canceled`, and nodes that `deps` it unblock. Set `completion: "optional"` only when that slice must stay open; dependents stay blocked until you `super_goals_update` that module `done`. Do not invent a second node type.

## Loop

```
user request
  → super_goals_map
  → PLAN_NOT_FOUND / empty? super_goals_edit init_board + add_node (same ops, reason required)
  → split modules/tasks with super_goals_edit
  → super_goals_next → todo_write (this turn's 1–N short steps)
  → act with live catalog tools
  → super_goals_update (done + evidence[] / blocked + note; optional-root modules need an explicit done)
  → repeat until required roots have settled (or you explicitly done the optional ones) or genuinely blocked
```

## Tools

| Tool | Args | Use |
|---|---|---|
| `super_goals_map` | none | Read the current session board (modules, tasks, status, station, drift). `PLAN_NOT_FOUND` → init |
| `super_goals_edit` | `ops` (array) + `reason` (string, required) | Structure only. Applied immediately. Takes no path parameter |
| `super_goals_next` | none | Issue THE next ready task and mark it `doing`. Refuses on `SINGLE_ISSUE` / `DRIFT_BLOCKED` |
| `super_goals_update` | `taskId`, `status`, `evidence?`, `note?` | Advance a node. `done` requires `evidence[]` |

Do not invent other planner names. These tools take no path parameter.

### `super_goals_edit` ops

All ops in one call apply together. `reason` is mandatory (`REASON_REQUIRED` if missing).

| `op` | Fields |
|---|---|
| `init_board` | `name`, `goal` |
| `add_node` | `node`: `id`, `type` (`module` \| `task`), `title`, `parent?` (required for task — a module id), `deps?`, `priority?`, `acceptance?`, `scope?`, `completion?` (`required` \| `optional`, modules only; default `required`) |
| `update_node` | `id`, `fields` (`title`, `note`, `acceptance`, `scope`, `priority`, `parent`, `deps`, `pos`, `completion`). Never `status` |
| `remove_node` | `id` (must have no children — `HAS_CHILDREN` otherwise) |
| `set_deps` | `id`, `deps` |
A `module` is a required root by default (`completion: "required"` or omitted): it auto-settles when every child `task` is `done` or `canceled`, and other nodes that `deps` it become unblocked. Set `completion: "optional"` for a module that must not auto-settle — children finishing does not complete it and does not satisfy dependents until the module is explicitly `done`. Tasks do not take `completion`. The panel origin card (`__root__`) is not a board node.

Copy-paste first cut (same `ops` as `PLAN_NOT_FOUND` recovery):

```json
{
  "reason": "init the session DAG from the user request",
  "ops": [
    { "op": "init_board", "name": "short-plan-name", "goal": "one-line user intent" },
    { "op": "add_node", "node": { "id": "m1", "type": "module", "title": "first slice" } },
    { "op": "add_node", "node": { "id": "t1", "type": "task", "title": "first leaf", "parent": "m1", "acceptance": ["measured result"], "scope": ["path/to/touch"] } }
  ]
}
```

### `super_goals_update` status

Task flow: `planned` → `ready` / `doing` / `blocked`; `ready` → `doing` / `blocked` / `planned`; `doing` → `done` / `blocked` / `planned`; `blocked` → `doing` / `ready` / `planned`; `done` → `doing`; any → `canceled`; `canceled` → `planned` / `ready`. Module flow: `planned`/`ready` → `done` or `planned`; `done`/`canceled` → `planned`; any → `canceled`. Do not put a module in `doing` or `blocked` (container is not work). A required-root `module` (default) also auto-settles when every child `task` is `done`/`canceled`; an optional-root `module` (`completion: "optional"`) does not — dependents stay blocked until that module is explicitly `done`.

```json
{ "taskId": "t1", "status": "done", "evidence": ["pwsh tests/plan-board.test.mjs exit 0"] }
```

## Cognition

In `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md`, Goal is:

- one intent line
- board at <cwd>/.super-goals/<session>/board.json

Do not paste the whole DAG into cognition.md. Queue in that file is a durable copy of this-turn `todo_write`, not the full board.

## Red flags

| Thought | Reality |
|---|---|
| "I'll keep the long plan on todo_write" | That list clears each turn. Use the board |
| "Give the child its own board via a path argument" | These tools take no path parameter. Children share the root session board |
| "Mark it done, tests should pass" | `done` needs `evidence[]` from this turn or `EVIDENCE_REQUIRED` |
| "Skip map, I remember the plan" | `super_goals_map` first |
| "PLAN_NOT_FOUND means I need a path" | It means `init_board` + `add_node` in one `super_goals_edit` |
| "Wait for the human to approve the edit" | This runtime applies immediately. Do not wait for panel confirmation |
| "Take the next leaf while one is doing" | L1 `SINGLE_ISSUE` — update the current leaf first |
| "Put status on add_node / update_node" | `super_goals_edit` does not accept status (`STATUS_VIA_TASK_UPDATE`) |
| "Every module auto-completes when children finish" | Only required roots (`completion` omitted or `required`). Optional roots stay open until you `super_goals_update` them `done` |
