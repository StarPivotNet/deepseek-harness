# AI attack decision tree and evidence grading

The attack surface is decided by "target form × interface capability". Recon first, then act. Use this document with SKILL.md steps 1-4.

## Target-form decision tree

```
Assess the target
├─ Black-box API (query only) → extraction attack / black-box adversarial samples / behavioral fingerprint
├─ Model file (weights in hand) → white-box analysis: weight fingerprint, membership inference (white-box), FGSM/PGD
│   (file parsing and format recovery go to [[re-ai-model]])
└─ Embedding / fine-tune artifact (LoRA/adapter) → diff against the base model (fingerprint-source analysis)
```

## Interface-capability branches

```
API query
├─ Returns full logits/softmax probabilities → distillation first (soft-label training)
├─ Returns top-k probabilities → degraded distillation (truncated probabilities; note the information loss)
├─ Labels only → decision-boundary sampling (boundary + adversarial-perturbation queries); do not reconstruct probabilities
└─ Temperature / normalization perturbation → calibrate, then distill (softmax temperature changes the teacher signal)
```

## Forensics-purpose branches

```
Forensics request
├─ "Is this a copy?" → behavioral fingerprint extraction + distance-threshold decision
│   ├─ Distance < threshold and stable across input sets → strong similarity (high confidence)
│   ├─ Distance < threshold but a single input set → weak similarity (note the input-set limit)
│   └─ Distance > threshold → not similar; first rule out "fingerprint was erased" (see [[gotchas]])
├─ "Was this sample in the training set?" → membership inference (shadow model / loss distribution)
│   ├─ Distributions clearly separate + calibration → statistical decision (with a confidence interval)
│   └─ Distributions overlap → cannot decide (report an interval, not an assertion)
└─ "Was a watermark added?" → trigger detection (enumerate known/unknown triggers)
```

## Evidence grading table

| Evidence | Weak | Medium | Strong |
|---|---|---|---|
| Fingerprint distance | Close on one input set | Stably close across input sets | Multiple input sets + matching unique behavioral features |
| Membership inference | Loss above baseline | Separated distributions + calibration | Consistent across attack surfaces (white-box + black-box) |
| Watermark trigger | Response to one trigger | Response to multiple triggers | Trigger + matching output-structure features |
| Adversarial robustness | Perturbation works on one sample | Consistent across samples/methods | Still effective after transfer to a surrogate model |

Any "strong" evidence must rule out alternative explanations (same-source training / fine-tune of a public base model — identical base models naturally produce close fingerprints; see [[gotchas]]).

## Combined playbook (extraction assessment flow)

1. Recon the interface capability (a small batch inside the budget)
2. Design the sample set (representative + boundary + label-balanced)
3. Distillation training → evaluation (agreement rate / distribution / calibration)
4. Fingerprint extraction (multiple input sets) → distance report
5. Grade the conclusion with the evidence table + note limits (authorization, budget, data-distribution assumptions)

## Implementation lessons (internalized)

- Ask "what does the interface return" before choosing an attack surface — logit availability is the strategy watershed
- Evaluate with multiple metrics: high accuracy ≠ a successful extraction; look at agreement rate and label distribution together
- Fingerprint decisions must rule out the "same-source base model" hypothesis (fine-tunes of the same public model are naturally similar)
- Reports are always statistical/probabilistic; membership inference and fingerprint decisions both carry confidence

## Usage notes

- Authorized assessment only (authorization boundary: SKILL.md red lines and [[gotchas]])
- Deliver conclusions per [[re-analyze/analysis-contract]]; do not deploy attack code to production
- Defensive references (adversarial training / output clipping) are side notes on the assessment conclusion only; do not expand them
