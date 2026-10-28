# Closed problems

Read this when the route in `SKILL.md` says **solve**: a closed answer, a homework or contest solution, a check of someone else's solution, or a proof of a closed statement. An open statement, a formalization, or a new concept is `methods.md` sections 10 and 13–15. A mechanism for a design question is `activate.md`.

Done when the answer passed two independent checks, or you refused a final answer because the checks failed or the problem is open.

## Classify

Pick one class and the matching second check before deriving:

| Class | Second check (domain check is always the first) |
|---|---|
| calculation, simplify | substitute a value, or recompute by another order |
| equation, system, ODE | substitute into every original condition |
| inequality, optimization | test a point inside and a point outside; check endpoints |
| function, limit, sequence | a special value or a one-sided limit |
| geometry, counting, probability | an independent count, or a degenerate case |
| derivative, integral, linear algebra | differentiate back, multiply back, or `Av - λv` |
| check-a-solution | the user's steps, not a fresh yes/no |
| contest | a second mechanism, not a second coefficient |

Missing data that changes the answer: ask, and do not guess a domain. Contradictory data: stop and name the contradiction. Several well-posed readings: solve each and label them. "Is this correct?" continues from the last valid step and names the first false one.

## Parse

Write known conditions, the goal, variables, parameters, and units. Then write implicit constraints: denominator nonzero, even root nonnegative, log argument positive and base positive and not 1, trig ranges, probability in `[0, 1]`, matrix shapes that multiply. Judge whether the conditions determine a unique answer, a family, none, or a case split. Predict extraneous roots before a non-equivalent step (squaring, multiplying by an expression, a substitution that is not bijective).

## Derive

One primary method and one fallback that changes the mechanism (Taylor versus repeated L'Hôpital, substitution versus elimination, direct proof versus a counterexample search). Prefer an exact method when the question asks for an exact answer.

Each risky step names why it is allowed:

- Division: the divisor is not zero; the zero case is its own case.
- Squaring or a reciprocal: extraneous roots are expected; every candidate returns to the original.
- Inequality times a variable expression: split on the sign. A negative multiplier reverses the sign.
- Square root: `√(x²) = |x|`. Both signs when solving `a² = b`.
- Log or exponential: domain first. Log inequalities flip when the base is in `(0, 1)`.
- Theorem: every hypothesis is checked in this problem, not assumed from the name.
- Limit, sum, or integral interchange: the domination or uniform-convergence hypothesis is named.
- Quantifiers: `∀ε ∃δ` is not `∃δ ∀ε`.

Domain guards, not a catalog to recite:

- Algebra: expand after factoring; excluded values listed before clearing denominators; `(a+b)²` keeps the cross term; `√(a+b)` does not split.
- Inequality: equality case of AM-GM, Cauchy, or Hölder is attainable or the inequality is strict. Endpoints say closed or open.
- Functions: domain before range. A critical point is a candidate until a sign change, a second-derivative test, or a boundary comparison. Non-differentiable points are candidates.
- Geometry: a figure is not a proof. Name the congruence or similarity criterion. Law of sines can give two triangles.
- Probability: sample space first; with versus without replacement; probabilities sum to 1; a negative variance is an arithmetic error.
- Calculus: L'Hôpital only for `0/0` or `∞/∞`. Taylor states the remainder order. Indefinite integrals carry `+ C`. An improper integral is a limit, not a plug-in of infinity.
- Linear algebra: shapes before the product. Diagonalizable means a basis of eigenvectors. `Ax = b` compares rank of `A` with rank of the augmented matrix.
- Abstract: a definition holds completely. A construction does not depend on an arbitrary choice unless that independence is shown. Hausdorff, completeness, compactness, and finite dimension are hypotheses, not decoration.

Finite numeric arithmetic goes through `calculator`. It accepts scientific-notation literals and degree trig (`sind`, `cosd`, `tand`). IEEE 754 finite numbers only (no NaN/Infinity). Do not answer by mental arithmetic, and do not use bash or pwsh arithmetic as the default. Symbolic steps use SymPy; number theory uses PARI/GP; simulation uses SciPy, NumPy, or JAX; a formal proof uses Lean4. Satisfiability of a formula over a theory uses Z3, the SMT solver (Satisfiability Modulo Theories): read `path.z3` from `helpers/doctor.py` and follow `invoke`. A `sat` model is a witness for that formula, not a closed form. Run `helpers/doctor.py` before those engines. A missing engine is a fact. `calculator` is not a symbolic engine and not a formal-proof tool.

## Check

Apply two methods that do not repeat the same algebra. Domain check always counts as one.

| Method | Use it to |
|---|---|
| Back-substitution | plug the candidate into every original condition |
| Domain | reject candidates outside the constraints written at parse |
| Boundary | inside versus outside an interval; interior critical points versus endpoints |
| Reverse | differentiate an antiderivative, or expand a factorization |
| Sample | one concrete value, computed with `calculator` or SymPy, not by head |
| Dimensions | a formula with units is homogeneous |
| Special case | `n = 1`, a zero parameter, a known limit |
| Independent method | the fallback mechanism |
| Counterexample | a universal claim; one object kills that claim only |
| Logic | quantifier order, undefined steps, hypotheses not used |
| Invariant | trace, determinant, probability sum, energy, Vieta |

A failed check is not a final answer. Return to the last step that passed, name the error (algebra, sign, domain, lost case, theorem hypothesis), repair, and run the failed check plus one method not used yet. After two failed repairs, say the result is unverified and do not offer the candidate as the answer. Do not invent a cosmetic error to keep the same value. A proof of a closed statement with no numbers still needs two checks: a logic check, plus a special case or a counterexample search.

## Hard or possibly open

Classify before searching: standard exercise, contest, known theorem, known open problem, or missing conditions. Search when a named theorem's hypotheses are uncertain, the problem may be a known contest or an open problem, or the user asked for a source. Do not search a routine curriculum exercise whose result you can check yourself.

Use a primary source (textbook, official contest solution, peer-reviewed statement). Forum text and model memory are not citations. If sources disagree, say so. Re-derive; do not paste the write-up. If nothing similar exists, special cases, a counterexample attempt, a lemma split, and an equivalent restatement are the next moves. Record dead ends as counterexample, missing lemma, estimate failure, timeout, or unresolved — timeout is not a disproof.

Known open problems (Riemann hypothesis, Goldbach, Collatz, P versus NP, and equivalents) stay open. Partial results are labeled proved, numeric evidence, or conjecture. Do not fabricate a theorem, a page number, or a paper.

## Deliver

Match the user's length. A one-line calculation returns the value, the domain if it is not all reals, and the two checks in one sentence. A full solution uses analysis, method, derivation, checks, and the answer. Exact form over a decimal unless a decimal was requested. The answer restates every restriction the derivation used.
