---
name: design-before-build
description: Use before creative or architectural work — new features, new subsystems, "build X", choosing an algorithm vs stacking copies, modifying behavior. The gate is DSH plan mode. Do not use for a named one-file bugfix after takeover, or when the user already approved a design and said implement.
---

# Design before build

The approval gate is DSH plan mode, not a spec file and not a companion server.

## Classify out loud in thoughts (not as user-facing ceremony)

- **Spike** — "can we / is it possible / throwaway is fine". Output is an answer, not kept code. 2–3 sentences of what you will try; then probe as cheaply as correctness allows. Label anything built as throwaway. Keeping it is a new request.
- **Bounded** — well-scoped change to a flow that **already exists in this repo** (flag, small endpoint, one-file behavior). Familiarity with this *kind* of app is not enough. Short design: approach, files, test plan.
- **Architectural** — new project, new subsystem, interface others depend on, or restructuring how pieces fit. Heavier design. When in doubt, take this path. Complexity discovered mid-task upgrades the path — never downgrades it.

## Shared understanding

The outcome is an understanding the user can recognize and correct, grounded in what they want.

1. **Discover intent.** Intended outcome, who it is for, what success looks like. When purpose or intended use is missing, ask one focused question before proposing features or an approach. Knowing the app genre does not tell you why they want it. Gathering a missing requirement is not asking them to authorize the task again.
2. **Write the understanding back.** Short note: intended outcome, constraints, success criteria. Separate what they said from assumptions. Invite correction; fold their answer before treating this as the brief.
3. **Carry it forward.** Check every proposed feature and technical choice against that brief. Spike / bounded: the in-chat design or probe. Architectural: the plan-mode plan.

When the request already supplies purpose and constraints, reflect that instead of re-asking.

## Gate (maps onto this preset)

| Path | What you do | When you implement |
|---|---|---|
| Spike | Probe after a nod-sized plan in chat | Never keep spike code unless they ask |
| Bounded | If they asked to plan, `enter_plan_mode`. Else a short design in thoughts + implement the reversible local work they requested | After the design is decision-complete (plan mode: `exit_plan_mode` reports approved; default mode: they already asked you to do it) |
| Architectural | `enter_plan_mode` this turn before any mutation. Explore, ask only user-owned choices, write a decision-complete plan | After `exit_plan_mode` reports approved — next step implements. Keep planning / dismissed review: stay, revise, present again. Do not implement while still in plan mode |

User instructions win. "先规划 / plan first / don't implement yet" → plan mode even if bounded. "直接改 / just implement" → skip the pause; still classify and keep the change surgical.

Before product code, scaffolding, installing product dependencies, or creating an external project, finish the selected path's prerequisites. A reply approves the stage actually presented: idea-yes is not plan-yes. Resume at the earliest incomplete stage. Read-only exploration is allowed while those remain incomplete.

Do **not** write a spec file in the repo unless they asked for a file. Do **not** invent a plan markdown in the repo. Chat / plan-mode output is the artifact. Do **not** start a companion server, and do not copy companion scripts.

## Bounded vs architectural (common mislabel)

- New repo or no existing flow to change → architectural.
- Reaching for "bounded" to skip design → take the heavier path.
- Spike succeeded ≠ permission to keep the code.
- They approved a spike ≠ the follow-up change is approved. Each task gets its own classification.

## Architectural process (plan mode)

Explore the repo first (files, docs, recent commits). Ask second.

If the request is multiple independent subsystems (chat + storage + billing + analytics), say so immediately and design the first slice — do not spend questions refining a project that needs splitting. Each slice gets its own plan → implementation cycle.

User-owned choices: `ask_user_question` with 2–4 mutually exclusive options plus a recommended default. Do not dump a questionnaire. Never ask discoverable repo facts.

Propose 2–3 approaches with trade-offs. Lead with the recommendation and why. YAGNI: strip unrequested features from every approach. Unrequested means a second goal; keep the pieces the chosen approach needs for its success condition.

Present the design in the plan, sections scaled to complexity (a few sentences if straightforward): architecture, components, data flow, error handling, tests. Isolation: each unit has one purpose, a defined interface, and can be understood without reading internals. Follow existing patterns. Include only targeted structural fixes that serve this goal — no unrelated refactor.

### Plan self-review (before `exit_plan_mode`)

1. **Placeholder scan** — TBD / TODO / incomplete / vague: pick one reading and make it explicit.
2. **Internal consistency** — architecture vs features; no contradictions.
3. **Scope** — focused enough for one implementation, or decompose.
4. **Ambiguity** — two interpretations: pick one.

Fix inline. Dispatch a read-only plan reviewer only when the plan is large enough that self-review is unreliable: `subagent` (never fork); fill all six slots (goal / scope / constraints / inputs / output / acceptance); call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low` — not `medium`, `high`, or `xhigh`. Prefer `off`. The reviewer must emit tools only during the review (0 user-facing words) and speaks only in the final six-slot report. Pass the plan text, not this session's thoughts. Flag only gaps that would cause the wrong implementation. The user review is `exit_plan_mode`, not a committed spec file. Do not invoke a writing-plans skill — the approved plan is the implementation handoff.

## Mechanism over volume

Name the driving mechanism before drawing or coding. This is general: parsers, solvers, tables, state machines, and shared clocks count, not only animation. The goal licenses the strongest primitive that actually implements it. Do not self-censor because the tool looks advanced, academic, or "too much for this file".

YAGNI still forbids unused files, speculative helpers, and drive-by refactors. It does **not** forbid IK, a parser, a solver, a state machine, or a shared clock when that is the shorter path to the goal.

Low-level stacking is failure: copy-paste with tweaks, a long if/else where a table or solver would do, one `@keyframes` per limb, SMIL on every group, independent CSS loops as locomotion.

## Visual / motion

A Remotion video (programmatic React video: composition, captions, maps, 3D, render, Studio, SaaS) is not that bar: load `remotion-best-practices` first, then `file_read` the domain file it names. Do not call `skill` for a nested `remotion-*` name.

## Visual questions (see vs read)

A question is visual only if seeing beats reading: mockups, wireframes, layout comparisons, architecture diagrams. A question *about* a UI topic is still text. Conceptual A/B, tradeoff lists, API / data-model choices → `ask_user_question` / chat.

If a visual question arises and live browser tools exist, use them. Else write a small HTML/SVG and `present` it. Never copy or launch a companion server. Do not offer a companion as its own message.
## After design

- After a non-trivial multi-file implementation → `requesting-code-review`.
- A multi-file edit, or an edit that needs an independent review, uses AgentTeams. A one-file change, or work that finishes this turn, stays in this session. Read-only probes stay `subagent`. Dispatch in every mode, including plan (read-only only until approved).
- Bite-sized work: each todo is a testable outcome, not "investigate X". Fold setup into the task that needs it.
- YAGNI. Unused surface out; the right algorithm in. One clear responsibility per new file. Follow existing patterns; do not unilaterally split large files unless the file you are touching is already unwieldy.

## Don't

- Implement an architectural change before `exit_plan_mode` reports approved.
- Write a spec file in the repo or invent a plan markdown unless they asked for a file.
- Invoke a writing-plans skill, commit a spec, or start a companion server.
- Stack independent CSS `@keyframes` as locomotion before naming the shared clock.
- Self-censor a stronger primitive (IK, parser, solver, state machine) when it is the shorter path.
- Announce the spike / bounded / architectural label as user-facing ceremony.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "I'll start while they read the plan" → plan mode: present via `exit_plan_mode`, wait for approved.
- "I know this stack, so it's bounded" → bounded measures the repo.
- "It grew but I'm almost done" → upgrade the path, say so.
- "Too simple to need a design" → follow the selected path; scale the artifact, complete that path's reviews.
- "I'll add another @keyframes until it looks alive" → name the shared clock; coupled motion shares it. A working clock is not the illustration.
- "IK / a parser / a solver is too fancy for this" → if it is the shorter path to the goal, use it.
- "They approved the spike, so the follow-up is approved" → classify the follow-up.
