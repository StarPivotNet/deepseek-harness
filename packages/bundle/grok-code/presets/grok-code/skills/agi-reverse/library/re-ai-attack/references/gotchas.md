# AI attack methodology pitfalls and boundaries

## Extraction-attack pitfalls

- **Interface clipping**: server-side output clipping (temperature scaling / truncated logits / quantization) weakens the teacher signal — first probe the output distribution (query the same input several times and look at variance), then choose a distillation strategy
- **Query quota**: rate limits / billing / risk controls interrupt long query jobs — design sampling inside the budget (estimate the distribution with a small batch, then decide the scale); when risk-controlled, change the query cadence and record it
- **Data-distribution mismatch**: when the query distribution does not match the target domain, the distilled model "learned the query set" rather than "the target model" — sample to cover the target domain and state the distribution assumption
- **Cache and batching**: when a cache/batching layer sits in front of the API, identical inputs return identical outputs (normal), but dedup/cache makes query statistics lie — use randomly perturbed inputs when judging effectiveness
- **Anti-extraction countermeasures**: watermarks (backdoor triggers), output perturbation, and query risk controls may all be present — when an extraction result is unusable, mark "an anti-extraction mechanism is present"; do not treat it as a failure

## Fingerprint / watermark pitfalls

- **Same-source base-model hypothesis**: when the suspect model and the victim model are both fine-tuned from the same public base model, behavioral fingerprints are naturally close — before deciding, compare "unique features" (behavior specific to the training data/task) and rule out the same-source explanation
- **Fingerprint erased**: pruning / quantization / fine-tuning / distillation all weaken a fingerprint — use a robust fingerprint (multiple triggers / behavioral signatures); when the distance is "close but under the threshold", report "weak similarity" rather than "unrelated"
- **Trigger overfitting**: a single-trigger check may only be "this input is special", not a watermark — cross-check with multiple triggers plus trigger families (structural / noise / semantic)
- **No universal threshold**: a fingerprint-distance threshold depends on the model family and the input set — calibrate the threshold against same-family controls (train 1-2 control models and measure the distance distribution); do not reuse someone else's threshold

## Membership-inference pitfalls

- **Overfitting ≠ membership**: a high-confidence output may only mean the model overfit that input, not "it was in the training set" — calibrate the distribution with a shadow model (same-distribution proxy), then decide
- **Shadow-model same-distribution assumption**: calibration fails when the shadow model's training distribution differs from the target's — keep shadow training data as close as possible to the target domain (public same-domain data) and state the assumption
- **Privacy-preserving training**: models trained with DP-SGD / differential privacy give a weak membership signal — when the distributions do not separate, report "cannot decide"; do not force a conclusion
- **Misreading the statistics**: membership inference is a statistical decision (with TPR/FPR); a single-sample claim "definitely in the training set" does not hold — report a confidence interval

## Assessment boundaries and counterexamples

- **Adversarial-sample transfer**: a white-box perturbation is not guaranteed to work on a black-box target — transfer success rate is an evaluation metric, not an attack guarantee
- **Counterexample: misusing "accuracy"**: an extracted model whose test-set accuracy is close to the target ≠ functional equivalence (the output distributions may be completely different) — functional equivalence needs agreement rate and distribution
- **Counterexample: model-version differences**: different deployed versions of the same model (quantized / distilled deployment builds) have fingerprints that differ from the training build — confirm the version basis before comparing
- **Out of scope**: prompt injection / prompt leakage (LLM side) is not this skill (this skill covers extraction, fingerprints, membership inference, and adversarial evaluation for classification/generation models); training-data copyright is a legal question; this skill only produces statistical evidence

## Usage notes

- Authorized assessment only (confirm scope / target / data first); do not bypass paid or access-control boundaries
- Deliver conclusions per [[re-analyze/analysis-contract]]: a statistical statement + confidence + limits
- Related file analysis continues in [[re-ai-model]]; lessons go to [[re-feedback]] (redacted)
