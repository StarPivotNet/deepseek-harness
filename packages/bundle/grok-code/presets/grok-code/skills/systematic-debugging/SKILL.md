---
name: systematic-debugging
description: Use when encountering any bug, test failure, unexpected behavior, build failure, or "just try this fix" — 系统调试, root cause first, no symptom patches. Do not use for a greenfield feature with no failing behavior.
---

# Systematic debugging

Six headings, tools over guesses, no pep talk.

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If Phase 1 is not done, you cannot propose a production fix.

## When

Any technical surprise: test failure, production bug, unexpected behavior, performance, build, integration. Especially under time pressure, after a failed "quick fix", or when you do not understand the issue.

Do not skip because it "looks simple" or "the user wants it NOW". Systematic is faster than thrashing.

## Phase 1 — Root cause (before any fix)

1. **Read the error.** Full stack, line, code, path. Do not skip warnings.
2. **Reproduce.** Exact steps. If it is not reproducible, gather data — do not guess.
3. **Recent changes.** Diff, last commits, new deps, config, environment.
4. **Multi-component:** log what enters and leaves each boundary, run once, then investigate the failing layer. Do not spray fixes across layers.
5. **Trace backward** when the error is deep: who passed the bad value, keep walking up, fix at the source. Use `codegraph_explore` for who calls this symbol or what a change would hit (`codegraph_status` first; `codegraph_init` once if the project is not initialized; `codegraph_sync` after you edit the fix). A literal in the stack (a string, a path, a config key) stays `grep` / `file_read`. Do not call `codegraph_reindex` or `codegraph_callers` unless that name is in this session's tool list, and do not write `codegraph.json`. If codegraph says the project is not indexed and you did not init, trace with `grep` / `file_read`.

In thoughts: Goal = the failure; Kills = killed causes; Live = one cause, not a menu.

Do not upgrade a suspicion into a root cause.

## Phase 2 — Pattern

Find a similar working path in this repo. Compare against the broken one. If you are implementing a known pattern, read a reference implementation first.

## Phase 3 — One hypothesis

State: "X is the root cause because Y". Change **one** variable. If it fails, form a new hypothesis — do not stack fixes.

If you do not understand X, say so in thoughts and gather more evidence. Do not pretend.

## Phase 4 — Fix

1. Prefer a failing reproduction (automated test if the repo already tests this area; otherwise the smallest command that shows the bug). Then fix at the source.
2. One change at the source. No "while I'm here".
3. Verify with persona `<validating>` before claiming fixed. Do not call `skill` for that gate.
4. If the fix fails: back to Phase 1. After **three** failed fixes, stop and question the architecture with the user — do not attempt fix #4 by stacking patches.

## Condition-based waiting

Do not stabilize tests with `sleep` / `Start-Sleep` / `setTimeout` guesses. Wait until the condition is true (file exists, port listens, output contains X), with a bounded timeout. Arbitrary delays only when you are testing timing itself, and then say why.

## Don't

- Propose a production fix before Phase 1 names a root cause.
- Stack a second change while the first hypothesis is still untested.
- Stabilize tests with `sleep` / `Start-Sleep` / `setTimeout` guesses.
- Attempt fix #4 by stacking patches after three failed fixes.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- "Change X and see" → not a hypothesis test if you then keep the change.
- "Error is in this catch, so fix the catch" → trace who passed the bad value.
