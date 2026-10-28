---
name: re-ai-attack
type: atomic
description: >
  AI model security assessment and forensics (behavior layer): extraction assessment (black-box API extraction assessment),
  fingerprint verification (behavioral fingerprint and attribution verification), privacy leakage evaluation (membership inference / privacy-leakage assessment),
  robustness evaluation (adversarial robustness assessment).
  Triggers: `API模型窃取`, `黑盒模型复制`, `模型指纹`, `成员推断`, `对抗样本`, `行为水印`, `模型安全评估`, `隐私泄露评估`.
guard: {"require_authorization": true, "forbidden": ["unauthorized_api_testing", "bypass_access_control", "model_theft_against_third_party"]}
capabilities: [ai-model-analysis]
---

# AI model security assessment and forensics (behavior layer)

## CORE RULE: the attack surface is decided by observability, not by the attack name

Ask what the interface/asset returns, then choose the attack surface — the three cases are three worlds:

| Observability | World |
|---|---|
| `logits available` (API returns probabilities/logits) | Distillation (soft labels), fingerprints, and membership inference are all available |
| `labels only` (API returns labels only) | Degraded: decision-boundary sampling, black-box transfer, shadow models |
| `weights available` (model file in hand) | White-box: gradient methods (FGSM/PGD), direct comparison, threshold membership inference |

The same attack name has completely different feasibility and implementation under different observability — first confirm API output fields / the model file via "input asset inventory", then pick a path.

## Task classifier (intent → path)

Identify the user's purpose; on a hit, take that branch. A miss falls through to "When to use" below:

| User purpose (intent) | Path |
|---|---|
| Suspect the model was copied / the model was stolen / compare a suspected copy | → **fingerprint** (model fingerprint / watermark detection, step 2) |
| Judge training-data leakage / whether a sample was in the training set | → **membership** (membership inference, step 3) |
| Test whether the API is easy to copy / interface extractability | → **extraction** (model extraction, step 1) |
| Test robustness / adversarial-sample effect / defense verification | → **adversarial** (adversarial-sample assessment, step 4) |

## Input asset inventory (INPUT INVENTORY)

After a path hits, confirm the assets you already have — different asset combinations decide which paths are open. If an asset is missing, ask the user first or state the limit:

| Asset | Effect on the path |
|---|---|
| API endpoint (+ query budget) | Required for **extraction** (step 1) — no endpoint, no extraction |
| model file (local model/weights) | Fingerprint comparison and membership inference (steps 2/3) are available; without it, only the API side is open |
| training dataset (suspected training-set samples) | Required for **membership** (step 3) — no samples, no membership inference |
| suspected copy | Required for **fingerprint** (step 2) — no copy, nothing to compare |
| baseline model (victim/reference model) | Required for fingerprint comparison — a copy with no baseline cannot fix a fingerprint |
| watermark hypothesis | Fingerprint watermark verification (step 2) — a concrete hypothesis (trigger set / backdoor) allows a directed check |

**Rule**: after an intent hits, check the assets that path needs; if any are missing → ask the user first (do they have it / can they provide it). If they cannot, say that path cannot run and switch to an available path.

## When to use / when not to use

- Use: model-leak / theft forensics, API model attack assessment (extraction / fingerprint), training-data leak decisions, model robustness assessment (adversarial samples)
- Use: watermark / fingerprint verification (compare a suspected copy with the victim model)
- Use: model API consistency audit (same input, multiple queries / multiple endpoints, looking for copies/proxies)
- Use: robustness baseline assessment (measure clean and perturbed accuracy once before launch / before defense verification)
- Do not use: model-file format parsing and weight extraction (go to [[re-ai-model]]); model training / fine-tuning (not reverse engineering); deployment hardening (the defense side is not this skill)
- Do not use: an unauthorized target (red line: authorized assessment only; authorization boundary in [[gotchas]])
- **RE_AUTH precondition (guard coupling)**: this skill's guard.require_authorization=true — before running, confirm the authorization context (triage step 0 `RE_AUTH`): owned / ctf / research may run; unknown means first ask who owns the target (ownership / test authorization / research environment). If that is not stated, do static assessment only and do not enter dynamic steps
- Do not use: prompt-injection / prompt-leakage assessment (LLM-side attack surface) or injection / privilege-escalation tests of the API service itself (application-side vulnerabilities are not this skill)

## Tool preparation

### python3 (core runtime)

- Per-platform install: see [[re-python]] tool preparation

### Model libraries (torch / tensorflow, pick by target format)

- Multi-platform: `pip install torch` / `pip install tensorflow` (CPU builds are optional by hardware; pick one framework for the target; distillation scripts only need its tensor ops)
- Verify: `python3 -c "import torch"`

### Attack-evaluation library (ART, optional)

- Multi-platform: `pip install adversarial-robustness-toolbox` (adversarial-robustness toolbox; covers extraction / fingerprint / adversarial-sample attack modules)
- Verify: `python3 -c "import art"`

### Query-interface client (API targets)

- Multi-platform: `pip install requests`; verify: `python3 -c "import requests"`
- Visualization (distribution comparison plots, optional): `pip install matplotlib`

## Procedure

Run in order; authorized assessment only (red line: do not target unauthorized targets). Methodology basis: model extraction (API-query distillation), membership inference (shadow models), and adversarial samples (FGSM/PGD) are public research frameworks; adjust implementation details to the target model domain (see [[decision-tree]] branches).

1. **Model extraction attack** (Overview: rebuild an approximate model through API queries — distillation):
   - Checklist:
     1. Confirm authorization and purpose (record the assessment/forensics statement)
     2. Probe the interface: read the API docs / try a query → confirm quota and output fields (logits/probabilities or labels only — observability decides the strategy; see CORE RULE)
     3. Query sampling (cover the input distribution: representative inputs + boundary perturbation + balanced label distribution)
     4. Distillation training (API output as the teacher labels)
     5. Evaluate approximation (compare outputs on the same input set: agreement rate + label-distribution comparison, not accuracy alone)
   - Implementation experience (prefer soft labels, boundary perturbation, consistency checks, distillation baseline, query log, and so on) is in [[implementation-notes]]
   - Labels only: fall back to decision-boundary sampling (output-distribution reconstruction is limited; see interface pitfalls in [[gotchas]]); inside the query budget, estimate with a small batch first (pitfall 1)

2. **Model fingerprint / watermark detection** (Overview: **behavioral** watermarks — what the model exhibits: trigger response / query response / black-box fingerprint; file-level watermarks (weight pattern / metadata / tensor hash) go to [[re-ai-model]]):
   - Checklist:
     1. Embedding detection: input perturbation (specific noise / trigger) → compare output features (watermark trigger behavior)
     2. Fingerprint extraction: model behavioral signature (output vectors on a representative input set) → compare with the suspected copy
     3. Theft forensics: fingerprint distance between the suspect model and the victim model → threshold similarity decision (threshold calibration: evidence grading in [[decision-tree]])
     4. Output: fingerprint vector + distance report (distance value + threshold basis + confidence)
   - Implementation experience (input-set difficulty strata, normalization, counterexample controls, erasure resistance, freshness, watermark enumeration) is in [[implementation-notes]]
   - Erasure resistance: pruning / fine-tuning / distillation weaken fingerprints — use a robust fingerprint and mark "may have been erased" (see pitfall 3)

3. **Membership inference** (Overview: decide whether a sample was in the training set):
   - Checklist:
     1. Confirm the input form: the probability vector the target model outputs + sample features (observability: see CORE RULE)
     2. Choose the attack type: white-box (loss available) uses a threshold method; black-box (outputs only) uses a shadow model (same-distribution proxy calibration)
     3. Control baseline: the loss distribution of same-distribution random samples (non-training samples) is the baseline
     4. Output: a statistical decision (ROC/threshold curve, TPR at a given FPR, confidence interval), not a deterministic conclusion
   - Implementation experience (baseline design, privacy redaction, statistical basis) is in [[implementation-notes]]
   - Limit: only a statistical decision is possible (false-positive control: threshold calibration; privacy-preserving training can resist it; see [[gotchas]])

4. **Adversarial-sample basics** (Overview: robustness assessment and defense verification, not attack deployment):
   - Checklist:
     1. Choose a path: white-box (weights loadable and loss differentiable) uses gradient perturbation (FGSM/PGD); black-box uses query/transfer perturbation (observability: see CORE RULE)
     2. Set a perturbation budget (epsilon) — evaluation bases stay comparable
     3. Evaluation control: first measure the clean-sample baseline (accuracy before perturbation) and report the before/after comparison
   - Implementation experience (budget gradient, transfer boundary) is in [[implementation-notes]]
   - Boundary: adversarial samples transfer poorly (a white-box perturbation is not guaranteed to work on a black-box target; see [[gotchas]])

5. **Assessment report and evidence retention**:
   - Record all three: method (sample set / distillation hyperparameters / distance threshold), result (metrics), parameters (random seed / framework version)
   - Archive attack scripts and assessment artifacts by sha256; deliver conclusions per [[re-analyze/analysis-contract]]

## Cross-domain joins

- [[re-ai-model]]: **consumes file-level evidence** (one-way flow: file-level evidence → behavioral verification) — when a model file exists, first extract structure / weights / file-level fingerprint through re-ai-model, then verify behavioral consistency in this skill; API only (no file) means no file-side input, so assess black-box directly
- [[re-python]]: Python toolchain base
- [[re-feedback]]: attack-case lessons (after redaction)
- [[re-analyze/analysis-contract]]: delivery format for assessment conclusions

## Common pitfalls

- **Query budget limit**: symptom — API rate-limit / billing interruption; cause — high query volume; fix — sample inside the budget (estimate with a small batch first) and record quota already used
- **Degrade when confidence is unavailable**: symptom — the interface returns labels only; cause — the server clipped the output; fix — decision-boundary sampling + state the limit; do not invent probabilities
- **Watermark erased**: symptom — fingerprint comparison fails; cause — the suspect pruned / fine-tuned / distilled; fix — use a robust fingerprint (multiple triggers) and mark "may have been erased"; when the distance is close but under the threshold, report "weak similarity" rather than "unrelated"
- **Membership-inference false positives**: symptom — the statistical decision is wrong; cause — threshold bias / shadow-model distribution mismatch; fix — shadow-model calibration + report a confidence interval
- **Misleading evaluation metrics**: symptom — the extracted model has "high accuracy" but a completely different output distribution; cause — comparing accuracy and not distribution; fix — combine agreement rate + label distribution + calibration
- **Extraction does not converge**: symptom — distillation works poorly; cause — sample distribution does not match the target distribution / interface output was clipped; fix — resample for the target data domain and state the data-distribution assumption
- **Output parse error**: symptom — logits and labels are misaligned; cause — API response fields were parsed wrong; fix — print the raw response and check fields before batching
- **Results not reproducible**: symptom — a rerun differs; cause — random seed / sample order was not fixed; fix — fix the seed and record it
- **Wrong comparison basis**: symptom — fingerprint comparison used models for different tasks; cause — the task basis was not confirmed; fix — confirm the task / label space matches before comparing
- **Multi-endpoint basis differences**: symptom — the same model returns different outputs from different endpoints; cause — A/B routing / different versions; fix — lock the endpoint for before/after comparison and record the endpoint id
- **Batch queries trip risk control**: symptom — queries at a normal rate are risk-controlled; cause — a rate threshold fired; fix — control query cadence (rate limit / random interval) and record the risk-control event
- **Resource budget**: symptom — distillation OOM / long job interrupted; cause — student model too large / duration underestimated; fix — staged checkpoints (archive sampling/training in steps), smaller batches / CPU fallback
- **Authorization boundary**: symptom — attack testing against an unauthorized API; cause — scope was not confirmed; fix — confirm authorization first (usage-boundary red line)
- Scenario branches and evidence grading: [[decision-tree]]; boundaries and counterexamples: [[gotchas]]
