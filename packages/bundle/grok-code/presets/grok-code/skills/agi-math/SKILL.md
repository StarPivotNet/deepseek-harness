---
name: agi-math
description: Use for any mathematical work — proofs, counterexamples, computation, homework, contest problems, solution checking, modeling, formalization, open research, papers/notes, inventing concepts, tools, or working frameworks, and turning a research or design question into a mathematical construction. Do not use for non-math coding, implementation-only debugging, RPK, or ordinary app features.
---

# agi-math

Classify the job, then open only that branch. A closed answer uses existing terms. It does not invent a concept, staff a resident, or walk the research pipeline.

Short homework may skip `session-cognition`, `agi-loop`, and `todo_write`. Long research loads both. Multi-file research uses `agent-teams`; a read-only check uses `subagent`. Before finishing, follow persona `<validating>`. Do not call `skill` for that gate.

## Route

One job. Mixed work takes the branch that decides the answer.

| Job | The user wants | Then read |
|---|---|---|
| solve | A closed answer: compute, simplify, solve, homework, contest, a check of a solution, or a proof of a closed statement | `solve.md` only |
| research | An open statement, a formalization, a paper, or a new concept the old language cannot state | `methods.md` sections 10 and 13–15, not the whole file |
| activate | A mathematical mechanism (an operator, a guarantee, a reduction, a structural alternative), not a number and not an app feature | `activate.md` only |

Pure implementation (imports, shapes, refactors, tuning, ordinary code review) is not a math job. Do not open `activate.md` for it.

A closed answer, including a proof of a closed statement, is finished only after two independent checks in `solve.md`. An open statement may report what was checked and what stays open. Do not present a candidate that failed its check as the answer.

Shared, before the branch file: restate objects, quantifiers, hypotheses, domain, and the goal. Write implicit constraints (denominator, radicand, log argument, matrix shape, probability in `[0, 1]`) before manipulating. If a named theorem's hypotheses are uncertain, search a primary source. Do not invent the statement or paste an external solution.

## Toolchain

Run `python <skill_base>/helpers/doctor.py` before SymPy, PARI/GP, SciPy, NumPy, JAX, Lean4, or Z3. A missing engine is a fact, not a test failure and not a mathematical disproof. Do not pretend you ran it. doctor probes `gp`/`pari` for `supports_c` / `supports_stdin_f` / `invoke`. Windows `gp.exe -c` prints Usage and **exit 0**: do not treat exit 0 as `-c` being available.

```
python <skill_base>/helpers/doctor.py
```

| Task | Priority order |
|---|---|
| Formal proof (Navier–Stokes / prime-gap formalization prefers Lean4) | Lean4 |
| Symbolic computation | SymPy |
| SMT (Satisfiability Modulo Theories) | Z3, an SMT solver. Read doctor's `path.z3`: `category` is SMT, `invoke` feeds SMT-LIB (`z3.exe -in` or an `.smt2` file), and `python.before_import` is how `import z3` finds `libz3.dll`. `sat`, `unsat`, or `unknown` is a solver answer, not a CAS simplification and not a Lean proof. |
| Number theory specialized | PARI/GP. Windows / pwsh must invoke `gp.exe` (bare `gp` is `Get-ItemProperty`). First read doctor's `supports_c`: this machine's Windows build has no `-c` (Usage + exit 0); write the script to a `.gp` file or feed it via stdin to `gp.exe -q -f`. On UNIX, `gp -q -c` is available. doctor.py already prefers which `gp.exe`. |
| Finite numeric arithmetic (+ - * / % **, parentheses, abs/ceil/floor/round/max/min/sqrt/pow/log/ln/log2/log10/exp/sin/cos/tan and inverse/hyperbolic, hypot/cbrt/sign/trunc, PI/E/TAU, sind/cosd/tand and other degree trig, scientific-notation literals) | calculator; if missing from the catalog, Python. IEEE 754 finite numbers only (no NaN/Infinity). Supports scientific notation. Do not give numeric answers by mental arithmetic. Do not use bash `$(( ))` / pwsh arithmetic as the default. Must not be treated as a symbolic or formal-proof tool |
| Numerical simulation / functional optimization (PDE, variational profiles) | SciPy, NumPy, JAX |

Figures only with matplotlib. Do not bake Mathlib into grok-agi.

Finite numeric arithmetic uses `calculator` (Python only if that tool is missing). IEEE 754 finite numbers only (no NaN/Infinity). Supports scientific-notation literals and degree trig (`sind` / `cosd` / `tand`).

## When

Proofs, counterexamples, computation, homework, contest problems, solution checking, modeling, formalization, open research, papers, new concepts, or a mathematical construction behind a research or design question.

Do not use for non-math feature development, implementation-only debugging, RPK, or ordinary websites.

## Don't

- Announce a result before the branch's check.
- Use this-turn command evidence as a mathematical proof. `verified: true` only after the checker actually ran on that statement. Checker not run means `verified: null`.
- Call bare `gp` on Windows / pwsh, or treat `gp.exe -c` Usage + exit 0 as `-c` working.
- Open `activate.md` for implementation-only work, or treat the words attack, hash, or certificate as a cryptography job.
- Present a closed answer after its check failed, or paste a searched write-up in place of a re-derivation.

## Concept audit

Research jobs only. Open `methods.md` section 10 and use that value bar. A closed answer does not coin a term. Done when the closed answer uses existing words, or the research note has a complete definition, one positive example, and one non-example.

## Long-research verification

Research jobs only, and only for an open statement, a numeric certificate, or a formalization. Open `methods.md` section 13 and apply that section. Family kill is not a disproof. A conditional theorem that passes a checker verifies only the conditional statement.

## Kills

- Using this-turn command evidence in place of a mathematical-proof conclusion
- Claiming `verified: true` when the checker was not run, or marking the unconditional reading of a conditional theorem as proved
- Fine-tuning weights or treating Lean / Isabelle as a reward-training environment
- Forcing a new concept or a resident on a closed answer
- Presenting a closed answer after verification failed, or inventing a cosmetic error to keep the same wrong value
- Copying a searched solution instead of re-deriving it
- Treating `activate.md` as a lens catalog or a second skill
- Routing by keyword count into cryptography, or using an AI operator pattern as a security reduction
- Invoking bare `gp` in Windows / pwsh; treating Usage + exit 0 of `gp.exe -c` as `-c` being available
- Treating a Z3 `sat`, `unsat`, or `unknown` answer as a Lean proof or a closed-form simplification
