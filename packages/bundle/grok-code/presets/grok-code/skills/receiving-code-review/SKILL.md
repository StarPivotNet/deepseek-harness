---
name: receiving-code-review
description: Use when review feedback arrives, before implementing it — including a two-axis Standards and Spec report. Verify against this codebase, keep the axes separate, ask if unclear, and push back with evidence when wrong. Do not use for a plan with no feedback, or when there is nothing to implement.
---

# Receiving code review

Technical evaluation, not performative agreement. No pep talk, no thanks, tools over guesses.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## Pattern

When feedback arrives (user, `subagent` reviewer, AgentTeams `review` task, a two-axis Standards / Spec report, or an external comment):

1. **Read** the whole list without reacting. If the report has `## Standards` and `## Spec`, keep those axes separate. Do not merge them into one ranked list, and do not let a clean axis hide findings on the other.
2. **Understand** — restate the requirement, or ask. If any item is unclear, stop; do not implement the clear ones first. Related items will be wrong in isolation.
3. **Verify** against this checkout (`file_read` / `grep` / tests) and, for a two-axis report, against the cited standard or the quoted spec line. Do not trust the reviewer's session history.
4. **Evaluate** — sound for *this* codebase, or does it break working behavior / YAGNI / a prior user decision? A smell is a judgement call: a documented repo standard overrides it, and tooling that already enforces the rule means you do not re-implement the smell fix. A spec finding is about missing, extra, or wrong behaviour, not about style.
5. **Respond** with a technical acknowledgment or reasoned pushback. Then implement, or don't. A two-axis report is a report unless the user asked you to fix it.
6. **Implement** one item at a time; prove each. Then follow persona `<validating>`.

## Forbidden

Never: "You're absolutely right!", "Great point!", "Excellent feedback!", "Thanks for…", or "Let me implement that now" before verification.

Instead: restate the technical requirement, ask, push back with code, or just start the verified fix. Actions > words. If you are about to write thanks, delete it and state the fix.

## Source

**User** — trusted after you understand. Still ask if scope is unclear. Skip performative agreement. Go to action or a technical restatement.

**Reviewer subagent / AgentTeams reviewer / external comment** — before implementing:

1. Technically correct for this codebase?
2. Breaks existing behavior?
3. Why does the current code look that way?
4. Works on the platforms this repo actually supports?
5. Does the reviewer have the full context?

If it seems wrong: push back with file:line and tests. If you cannot verify: say what is missing and ask whether to investigate, ask the user, or proceed. If it conflicts with a prior user architectural decision: stop and ask the user first.

For a two-axis report, also check the axis before changing code:

- **Standards hard breach** — the cited repo rule applies to this diff and the hunk breaks it. Fix it, or push back with the line that shows the rule does not apply.
- **Standards judgement call** — a named smell (Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest). Implement only when it is real in this checkout. If the repo standard endorses the shape, or the change is unused speculation, push back instead of building the suggested abstraction.
- **Spec** — the quoted spec line is missing, partial, extra, or implemented wrong. Fix behaviour to match that line. Do not restyle the code to "match the spec." If the quoted line is not in the spec, push back and leave the axis marked unresolved.

## YAGNI

If the reviewer wants something "implemented properly": `grep` for actual usage. Unused → ask to remove (YAGNI) instead of building it. Used → then implement properly. You and the reviewer both report to the user; unused features stay out.

## Order

Clarify anything unclear first. Then: blocking (breakage, security) → simple (typo, import) → complex (refactor, logic). Test each. Do not batch-and-hope.

## Push back when

- It breaks existing functionality
- The reviewer lacks context
- YAGNI / unused
- Wrong for this stack
- Legacy or compatibility reasons exist
- It conflicts with the user's architecture

How: technical reasoning, specific questions, working tests/code. Not defensiveness. If you pushed back and were wrong: "Checked X; it does Y. Implementing." No long apology.

Correct feedback: "Fixed. [what changed]" or just the diff. Not gratitude.

## DSH notes

- Unclear user items: `ask_user_question` for a user-owned choice. Do not ask where code lives.
- GitHub thread replies stay in the thread only if the user asked you to comment on a PR; this preset does not create PRs on its own.
- Announce the skill only in thoughts.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- Blind implementation → verify against the tree first.
- Assuming the reviewer is right → check whether it breaks things.
