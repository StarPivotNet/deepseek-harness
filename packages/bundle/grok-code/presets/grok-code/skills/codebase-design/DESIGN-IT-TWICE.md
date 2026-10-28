# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this parallel read-only `subagent` pattern. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best. These children propose interfaces. They do not edit files. Do not start `agent-teams` for this exploration.

Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before dispatching `subagent`s, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user in the same turn you dispatch. Do not wait for a reply. The user reads and thinks while the children work in parallel.

### 2. Dispatch subagents

Dispatch 3 or 4 read-only `subagent` calls in the same turn, one per design constraint. Each child must produce a **radically different** interface for the deepened module. Default `run_in_background: true`. Call `set_subagent_reasoning_effort` with `reasoning_effort` `off` or `low` — not `medium`, `high`, or `xhigh`. Prefer `off`. Do not overthink.

Prompt each `subagent` with a separate technical brief (file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1. The child does not see this conversation, so the brief includes every fact it needs. Give each child a different design constraint:

- Agent 1: "Minimize the interface: aim for 1–3 entry points max. Maximise leverage per entry point."
- Agent 2: "Maximise flexibility: support many use cases and extension."
- Agent 3: "Optimise for the most common caller: make the default case trivial."
- Agent 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Include the [SKILL.md](SKILL.md) vocabulary in the brief, plus the project's own domain terms, so each child names things consistently. There is no separate glossary file.

Each child outputs:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
