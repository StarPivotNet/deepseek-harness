---
name: dispatching-parallel-agents
description: Use in every mode when 2+ independent domains can run without shared state — one child per domain, same-turn dispatch. Read-only slices use `subagent`; multi-file / parallel / durable / quality-gate edits use AgentTeams. Do not start AgentTeams for one-file or this-turn-only work. Do not use when failures share a cause or you still need one investigation to see the whole system.
---

# Dispatching parallel agents

Iron law stays. Read-only `subagent` vs AgentTeams is this preset's split.

**Core principle:** One agent per independent problem domain. Dispatch them in the same turn. You keep this context for coordination.

Be fast, accurate, strong, and smart: use live catalog tools, dispatch Agents on 2+ independent domains, never invent tools/facts/file content, never claim without this-turn evidence. Persona parallel work still decides read-only `subagent` vs AgentTeams by mutation. This skill is **how to split and prompt** once that choice is made. Dispatch stays on in goal, plan, AgentTeams, and nested children. Children each take one domain; the parent keeps the `todo_write` queue (`agi-loop`).

## When

**Do:** 3+ failing tests with different root causes; independent subsystems; each slice understandable without the others; no shared files or resources.

**Don't:** related failures (fix one might fix others); you still need the whole-system picture; exploratory "what's even broken?"; children would collide on the same files.

Two named independent slices this turn is enough to dispatch — do not walk them yourself. Skip only one file with no sibling, or a question that needs no extra probe.

## v1 or v2 (do not demote)

| Shape | Tool |
|---|---|
| Independent one-shot **read-only** slices: probes, research, disjoint reads, mapping | `subagent` (fresh). Default background. Encouraged in plan mode. Nested children may launch further read-only subagents. Call `set_subagent_reasoning_effort` with `reasoning_effort` `off` or `low` — not `medium`, `high`, or `xhigh` before the spawn. Foreground (`run_in_background: false`) only when the next action depends on that result. Code review is not this row; it reuses `session reviewer`. |
| Multi-file edits, independent parallel implementation, durable handoff, or quality gates | Load `agent-teams`, then `agent_teams_create` this turn. Always `approval="automatic"`, including user-named AgentTeams / `/agent-teams`. Never staged; never call `agent_teams_approve`. Plan mode writes this into the plan; create the team only after `exit_plan_mode` reports approved. Do not start AgentTeams for one-file or this-turn-only work — edit those yourself |

Do **not** `subagent_fork` for this pattern — children must not inherit this conversation. You construct exactly what they need.

Plan mode: dispatch read-only `subagent` exploration. Do not start AgentTeams or write-capable children until the plan is approved — then edits that still need a team go through AgentTeams.

Saying you will delegate but never launching does not count.

When launching `subagent` or `subagent_fork` for work that is not a review, call `set_subagent_reasoning_effort` first with `reasoning_effort` `off`, `low`, or `medium` — not `high` or `xhigh`. `agent_teams_add_member` still passes `reasoning_effort` as `off`, `low`, or `medium` — not `high` or `xhigh`. Reviewers, and other read-only non-edit children (probes, research, mapping), pass `off` or `low` — not `medium`, `high`, or `xhigh`. Fork inherits the parent effort and cannot override it unless that tool is active; clear the override before a fork that must keep the inherited effort; prefer spawn when the child should stay cheap.

## Pattern

1. **Group by what's broken**, not by file count. One domain = one child. Related failures stay with one child.
2. **Write a focused prompt with the six contract slots**: goal / scope (files) / constraints / inputs (error text, fixtures) / output format / acceptance (how you verify). Missing slots mean the child improvises.
3. **Dispatch in the same assistant turn.** Several `subagent` calls in one message run together. One per turn is sequential. For v2: roster + DAG in the create turn; independent tasks have no fake dependencies.
4. **When they return:** read each summary; check they did not edit the same code; run the suite / the proof this turn (persona `<validating>`); then integrate. Do not assume green from a child's claim.

Each child still loads any *other* catalog skill its task needs (`systematic-debugging`, `requesting-code-review`, …). They skip `using-superpowers` and `agent-teams` (captain-only).

## Prompt (self-contained)

A handoff prompt must be complete, standalone: the child does not share this conversation. Put every fact in the prompt. Specific return. Constraints so they cannot refactor everything.

```
Fix the failing tests in {PATH}:

{numbered failing test names + expected vs actual}

These look like {hypothesis, not a verdict}. Your task:
1. Read the test file and the production code it covers.
2. Find the root cause — do not patch the symptom.
3. Fix only this domain. Do not change unrelated files.
4. Do NOT just increase timeouts / skip tests.

Return: root cause, files changed, how you verified (command + this-turn output). If you did not run it, do not claim pass.
```

Paste error text and test names. Do not write "fix the race" with no path.

Bad vs good dispatch (same task, different prompts):
- Bad: `Fix the race` — no path, no failing case, no acceptance. The child can only guess.
- Good: the template above — PATH, numbered cases, hypothesis labeled as hypothesis, Return format fixed.

Reviewers: `requesting-code-review`. Reuse the standing session reviewer exactly as `<parallel_work>` states (`list_agents`, then `send_message`; never `run_in_background: false`; never fork). Fill all six contract slots. Call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low`.

## After they return

1. Review each summary — what actually changed.
2. Conflict check — same files / overlapping edits.
3. Run the full relevant suite this turn.
4. Spot-check — children make systematic errors (timeouts, expectation edits, drive-by refactors).

If two children collided: stop, take one domain back, re-dispatch the other with a tighter file list.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "Fork so they have my context" → fresh `subagent`; put the context in the prompt.
- "This is v2 but subagents are faster" → multi-file / parallel / durable / quality-gate edits are AgentTeams; do not demote those onto a write-capable `subagent`. Do not start AgentTeams for one-file or this-turn-only work.
- "They said tests pass" → you run the proof this turn.
