# AI attack implementation notes (Implementation Notes)

Implementation experience outside the SKILL.md procedure flow (Overview + Checklist) — grouped by step; consult the matching step when you hit it.

## Step 1: Model extraction

- **Soft labels beat hard labels**: when the API returns logits/probabilities, distillation quality is clearly higher than labels alone (richer decision-boundary information); with labels only, fall back to decision-boundary sampling and note that output-distribution reconstruction is limited
- **Boundary perturbation**: small perturbations in input space (noise / rotation / brightness) cover the region near the decision boundary and improve how well distillation fits the boundary shape
- **Consistency check**: query the same input several times and look at logit variance — large variance means randomized output or an anti-extraction mechanism
- **Distillation training points**: student capacity should be close to the teacher (too small underfits the boundary; too large overfits sampling noise); tune epochs/learning rate on a small validation set
- **Distillation evaluation baseline**: compare a randomly initialized student against the target on the same distribution — rule out the illusion that "the models themselves just output similar things"
- **Query log**: record every query (input fingerprint / output / time / quota spent) for audit and reproduction
- **Query budget**: inside the budget, estimate with a small batch first (rate-limit / billing interruption handling is in SKILL.md pitfall 1)

## Step 2: Model fingerprint / watermark detection

- **Fingerprint input-set design**: cover class/difficulty strata (easy + hard) — hard examples discriminate better
- **Normalize before compare**: normalize output vectors first (softmax temperature / scale differences), then compute distance (L2 / cosine)
- **Counterexample control**: a trigger response may come from training bias rather than a watermark — first measure the baseline response on inputs with no trigger
- **Erasure resistance**: pruning / fine-tuning / distillation weaken fingerprints — use a robust fingerprint (multiple triggers) and mark "may have been erased"
- **Fingerprint freshness**: fingerprints drift after a hot update — confirm version/time window before comparing
- **Unknown-watermark enumeration**: test trigger candidates (specific input patterns / semantic backdoors) one by one; probe a small batch, then expand

## Step 3: Membership inference

- **Control baseline**: use the loss distribution of same-distribution random samples (non-training samples) as the baseline, then place the target sample against it
- **Privacy sensitivity**: membership inference judges personal data — redact the conclusion; do not publish sample identity
- **Statistical basis**: report an ROC/threshold curve (TPR at a given FPR, plus a confidence interval), not a deterministic conclusion; privacy-preserving training can resist the attack (false-positive control: threshold calibration)

## Step 4: Adversarial samples

- **Perturbation budget (epsilon)**: both FGSM and PGD set a perturbation cap — evaluation bases stay comparable
- **Evaluation control**: first measure the clean-sample baseline (accuracy before perturbation) and report the before/after comparison
- **Budget gradient**: increase epsilon from 0 and report the accuracy curve at each budget
- **Transfer boundary**: adversarial samples transfer poorly — a white-box perturbation is not guaranteed to work on a black-box target

## Usage notes

- This file is experience, not a replacement for the SKILL.md step flow; when an implementation detail conflicts with the target model domain, the target domain wins (see the [[decision-tree]] branches)
