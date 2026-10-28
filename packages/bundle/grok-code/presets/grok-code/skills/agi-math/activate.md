# Mechanism construction

Read this when the route in `SKILL.md` says **activate**: the user wants a mathematical mechanism for a research or design question. The delivery is the mechanism, the conditions under which it works, and a check. It is not a list of lenses, a card, or a renamed module.

Do not open this file for implementation-only work (imports, shapes, refactors, tuning, ordinary code review). A closed answer, including a proof of a closed statement, is `solve.md`. An open statement or a new concept is `methods.md` sections 10 and 13–15.

This preset does not vendor an external anchor library, design-pattern catalog, or book distillation. Those trees are not a theorem list. When a constant or a hypothesis must be exact, search a primary source. Memory and this file are not a citation. An unchecked statement stays unchecked.

## Intent

| Intent | Deliver | Load |
|---|---|---|
| Analyze | whether the claim holds, why, and the smallest repair | the objects already in the question |
| Transfer | a structurally different approach | the relation the current design does not satisfy; prototypes only after a mapping exists |
| Construct | an operator, objective, solver, or decision rule | one move below, then the hypotheses. Pure cryptography does not use that table |
| Query | definition, formula, and the hypotheses that make it true | one statement; no design write-up |
| Verify | a derivation, a bound, or a minimal counterexample | the claimed conditions |

Keep the user's goal, constraints, and prior failures. Ask only when the missing fact would change the conclusion. Continue under a named assumption otherwise.

## Domain

Judge by the object and the guarantee asked for, not by keyword count.

| Domain | Use | Leave out |
|---|---|---|
| Shared mathematics | the relation itself | an AI pattern or a security game, unless the question needs that translation |
| AI or systems research | shared mathematics plus a construction | cryptography anchors |
| Cryptography | adversary, security game, advantage, reduction cost | AI operator patterns; a GPU note is not a security argument |
| Both | only when the question composes a cryptographic primitive with a learning object | material that is not on that composition |

`hash`, `attack`, `certificate`, or an adversarial loss does not by itself make the domain cryptography. Feature hashing, a Lipschitz robustness certificate, and randomized smoothing stay on the learning side. A statistical privacy definition is not automatically a cryptographic game.

For a cryptographic question, write the adversary's capabilities, the game, the advantage, and what the reduction is allowed to do. A reduction that calls an oracle the real deployment does not provide is not a reduction. State which hypothesis the reduction consumes. Do not write exploit procedures, payloads, or bypass steps. Implementation cost is in scope only when the user asked about cost.

## What to read

One or two pieces that can change the current decision. A query or a short verification usually needs a single statement. A non-cryptographic construction may add one move and one structural relation. Pure cryptography stops after the adversary, the game, the advantage, and the reduction. Do not read a catalog first.

If no statement on hand covers the gap, do not force a nearby name. Write a temporary note: the missing concept, the domain, a minimal definition, the hypotheses, what is known versus derived versus assumed, and what is unchecked. Return to the construction. Propose keeping the note only if this session reused it.

## Transfer

Strip product names. Keep the relation the current design fails: an operation that should commute, local facts that must glue, information discarded at a step, or a quantity that must stay bounded.

Each candidate that you recommend states:

- which object, relation, or loss in the task corresponds to which mathematical object, and which operations survive;
- the precise hypotheses of the proposition used, and the equality, inequality, impossibility, or executable step that comes back;
- whether the correspondence is an equivalence, a sufficient condition, an approximation with an error, or an analogy. Those four are not interchangeable.

A sentence that only says "like a manifold" or "like a game" is not a candidate. A learned tensor does not satisfy an axiom because it was named. Two candidates must differ in the information interface, the mechanism, or the guarantee. Two reweighted averages are one candidate.

Impossibility, non-identifiability, and missing information are results. Do not invent a module to avoid them. For each kept candidate, one small input family where it differs from the baseline, and one where a hypothesis fails. Do not claim novelty without a source check; until that check, say the comparison was not done.

## Construct

From the desired behavior and a failure case, derive an update, an objective, a solver, or a decision rule. Substitute the theorem's variables with the actual tensors or states. Each hypothesis is either forced by the structure, controlled by a residual you can compute, or an empirical assumption. Say which. Information available only while training is not free at decision time. A property of an intermediate tensor is not a property of the output until that step is proved.

Pure cryptography does not use the table below. Stop after the adversary, the game, the advantage, and the reduction. For any other construct, pick a move only when its bottleneck is the one in front of you. The move is a derivation tool, not a menu of five architectures.

| Bottleneck | Move | Keep |
|---|---|---|
| The same pairwise interaction is recomputed for many queries | separate the interaction into a summary that does not depend on the query, and a readout that does | the function being approximated, the query domain, and the output error |
| A cheap approximation exists and is not accurate enough | spend exact work on the residual; the baseline must be computable without touching every exact term | the sampling support is the full index set; unbiasedness for a linear mean does not survive a later normalization |
| Depth is a stand-in for "solve until the residual is small" | write the layer as an input-dependent fixed point and stop on a residual bound | the contraction (or another proved condition) and a flag when it does not fire |
| A small local change ruins a later output | budget the error by how it amplifies, not by the local norm alone | the state includes whatever later steps still read |
| Whether to compute more depends on information not yet paid for | compare the value of one more observation with its cost, using only the state known before the observation | no feature from a step that was skipped |

Composing two moves requires the interface of each. If the composition drops a bound, say the new risk target. After a candidate exists, a known pattern may be used as a comparison, not as the generator.

A lens is optional, at most two, and only while the objects are still vague. The answer is the mechanism, not a list of lenses.

## Check before delivery

Lead with the mechanism or the answer, then the conditions. Confirm: hypotheses are instantiated; the decision does not read unpaid information; the approximation changes a named conclusion; a degenerate case was considered; any experiment you report was actually run. A small numeric check is not a universal proof. Finite numeric arithmetic uses `calculator` (scientific-notation literals, degree trig). Symbolic and formal checks follow `methods.md` section 12 (SymPy, PARI/GP, SciPy, NumPy, JAX, Lean4). An SMT query uses Z3, the SMT solver (Satisfiability Modulo Theories), via doctor's `path.z3`.

A full review, only when the user asks for one, also separates: security definition versus a learning claim, reduction tightness versus an assumption list, and a composition that invalidates a hypothesis of either side. Do not run that review on a short query.
