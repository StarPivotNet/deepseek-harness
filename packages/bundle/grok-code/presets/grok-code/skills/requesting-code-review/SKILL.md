---
name: requesting-code-review
description: Use after a non-trivial implementation, a major slice, or before claiming ready, and when the user wants a branch, PR, or "review since X" checked against the repo's standards and the originating spec. Dispatch read-only reviewers; do not self-review the same diff. Do not use for a one-file typo, a small wording or policy-text tweak, a question, or when the user is already the reviewer.
---

# Requesting code review

The reviewer is a DSH `subagent` or AgentTeams `reviewer`, not this session's thought chain.

**Core principle:** Review early, review often. Do not be the only reviewer of your own non-trivial diff. Runtime `agi-gates:critic` steers on turn-close when two or more implementation files changed and no this-turn independent review ran (a handoff whose text names the read-only Senior Code Reviewer, including `send_message` to the standing reviewer, or AgentTeams `kind: review` / a review `verdict`). Mapping `subagent`s, `agent_teams_create`, implementation tasks, and reassignment do not count.

## When

**Do:**
- After a multi-file change, a behavior change with tests, or a major feature slice
- Before claiming ready / mergeable / done on that work
- After a complex bugfix, or when stuck and a fresh read of the product would help
- After each AgentTeams implementation task that has a review gate
- When the user asks to review a branch, a PR, work in progress, or the diff since a commit, branch, tag, or merge-base

**Skip:** one-file typo, a small wording / policy-text tweak, a question, a plan with no code, or the user is already reviewing.

User "skip review / just ship" wins.

## How

1. Collect the work product, not this session's history: requirement or plan text, changed paths, and `git diff` / the files. If there is a commit range, pass `BASE_SHA` and `HEAD_SHA`; if the work is uncommitted, pass the paths and say so. For a user-named fixed point, pin it first (see **Two axes**).
2. Reuse the standing session reviewer exactly as `<parallel_work>` states. Call `list_agents`. If a direct child is labeled `session reviewer`, `send_message` that agent id with the full six-slot review and do not call `subagent` again. If none exists, call `subagent` once with `description` exactly `session reviewer` and leave `run_in_background` unset or `true`. Never `run_in_background: false`. Never fork. Call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low` — not `medium`, `high`, or `xhigh`. The message still starts with "You are a read-only Senior Code Reviewer" and tells the reviewer to judge only this message. `send_message` confirms delivery only. The session reviewer returns the six-slot report only as `send_message` to you and stops with no assistant text. Do not spawn a second reviewer to wait in the foreground. AgentTeams `kind: review` stays a team task, not another `session reviewer`.
3. Fill all six contract slots in every prompt: goal / scope / constraints / inputs / output format / acceptance. Placeholders: `{DESCRIPTION}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}` / `{HEAD_SHA}` or `{PATHS}`.
4. Act on the return: fix Critical immediately; fix Important before proceeding; note Minor; push back with code evidence when the reviewer is wrong (`receiving-code-review`). Then follow persona `<validating>` before claiming done. Do not call `skill` for that gate. A two-axis review is a report, not an implementation: keep Standards and Spec separate and do not start fixing unless the user asked.

Do not review the diff yourself to save a dispatch. That burns the context you need to keep driving. Do not give the reviewer this session's thoughts.

## Two axes

Use this when the user wants a review since a fixed point, or the diff has both a spec and documented repo standards. Send **Standards** and **Spec** as two self-contained messages to the same standing `session reviewer`, the second only after the first has settled, so a new subagent is not created per axis. Each message tells the reviewer to judge only that message. Report the two results side by side. A change can pass one axis and fail the other; do not merge or rerank findings across axes.

### 1. Pin the fixed point

The fixed point is the commit, branch, tag, `main`, or `HEAD~N` the user named. If they did not name one and this is a "review since X" request, ask for it. For your own just-finished uncommitted slice, the fixed point is the working tree: say so and pass the paths.

Capture `git diff <fixed-point>...HEAD` (three-dot, against the merge-base) and `git log <fixed-point>..HEAD --oneline`. Confirm `git rev-parse <fixed-point>` resolves and the diff is non-empty before spawning. A bad ref or empty diff fails here, not inside a child.

### 2. Find the spec

Look in this order: issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`), fetched the way `docs/agents/issue-tracker.md` says when that file exists; a path the user passed; then a spec under `docs/`, `specs/`, or `.scratch/` matching the branch or feature. If `docs/agents/issue-tracker.md` is missing, ask where issues live. If nothing is found, ask where the spec is. If the user says there is none, do not send the Spec message, and write "no spec available" under `## Spec`.

### 3. Find the standards, and always carry the smell baseline

Collect repo docs that say how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`. The Standards axis also carries the smell baseline below even when the repo documents nothing.

- **The repo overrides.** A documented repo standard wins. Where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*. Match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name does not reveal what it does or holds. → rename it; if no honest name comes, the design is murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape and call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together. → bundle them into one type and pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept. → give the concept its own small type.
- **Repeated Switches**: the same `switch` / `if` cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec does not have. → delete it; inline until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller should not depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly delegates onward. → cut it and call the real target directly.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance and use composition.

Also carry the structural bar below. It is the same kind of labelled heuristic, not a second axis. A documented repo standard still wins. Do not treat a line count, a cast, or a sequential flow as a violation by itself.

- **File past 1000 lines**: the diff pushes a file from under 1000 lines to over 1000. → extract a focused module first, unless the file stays clearly organized for a structural reason.
- **Spaghetti growth**: a new conditional, one-off boolean, or special case bolted onto an unrelated flow. → move it behind the abstraction, state machine, or module that owns that case.
- **Complexity preserved**: a refactor that moves the same concepts around, or keeps incidental branches when a reframing would delete them. → delete the layer; do not polish it. Name the reframing only when it is visible in the diff.
- **Hidden shape**: a generic mechanism that hides a simple data shape. → keep the direct flow. An identity wrapper is already Middle Man; do not report it twice.
- **Muddy boundary**: a cast, `any`, `unknown`, or optional used to paper over an invariant the diff could state. → make the contract explicit. Do not flag optionality the domain actually has.
- **Wrong layer**: feature logic leaked into a shared path, or a new helper duplicates one the codebase already has. → move it to the owning module and call the existing helper.
- **Half-applied update**: related writes that can leave state half-applied, or independent work serialized only because the flow was written that way. → make the related update atomic; run independent work in parallel when that also simplifies the flow. Skip micro-optimization.

### 4. Hand both axes to the standing reviewer

Use the same `session reviewer` from step 2. If `list_agents` has no child with that label, spawn it once. Send the Standards message first. Send the Spec message only after that review has settled. Do not spawn a second subagent for either axis. Each message still fills the six slots, stays read-only, and tells the reviewer to judge only that message. Call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low`. Paste the sources into the message; the reviewer has no other access to them.

**Standards** inputs: the diff command, the commit list, the standards files, and both heuristic lists pasted in full — the smell baseline and the structural bar. Brief: report, per file or hunk, (a) every documented-standard breach, citing file and rule, and (b) any heuristic from either list, named and quoting the hunk. Documented-standard breaches can be hard; baseline smells are always judgement calls; a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words.

**Spec** inputs: the diff command, the commit list, and the spec path or its fetched text. Brief: report (a) requirements missing or partial, (b) behaviour the spec did not ask for, and (c) requirements that look implemented but wrong. Quote the spec line for each finding. Under 400 words.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec`, verbatim or lightly cleaned. Do not merge them into one severity list and do not pick a winner across axes. End with one line: finding count per axis, and the worst issue within each axis if any.

A single post-implementation reviewer (the prompt below) still applies when there is no separate spec-versus-standards ask. Do not send the two-axis messages and that single review for the same diff.

## Reviewer prompt

Fill all six slots. Launch after `set_subagent_reasoning_effort` sets `reasoning_effort` to `off` or `low`. The reviewer delivers the six-slot report only with `send_message` to the parent, then stops with no assistant text.

```
You are a read-only Senior Code Reviewer. Review the completed work against the requirements. Do not mutate the working tree, index, HEAD, or branch. Do not spawn subagents. Deliver the six-slot report only with `send_message` to the parent agent id in your context, then stop with no assistant text.

## Goal
Review the completed work against the requirements and return a severity-calibrated verdict. When the parent names a standards source or a spec, also report Standards and Spec without merging those axes into the severity list. Match issues to the slots and stop. {DESCRIPTION}

## Scope
Paths: {PATHS}
Base: {BASE_SHA}
Head: {HEAD_SHA}

## Constraints
Read-only. Do not mutate the working tree, index, HEAD, or branch. Do not spawn subagents. Do not inherit or use the parent session's thoughts. Inspect with git show / git diff / git log, or read the named files if uncommitted. System1: findings only; empty sections stay empty. Do not pad, do not write architecture essays, do not hunt nits to look thorough. Deliver the six-slot report only with `send_message` to the parent agent id in your context, then stop with no assistant text.

## Inputs
Requirements / plan:
{PLAN_OR_REQUIREMENTS}

What was implemented:
{DESCRIPTION}

## Output format
### Strengths
### Issues
#### Critical (must fix) — bugs, security, data loss, broken behavior
#### Important (should fix) — architecture, missing features, error handling, test gaps
#### Minor (nice to have)
Each issue: file:line, what is wrong, why it matters, how to fix if not obvious.
### Recommendations
### Assessment
Ready to merge? Yes | No | With fixes. 1–2 sentence technical reasoning.

## Acceptance
A complete review names actual severity, file:line, why it matters, and a clear verdict. Do not write "looks good" without reading, nits as Critical, feedback on unread code, vague "improve error handling", or no verdict. Unused headings stay omitted; not everything is Critical. Deliver the six-slot report only with `send_message` to the parent agent id in your context, then stop with no assistant text.
```

## DSH notes

- Tools: `subagent` / AgentTeams reviewer. Not `subagent_fork`.
- Call `set_subagent_reasoning_effort` so `reasoning_effort` is `off` or `low` — not `medium`, `high`, or `xhigh`. Fill all six contract slots (goal / scope / constraints / inputs / output format / acceptance).
- Do not create a git worktree, commit, or PR unless the user asked.
- Do not write a review file in the repo unless the user asked.
- Announce the skill only in thoughts, not in user-facing prose.

## Don't

- Self-review a non-trivial multi-file diff to save a dispatch.
- `subagent_fork` a reviewer (it must not inherit this conversation).
- Call `set_subagent_reasoning_effort` with `reasoning_effort` `medium`, `high`, or `xhigh` for a reviewer.
- Give the reviewer this session's thoughts instead of the six-slot prompt, the requirement, paths, and diff.
- Create a git worktree, commit, or PR unless the user asked.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "I'll just review the diff myself" → dispatch. Keep this context for driving.
- "It's simple, skip review" → that is the rationalization this skill exists to stop.
