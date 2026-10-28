# agi-math method index

Read this index first; load only the sections you need (one or two, at most three). Before starting, consult here; if it hits, cite it; if not, then invent.

Experience entries must not be treated as theorems. Trusted assertions may only chain to independently checked statements.

## Index

1. Analysis and inequalities
2. Linear algebra
3. Number theory
4. Combinatorics and graph theory
5. Probability and statistics
6. ODE / PDE
7. Applied-modeling decision tree
8. Dimensions / verification / sensitivity / provenance
9. Papers (write after solving; not limited to contests)
10. Concept invention and method-card template
11. Inference enhancement and the tool closed loop
12. Local engine routing
13. Long research: certificates, family kill, conditional formalization
14. Long research: derive directions from objects (not an inspiration menu)
15. Proof engineering: lemma graphs, calc, counterexample walls, open statements
16. Closed problems: parse, two checks, error guards (`solve.md`)
17. Mechanism construction: domain, transfer, knowledge gap (`activate.md`)
---

## 1. Analysis and inequalities

- First write the domain, smoothness, and whether compactness/convexity is needed
- AM-GM, Cauchy, Hölder, Young: check equality cases; avoid unconditional loosening
- Limits/series: try a closed form first, then asymptotics; exchanging limits and integrals needs a dominating control
- Failure often comes from dropping phase or sign information; a coarse bound is not a disproof

## 2. Linear algebra

- First fix the field (real/complex) and whether the inner product is standard
- Spectrum, rank, kernel, and invariants are written separately; similarity does not preserve every norm
- Before computing eigenvalues, look at the trace, determinant, and characteristic-polynomial coefficient constraints
- Generalized eigenvalues on an ill-conditioned Gram must not be treated as existence; if an undersampled spectrum drifts with the grid, mark unresolved

## 3. Number theory

- Modular arithmetic, valuations, generating functions, sieves: find invariants first
- Constructive existence vs counting; counterexamples before exhaustive search
- Do not treat a numeric-search timeout as a non-existence proof
- Failure of a test-function family only kills that family; grid sign-change marks unresolved; see section 13

## 4. Combinatorics and graph theory

- Double counting, invariants, extremal constructions; the induction base must be explicit
- Graph theory: connectivity, coloring, and matching are separate; do not mix "almost regular"

## 5. Probability and statistics

- Probability space, measurability, and whether independence is actually used
- Expectation/variance bounds vs almost surely; write seed and sample into provenance
- Statistical conclusions must have a control: a null model or a permutation

## 6. ODE / PDE

- Well-posedness conditions, existence/uniqueness, energy/maximum principle
- Stability and conservation of the numeric scheme; grid convergence is not a proof

## 7. Applied-modeling decision tree

Pick the main model by problem type; do not stack neural nets first.

| Type | Try first | Check |
|---|---|---|
| Evaluation/ranking | AHP, TOPSIS, entropy weights | Whether ranks stay stable after weight perturbation |
| Optimization | Linear/integer programming, dynamic programming | Duality gap, constraint violation |
| Forecasting | Mechanism + regression; time series only then ARIMA/state space | Time split; do not leak the future |
| Mechanism | Conservation laws, ODE/PDE, dimensions | Dimensional homogeneity, boundary behavior |
| Decision | Games, queues, inventory | Whether the same strategy still holds in extreme scenarios |

Sensitivity (experience, not a theorem):

- One-at-a-time (OAT): hold the rest fixed; vary the target parameter ±10% / ±20% / ±30%
- Tornado chart: each parameter ±20%, ranked by impact
- Scenarios: optimistic / baseline / pessimistic
- Relative sensitivity S(y,x) ≈ (Δy/y) / (Δx/x)
- Optimization models: check whether the strategy stays the same scheme under reasonable perturbation

## 8. Dimensions / verification / sensitivity / provenance

- Write a dimension for every derived quantity; name dimensionless combinations separately
- Independent recalculation: divergence > 30% → FAIL; 10%–30% → SUSPECT; otherwise PASS
- Run sensitivity on key parameters before a numeric conclusion
- provenance: engine version, seed, tolerance, and paths of data files or proof scripts
- Fix `np.random.seed(42)` only for random code
- Figures only with matplotlib; axes, units, and legend complete

Failure classes: counterexample / missing lemma / estimate failure / timeout / unresolved grid. Timeout and unresolved are not mathematical disproofs. Family kill is not proposition disproof.

## 9. Papers (write after solving; not limited to contests)

The same 0–7 pipeline: solve/invent first; write the paper only after solving. A paper is not contest-only delivery. When the user wants to compete, the delivery happens to be: hypothesis list, model, algorithm, figures, sensitivity, paper structure.

Do not treat a contest-only directory as the default output for every math problem. Do not open a separate Phase state machine. Do not write the paper first and backfill the solve.

Paper discipline (experience):

- Problem restatement and hypotheses are separate; hypotheses are testable
- Figures before long adjectives; each figure answers one question
- Result tables include units, controls, and sensitivity
- Numerics not independently checked are marked trial calculations
- New concepts enter the body only after being written into a method card; do not shout "paradigm" emptily

## 10. Concept invention and method-card template

Use this section when existing concepts cannot describe the phenomenon. New notation (pure abbreviation) is not an invention.

Method-card fields:

```
# Method | <name>
- Type: theoretical system | working framework | tool | method | idea | technique
- Status: experience candidate | already worked on this problem | contains independently checked assertions
- Complete definition: …
- Motivation (where the old language stuck): …
- Positive example: …
- Counterexample or non-example: …
- What it makes stateable: …
- Trusted assertions: only independently checked statements
- Application record: …
```

Promotion rule: already worked on at least one problem, complete definition, unproved assertions not marked true. Do not shout "paradigm" emptily.

Concept audit, research jobs only. Closed answers do not coin terms.

| Ask | Write |
|---|---|
| Existing language | Objects, relations, invariants, and the background theory this problem uses |
| Overflow | The phenomenon that can only be described by metaphor, a special case, or a numerical fudge |
| Candidates | A complete definition. No quotation standing in for the definition |
| Discriminant | One positive example and one non-example, plus the sentence the old language cannot state |
| Layering | Experience candidate, already worked on this problem, independently checked assertion, or working framework |

Value bar: new notation is an abbreviation, not an invention. A working concept or a working framework has a complete definition and stays an experience candidate until an assertion is independently checked. A new tool is a repeatable procedure with an application record. The word paradigm is allowed only when the old framework cannot state a class of phenomena and the new one gives a testable prediction or a discriminant example. Otherwise write working framework. A conclusion from a new concept is written "if that definition holds, then …".

## 11. Inference enhancement and the tool closed loop

Do not change model weights. Do not write SFT / PRM / DPO / RL / GRPO into this skill. Do not treat Lean / Isabelle as a reward-training environment.

- Derive step by step, write estimates explicitly, do not skip steps
- Long-research multi-path (Best-of-N): generate independently, score with tool checks, then choose; far-apart paths must change different mechanisms, see section 13; how directions are generated from objects, see section 14
- Tool closed loop: write a conjecture → calculator (finite numbers) or Python / SymPy / Lean check, or Z3 when the conjecture is an SMT query → write errors back; numeric answers forbid mental arithmetic; short homework that is a pure proof (no numbers) may skip
- Split complex proofs into a sublemma dependency graph; cut branches falsified by tools
- Failure log: record falsified constructions; later work avoids the same class of error
- Search only cites `methods.md`, already distilled method cards, user-specified literature, and this problem's repository; search hits default to reference and must not be treated as theorems. Do not download Mathlib / AFP / miniF2F into the skill or workspace as distillation corpus or a theorem library
- Do not skip the concept audit because you "cannot create a new paradigm"

## 12. Local engine routing

Before starting, run `helpers/doctor.py`. A missing engine is a fact, not a test failure and not a mathematical disproof. Pick engines by task; if missing, degrade; do not pretend you ran them. doctor probes `gp`/`pari` for `supports_c` / `supports_stdin_f` / `invoke`. Windows `gp.exe -c` prints Usage and exit 0: do not treat exit 0 as `-c` being available.

| Task | Priority order |
|---|---|
| Formal proof (Navier–Stokes / prime-gap formalization prefers Lean4) | Lean4 |
| Symbolic computation | SymPy |
| SMT (Satisfiability Modulo Theories) | Z3, an SMT solver. Read doctor's `path.z3`: `category` is SMT, `invoke` feeds SMT-LIB (`z3.exe -in` or an `.smt2` file), and `python.before_import` is how `import z3` finds `libz3.dll`. `sat`, `unsat`, or `unknown` is a solver answer, not a CAS simplification and not a Lean proof. |
| Number theory specialized | PARI/GP. Windows / pwsh must invoke `gp.exe` (bare `gp` is `Get-ItemProperty`). First read doctor's `supports_c`: this machine's Windows build has no `-c` (Usage + exit 0); write the script to a `.gp` file or feed it via stdin to `gp.exe -q -f`. On UNIX, `gp -q -c` is available. doctor.py already prefers which `gp.exe`.
| Finite numeric arithmetic (+ - * / % **, parentheses, abs/ceil/floor/round/max/min/sqrt/pow/log/ln/log2/log10/exp/sin/cos/tan and inverse/hyperbolic, hypot/cbrt/sign/trunc, PI/E/TAU, sind/cosd/tand and other degree trig, scientific-notation literals) | calculator; if missing from the catalog, Python. IEEE 754 finite numbers only (no NaN/Infinity). Supports scientific notation. Do not give numeric answers by mental arithmetic. Do not use bash `$(( ))` / pwsh arithmetic as the default. Must not be treated as a symbolic or formal-proof tool |
| Numerical simulation / functional optimization (PDE, variational profiles) | SciPy, NumPy, JAX |

Figures only with matplotlib. Do not bake Mathlib into grok-agi.

## 13. Long research: certificates, family kill, conditional formalization

This section is the rule body for long-research verification. `SKILL.md` only points here. The cards below are the procedures. They are not theorems. Only independently checked sentences enter "Trusted assertions". Positive examples come from sieve-variational and conditional-formalization work; do not treat them as library theorems.

Research pipeline, open statements and formalization only. A proof of a closed statement stays in `solve.md` and still needs two independent checks.

| Step | Do |
|---|---|
| Restate | Objects, quantifiers, hypotheses, goal |
| Probe | Examples, boundaries, dimensions. Run `helpers/doctor.py` before a numeric engine |
| Concept audit | Section 10. Existing language if it suffices |
| Orient | At least two directions that change a mechanism. Section 14. Not a new name for the same constraint |
| Solve | Hypotheses explicit. One rewrite per calculation step. Section 15 |
| Verify | An independent check. Family kill is not a disproof. A sign-changing grid is unresolved |
| Formalize | Only if the user asked or `lean` is on PATH. New definitions before large theorems. Otherwise `verified: null` |
| Deliver | The form the user asked for, after the solve. A paper is not written first |

Residents only for long research that crosses turns. The main session reports and is not a witness. A clear opposing check is a veto. A new definition needs its own check.

Formalization defaults off. Record the local `lake` or `lean` command, not a subagent reading a remote repository. List every axiom, sorry, and hypothesis still open, at the endpoint. A paper-score fraction check, a rerun of an integral certificate, an external numeric package, and the local checker do not substitute for each other. Lean and Isabelle accept or reject a statement already written. They do not search for a strategy. Do not download Mathlib, AFP, or miniF2F into this skill or the workspace.

Verification layering, in order as they apply: another algebra or another proof; an inequality skeleton before the estimate; a boundary or a counterexample; whether each lemma is used in the final statement; exact rationals for linear inequalities; one finer grid, kept only if the sign does not change; for an applied number, an independent recalculation (divergence above 30% is fail, 10% to 30% is suspect). Section 8 states the numeric thresholds. Section 15 states the proof steps.

Research kills: an experience candidate treated as a theorem; a family kill, a timeout, an ill-conditioned spectrum, or undersampling written as non-existence; a sign-changing grid marked as a crossing; a ratio carry when the family is far from the threshold; spoken numbers that mix a raw cap with a value after losses; a coefficient change on a killed mechanism called a second path; an inspiration menu, or Galois, schemes, or Riemann surfaces, used as the next executable step; PDE or sieve jargon as the default direction of every problem; a contest-only directory as the path for every math problem; a short checker pass called a new theory.

# Method | Pin spoken numbers to definitions
- Type: method
- Status: already worked on this problem
- Complete definition: When citing a target quantity, write the formula, lower/upper bound, and whether loss terms have already been deducted. A raw cap, a quotient after subtracting losses, and a heuristic extrapolation must not share one name.
- Motivation (where the old language stuck): The same letter Q in speech meant both 1.000206 and 1.00002336, and downstream η drifted with it.
- Positive example: Q = ρ*(J_λ,H − L+)/I_H; spoken crossing uses the quotient after subtracting losses.
- Counterexample or non-example: Calling the lecture-note cap quotient 1.00027669 Lean-discharged.
- What it makes stateable: A crossing claim can be matched to one formula.
- Trusted assertions: Only when this turn matches that formula with Fraction or Lean.
- Application record: sieve-variational certificates; any ratio with a cap / loss term.

# Method | Exact layer vs floating-point layer
- Type: tool
- Status: already worked on this problem
- Complete definition: Linear inequalities and rational points go through Fraction / Rational / Lean rationals; simplex upper bounds k/(k−1) log k, CS, FFT may use float ln, and the output declares the layer. bash / pwsh arithmetic must not count as a rational proof.
- Motivation (where the old language stuck): Treating a float margin 6.52e-5 as a rational identity.
- Positive example: Substitute a rational point into incidence / Type III walls; write the margin as a fraction.
- Counterexample or non-example: Reporting "crossing 1e-8" by mental arithmetic or shell arithmetic.
- What it makes stateable: Which step is an identity and which step is a numeric estimate.
- Trusted assertions: The rational layer may be pushed forward as fact only when this turn's Fraction matches.
- Application record: certificate walls, Harman parameter points, certified cap μ− − L̄.

# Method | Family kill vs proposition disproof
- Type: method
- Status: already worked on this problem
- Complete definition: After fixing support, radial profile, mask, and test-function family, a target quantity below the crossing threshold → kills that family. The proposition stays open unless it is proved that the family exhausts all feasible constructions. Timeout, ill-conditioned Gram, undersampling ≠ non-existence.
- Motivation (where the old language stuck): Unmasked angular Q_vec<1 was said to be DHL[k,2] failing.
- Positive example: Unmasked angular has Q<1 on two walls, KILL that family; the certified profile may still cross.
- Counterexample or non-example: Marking KILL on the proposition because a Lorentz constant term falls with n.
- What it makes stateable: Failure logs write "which family, which hypothesis", not "the theorem is false".
- Trusted assertions: Only that family's numeric conclusion under the stated hypotheses, and only if the grid is resolved.
- Application record: sieve-variational Best-of-N; general test-function search.

# Method | UNRESOLVED_GRID
- Type: technique
- Status: already worked on this problem
- Complete definition: If a discretization changes sign with resolution, or the absolute value monotonically recedes from the target under refinement → mark UNRESOLVED_GRID; neither CROSS nor KILL. When the grid has too few points to resolve a fast pole, a crossing ratio / generalized eigenvalue on that grid must not be treated as existence.
- Motivation (where the old language stuck): A Lorentz FFT ratio that changed sign with n was written as CROSS.
- Positive example: At n=256 a fast pole spans 1.35 cells, Q falls as n grows; discard that grid's constant term.
- Counterexample or non-example: Only after one refinement keeps sign and monotonicity stable may that family's conclusion be marked.
- What it makes stateable: A third class of numeric failure = unresolved, between counterexample and timeout.
- Trusted assertions: None until the grid is stable.
- Application record: convolution / FFT profiles; ill-conditioned generalized eigenvalues.

# Method | Ratio-heuristic bar
- Type: technique
- Status: already worked on this problem
- Complete definition: pred = Q_ref * (M_k / M_ref) is a carry heuristic only when that family's own Q is already near the crossing threshold. When it is far from 1, a pretty ratio still does not cross. Allowed extrapolated drop must come from the same family and the same geometry; do not transplant family A's drop onto family B's radius as a proof.
- Motivation (where the old language stuck): Extrapolating the certificate family with the unmasked-angular 0.3568% drop, written as pred Q≈1.002.
- Positive example: Discuss whether M39/M40 eats the 2.336e-5 margin only when the certificate point itself has Q40>1.
- Counterexample or non-example: A product-exp family with own Q=0.63 does not carry no matter how pretty the ratio.
- What it makes stateable: The boundary between heuristic and proof.
- Trusted assertions: The heuristic itself is not a trusted assertion.
- Application record: dimension drop, radius rewrite.

# Method | Did the wall actually move
- Type: method
- Status: already worked on this problem
- Complete definition: A parameter point lying inside a new inequality ≠ being able to lift the old feasible wall to the deadline. First compute the maximal feasible region the new wall gives at the old parameters held fixed. If an old ladder fails at the new ω because it falls outside that ladder's known range of validity, record an expected failure, not a surprise discovery.
- Motivation (where the old language stuck): The 186 point already in the incidence band was misread as being able to lift W to the CS deadline.
- Positive example: At fixed a*, incidence max W=0.5262, still below the target; lifting W must lift a at the same time.
- Counterexample or non-example: Rewriting 64ω as 62ω and treating it as the 182 mechanism.
- What it makes stateable: The true degrees of freedom of a local estimate wall.
- Trusted assertions: Only when both the rational-point substitution and the maximal feasible region are checked.
- Application record: Type I/II/III walls, Harman parameters.

# Method | Far-apart paths change mechanism
- Type: method
- Status: already worked on this problem
- Complete definition: Best-of-N far-apart = at least one class among: test functions; support and minorant (including masks); local estimate walls; coordinates and duality and main-term remainders; proposition splitting. Changing a coefficient on the same wall, or adding adjectives on an already-killed family, does not count as a second path. If every direction is a dead end, re-derive. How directions are generated from objects: see section 14.
- Motivation (where the old language stuck): Unmasked angular was already dead, yet the grid was still swept to look busy.
- Positive example: Path A changes the test function; path B changes the Type II/III wall or the certified profile.
- Counterexample or non-example: 64ω→62ω treated as a new path.
- What it makes stateable: When the sweep must stop and the mechanism must change.
- Trusted assertions: None (planning rule).
- Application record: open variational problems.

# Method | Conditional-formalization layering
- Type: tool
- Status: already worked on this problem
- Complete definition: Report a conditional theorem as "if P1,…,Pn then Q". If some P_i is undischarged, do not write Q as unconditional. Paper-score Fraction checks, rerunning integral certificates, fields of an external numeric package, a read-only remote repo, and local lake are five evidence layers and do not substitute for each other. `verified:` covers only the statement the local machine actually ran. Lean / Isabelle only check candidate statements already written; checker pass ≠ a new theory.
- Motivation (where the old language stuck): An external package claiming all 262 comparisons passed was said to be Lean premises discharged; type_iii_proved=false was ignored.
- Positive example: infinite_*_of_local_inputs is conditional DHL; Type III local Fourier remains a gap.
- Counterexample or non-example: A subagent reads GitHub and writes verified: true.
- What it makes stateable: Formalization progress is separate from the mathematical gap.
- Trusted assertions: Only the conditional statement the local checker matched.
- Application record: Lean developments with axiom/sorry; any formalization that depends on an external numeric package.

# Method | Lean is a checker, not a searcher
- Type: method
- Status: already worked on this problem
- Complete definition: Lean / Isabelle run the checker on candidate statements already written for this problem, and only accept or reject that statement. New lemmas, new decompositions, and new sieve theory go through the concept audit and the section 14 slots. This problem's `lakefile` may depend on Mathlib (compile-time library). Do not download Mathlib / AFP / miniF2F or other proof libraries into the skill directory, `methods.md`, or the workspace as distillation corpus. Do not treat the checker as an RL reward environment. Checker pass ≠ a new theory.
- Motivation (where the old language stuck): When the formal-search space explodes the model prefers short proofs; distilling a proof library into the skill turns conditional theorems into unconditional facts.
- Positive example: For infinite_*_of_local_inputs that passed local lake, report only the conditional statement.
- Counterexample or non-example: clone mathlib into skills/agi-math; use tactic search to pretend Type III local Fourier is proved.
- What it makes stateable: Formalization progress is separate from invention progress.
- Trusted assertions: Only the statement the local checker matched.
- Application record: conditional DHL formalization.

## 14. Long research: derive directions from objects (not an inspiration menu)

Far-apart directions are the cards in this section. The research pipeline is section 13. Checklist items are not theorems and not training data. A closed answer does not walk this checklist.

# Method | Derive directions from objects
- Type: method
- Status: already worked on this problem
- Complete definition: A direction = changing one class of mechanism on this problem's objects. First write the objects and the target quantity, then take at most one item from each of five slots to form a candidate: test functions; support and minorant (including masks); local estimate walls; coordinates and duality and main-term remainders; proposition splitting (conditional vs unconditional). Far-apart = at least one of the five slots changes. Concrete procedures are chosen only after a slot is selected; they must not be treated as the direction itself.
- Motivation (where the old language stuck): "At least two widely different directions" had no generator, so it was easy to pick from an adjective menu or refine the grid on an already-killed slot.
- Positive example: In sieve variational work, unmasked angular is already dead, so the second path must change the certified profile or the Type II/III wall, not sweep the same angular grid again.
- Counterexample or non-example: Pasting the whole table "multiscale constructions / Fourier transforms / energy methods" into the prompt as directions. Writing Galois groups, schemes, or Riemann surfaces as executable steps. Walking an eight-class inspiration checklist on short homework.
- What it makes stateable: Where a direction comes from, when it counts as far-apart, and when the sweep must stop.
- Trusted assertions: None (planning rule). Numeric conclusions of a given application are checked separately.
- Application record: open variational / conditional formalization; general long-research orientation.

# Method | Re-derive after failure
- Type: technique
- Status: already worked on this problem
- Complete definition: Classify the failure first (counterexample / missing lemma / estimate failure / timeout / unresolved grid), then decide which slot to move. Estimate failure → change the local estimate or the main-term remainder, do not refine the same test function. Unresolved grid → refine or change the discretization; do not mark CROSS/KILL. Timeout → not a disproof. Every slot already dead → concept audit (whether the existing language is not enough), not another inspiration table.
- Motivation (where the old language stuck): After a family kill, keep adding adjectives on the same slot.
- Positive example: A Lorentz grid sign-change is marked unresolved; the next step changes the discretization or abandons that family, and does not treat the sign-change as CROSS.
- Counterexample or non-example: After unmasked angular Q<1, sweep a denser angular grid.
- What it makes stateable: The map from a failure log to the next direction.
- Trusted assertions: None.
- Application record: Best-of-N failure logs.

## 15. Proof engineering: lemma graphs, calc, counterexample walls, open statements

Proof steps are the cards in this section. Formalization defaults and the verification layering are in section 13. The cards are procedures, not theorems. No contest statements, counterexample numerics, or tactic tables. Trusted assertions: none.

# Method | Lemma graph: statement / general lemma / specialization-assembly
- Type: method
- Status: already worked on this problem
- Complete definition: Split a complex proof into a DAG first. Three node classes that must not share names: (1) frozen statements (object + goal Type, no proof); (2) lemmas more general than this problem that others can use (prove first, may enter the library); (3) this-problem specialization and main-theorem assembly. Edges are dependencies. The main theorem only assembles; it does not invent a new decomposition at an assembly node. A searcher proof and a handwritten proof may be two backends of the same statement and must not change the statement node. Unfinished obligations are marked open and must not share a file with already-checked library theorems as a disguise.
- Motivation: Cramming a contest write-up, an open gap, and a general lemma into one proof so downstream cannot tell which sentence is proved.
- Positive example: First write a general descent engine (arbitrary claim/orbit/base), then specialize to this problem; `Statement` and the proof in separate files.
- Counterexample or non-example: Using a contest problem number as a library lemma name; using a tactic-search pass to pretend a new theory.
- What it makes stateable: Which step is invention and which step is checking.
- Trusted assertions: None.
- Application record: formalization developments; any multi-lemma proof.

# Method | Bound first, then exhaust
- Type: technique
- Status: already worked on this problem
- Complete definition: Rewrite "all solutions / the minimal solution" as a predicate first. Use an invariant weaker than the main goal to compress parameters into a finite interval `n < N`. Kill `n ≥ N` with a coarse estimate; for `n < N` normalize branch by branch or compare with a monotone function. The list ⇒ original-form direction is verified directly on its own, not mixed with ⇒. The main theorem only assembles. Automated arithmetic has a scale cap: on failure, write that branch by hand; do not treat a timeout as a disproof.
- Motivation: Brute-forcing the original form, or leaving "find all" in natural language.
- Positive example: First 2-adic counting gives `n(n-1)/2 < k`; large n is crushed by factorials; small n is done branch by branch.
- Counterexample or non-example: Treating some problem's iff list as a skill theorem.
- What it makes stateable: Which weak bound the finiteness of the exhaustion comes from.
- Trusted assertions: None.
- Application record: classification/minima; finite-parameter search.

# Method | Partition, two estimates, choose a scale
- Type: method
- Status: already worked on this problem
- Complete definition: For a qualitative conclusion (divergence/unboundedness), assume the contrary first, then immediately rewrite as a quantitative remainder (there exists a cutoff making the tail smaller than an additive constant). Split the whole set into two classes with different mechanisms; upper-bound each class separately; do not transplant class A's drop onto class B. Choose a scale so the sum of the two upper bounds is < |whole set|, hence |whole set|<|whole set|. What is killed is that contrary assumption, not some construction family.
- Motivation: Empty talk of "sufficiently large", or mixing two classes of estimate.
- Positive example: Assume convergence → tail < 1/2 → bound the smooth part and the exceptional part separately → choose a square scale so they add to less than the whole set.
- Counterexample or non-example: Memorizing a concrete exponent from some proof as a universal scale; treating that qualitative theorem as a skill fact.
- What it makes stateable: A quantitative certificate of the contrary assumption.
- Trusted assertions: None.
- Application record: divergence/unboundedness; contrary-assumption kill isomorphic to family kill.

# Method | Pointwise bound, then cyclic assembly
- Type: technique
- Status: already worked on this problem
- Complete definition: For cyclic sums/symmetric inequalities, first build an additive pointwise comparison function `f` such that `f+cyc` equals the target constant and each original term ≥ `f`. Pointwise: clear denominators → even-degree squares → complete the square into a sum of squares. Side conditions (denominators, roots, nonnegativity) are listed separately. Then cycle/sum to cancel intermediate quantities. Substitution lemmas and pointwise bounds are separate nodes; the main theorem drops the substitution last.
- Motivation: Attacking three-variable coupling directly, burying side conditions in the main chain.
- Positive example: First prove each term ≥ a simpler positive-term ratio, add three times, then cancel algebraically.
- Counterexample or non-example: Treating some contest inequality as a skill theorem.
- What it makes stateable: An additive certificate of a symmetric goal.
- Trusted assertions: None.
- Application record: symmetric inequalities.

# Method | Well-founded descent: claim / orbit / exceptional set
- Type: method
- Status: already worked on this problem
- Complete definition: Split two predicates: `claim` and orbit `H`; the original problem formula is not written into the descent engine. Obligation list: symmetry; boundary `H x 0`, `H x x` ⇒ claim; base ⇒ claim; descent step: if not on the base, a smaller point exists. After WLOG ordering, split on the diagonal. Exceptional set = orbit ∩ (base ∪ boundary ∪ degenerate). `suffices` the exceptional set is nonempty; if empty, take a well-founded minimum of the projected set, run the descent step to a smaller element, contradiction.
- Motivation: Writing a concrete quadratic form into "descent" as a universal lemma.
- Positive example: A general descent engine for arbitrary claim/H/base, then specialize.
- Counterexample or non-example: Treating some contest problem or some quadratic form as a skill lemma.
- What it makes stateable: Whether the descent obligations are all listed.
- Trusted assertions: None.
- Application record: integer-point orbits; infinite descent.

# Method | Linear unsatisfiability certificate
- Type: tool
- Status: already worked on this problem
- Complete definition: Linear comparison conjunction: negate the goal and move it into the hypotheses. Rewrite each as `t_i R_i 0`. Find natural numbers `k_i` such that `∑ k_i t_i = 0` and at least one strict `k_i>0`. After algebraically verifying the identity, the signs give `∑ k_i t_i < 0`, contradiction. Search for a certificate (LP/oracle) is separate from checking a certificate; an oracle pass does not count. ℕ→ℤ and turning rational division into multiplication may be preprocessed; nonlinear only gets finite hand preprocessing, then stop on failure. On a dense linear order this is a decision procedure; failure on ℤ/ℕ ≠ satisfiable.
- Motivation: Writing "run a linear-arithmetic tactic" as a method; or trusting a certificate searcher.
- Positive example: Write coefficients on paper or find k_i with Python LP; Lean only checks the certificate.
- Counterexample or non-example: Listing which lemmas some tactic can prove.
- What it makes stateable: A checkable certificate of a linear contradiction.
- Trusted assertions: After this turn verifies the certificate identity, only for that conjunction.
- Application record: linear-inequality conjunctions; aligning Lean=checker.

# Method | Same-shape skeleton, peel monotonicity
- Type: technique
- Status: already worked on this problem
- Complete definition: When both sides share a template `f(□, constants)`, first write the common pattern. Confirm monotonicity in each hole; prefer rules that vary fewer variables (weaker side conditions). Side conditions (multiplier ≥0, base >0) are listed separately from the main comparison; positivity recursion: squares, absolute values, two-branch ite. The main goal drops to a comparison on the holes; hypotheses/symmetry/reflexivity cancel first. Peel only layers that need aligning; peeling already-identical constants fabricates a false goal. When `P(e)` is known and the goal is `P(e')`, prove the difference; do not re-prove `P`.
- Motivation: Comparing two sides of different skeletons in one step; or treating a tactic lemma table as a theorem library.
- Positive example: `x^2*a+c ≤ x^2*b+d` matches pattern `x^2*?_ + ?_`, leaving `a≤b`, `c≤d`, with side condition `0≤x^2` placed aside.
- Counterexample or non-example: Copying a monotonicity lemma table into the skill.
- What it makes stateable: A legal comparison for a single calc step.
- Trusted assertions: None.
- Application record: inequality calc.

# Method | One calc step, one kind of rewrite
- Type: technique
- Status: already worked on this problem
- Complete definition: When the goal is a comparison and the two sides' head symbols/associativity are not fully aligned, do not compare the whole line at once. Write calc so each step is syntactically isomorphic left to right (same head, same arity). Isomorphic steps do monotone comparison; skeleton-changing steps only rewrite (rw/simp/ring normalization). Missing local facts get a have first. Numeric residuals close last. Analytic-chain order: triangle / reverse triangle → algebraic identity → numeric or monotone close.
- Motivation: Mixing a norm triangle and an algebraic rewrite in one step.
- Positive example: `‖z^2+c‖` first triangles to `‖z^2‖-‖c‖`, then monotone, then rewrite the factorization, then numeric.
- Counterexample or non-example: Comparing two sides whose skeletons do not match in one step.
- What it makes stateable: Which step is an axiom and which step is algebra.
- Trusted assertions: None.
- Application record: analytic estimates; p-adics; special-function pieces.

# Method | Relative-to-0 / same pattern / 0-comparison interchange
- Type: technique
- Status: already worked on this problem
- Complete definition: `0≤e`/`0<e`/`e≠0` go through positivity recursion (failure is failure; do not leave a comparison subgoal). Left and right the same pattern go through same-shape peeling. When a 0-comparison such as `0≤a*c-b*c` must interchange with a comparison, first make it a same-side comparison then multiply by a positive factor. `min`/`max`: safe rules have no guess (`a≤min b c` must be both sides); guessing rules (the disjunction of `a≤max`, the two monotone directions of powers) must first pin the base relative to 1; do not default `1≤a`. `n≤m` does not imply `a^n≤a^m`.
- Motivation: Using a positivity tool to prove `x≤y`; or defaulting the base ≥1.
- Positive example: First prove `1≤a` or `0≤a≤1`, then pick the power direction.
- Counterexample or non-example: Writing a power comparison directly from an exponent comparison.
- What it makes stateable: Which class of comparison tool to use.
- Trusted assertions: None.
- Application record: mixed inequality goals.

# Method | Counterexamples are first-class objects
- Type: method
- Status: already worked on this problem
- Complete definition: Write a naive universal as an independent predicate (may be parameterized). A counterexample is a constructed object, then prove `¬ NaiveClaim`; the object and the disproof theorem are named separately. What is killed is only this naive statement. A refined statement gets another name; do not mark the refinement dead or proved because the naive one is dead. Report by parameter slice: proved / disproved / unknown; unknown is not extrapolated from a disproved slice. Semi-counterexamples (only half the defining properties) are listed separately. Existence counterexamples may case-split on excluded middle. Extra axioms are written at the endpoint. A tighter unformalized bound is recorded only as "the bound this file implements".
- Motivation: Writing one counterexample as the death of the whole conjecture; or writing a tighter literature bound as already checked.
- Positive example: `ConjectureWith R n` → slices proved/disproved/unknown; the refined conjecture is stood up separately.
- Counterexample or non-example: Extrapolating an unknown slice from a disproved slice; writing a half-object as a full counterexample.
- What it makes stateable: The boundary between family kill and proposition truth value.
- Trusted assertions: None.
- Application record: aligning family kill ≠ proposition disproof.

# Method | Keep open statements separate from library theorems
- Type: tool
- Status: already worked on this problem
- Complete definition: Unproved propositions are marked open obligations; do not disguise them as library theorems with placeholder proofs, and do not write literature "already proved" as machine-proved. Definition/statement shapes may enter the main library; proof obligations go to a mirror location. Three labels must not mix: literature-proved but not formalized / still open / known only for some parameters. Literature-proved ≠ `verified: true`. Checker not run → `verified: null`. Contest write-ups/exhibition proofs are not library theorems; generally useful lemmas are general first, then specialized.
- Motivation: Writing an open problem or a literature history as already checked.
- Positive example: The series definition lives in the library; the equality proof obligation is placed elsewhere and says "does not yet contain a proof".
- Counterexample or non-example: Treating an open obligation as a community commitment that it is true.
- What it makes stateable: Formalization progress vs mathematical truth value.
- Trusted assertions: None.
- Application record: conditional formalization; the paper analogue of Wanted/Archive layering.

## 16. Closed problems

Homework, contest solutions, computation, and solution checking follow `solve.md`, not the research pipeline. Parse the domain before manipulating. A closed answer needs two independent checks; domain check is one of them. Finite numeric arithmetic uses `calculator` (scientific-notation literals, degree trig via `sind` / `cosd` / `tand`). A failed check is not a final answer. An open statement may still report an explicitly partial result. A proof of a closed statement is a solve job and needs two independent checks.

## 17. Mechanism construction

A research or design question whose deliverable is an operator, a guarantee, a reduction, or a structural alternative follows `activate.md`. Judge the domain by the object and the guarantee, not by keyword count. Do not treat this index as an anchor library or a design-pattern catalog. Exact theorem hypotheses still come from a primary source. Symbolic and numeric engines stay on the section 12 route: Lean4, SymPy, PARI/GP, SciPy, NumPy, JAX, Z3 for an SMT query, and `calculator` for finite arithmetic.
