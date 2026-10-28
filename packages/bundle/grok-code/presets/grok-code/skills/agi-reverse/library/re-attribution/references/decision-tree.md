# Attribution decision tree and evidence grading

Attribution is a reasoning chain, not a lookup: every step must be able to answer "which hypothesis does this evidence support or oppose, and how strong is it". Use this document with SKILL.md steps 1-4.

## Scenario decision tree (input → branch)

```
Input request
├─ A single IOC / background on one sample → [[re-ti]] (a query is enough; do not enter attribution)
├─ A behavior decision "what is it doing" → [[re-behavior]]
├─ "Is this the same group" linking several events → the attribution flow (diamond-model placement)
└─ "Who did it" organization-level attribution → the attribution flow + confidence grading
```

Attribution flow (diamond model):

```
Inventory the four corners
├─ Only 1 corner (only a sample, or only a domain) → no attribution conclusion; output "intelligence lead" level
├─ ≥2 corners and no independent-evidence cross-check → an "associated activity" statement (low confidence)
├─ 2 classes of independent evidence cross-check → "suspected same activity" (medium confidence)
└─ ≥3 classes + a consistent timeline + no counter-evidence → "highly suspected attribution" (high confidence)
```

Evidence-collection sub-branches (every corner takes them):

```
Evidence type → distinguish "control" from "shared"
├─ Control-plane evidence (registrant email / certificate private-key operation / unique configuration / in-house tool) → may count as strong evidence
├─ Shared-plane evidence (hosting provider / jump host / public C2 framework / public tool) → weak evidence only; cannot attribute on its own
└─ Timeline (activity window / aligned after timezone calibration) → can only corroborate; cannot decide the case on its own
```

## Branch-logic notes

- **Entry split**: an attribution request first asks "are there more than two corners"; if not, fall back to intelligence-level output (a single-IOC query belongs to [[re-ti]]). This is the first gate against a false statement of the class "one domain belongs to one organization"
- **Evidence independence**: two pieces of evidence from the same data chain (for example the email and the registrant inside one whois record) count as one class of evidence and do not cross-check; a cross-check = different sources (whois + certificate transparency + behavior analysis)
- **Strong-evidence bar**: only a uniqueness feature (a rare string, an in-house tool, unique registration information) can be strong evidence; a commoditized feature such as "a shared C2 framework" is always weak evidence
- **A timeline only corroborates**: overlapping time windows mean "they may have been active at the same time", not the same attribution (attackers reuse time slots); a timeline gap must be marked explicitly

## Evidence grading table

| Evidence type | Weak | Medium | Strong | Attribution meaning |
|---|---|---|---|---|
| Infrastructure | Same hosting provider / same C2 framework | Shared NS/ASN/certificate | Unique registrant email / private key / certificate chain | Strong evidence can be the core; weak evidence is only supporting |
| Capability / sample | Same-family generic TTP | Similar code fragments | Unique string / compile feature / in-house module | A tool is a commoditized resource and cannot decide the case alone |
| Behavior / TTP | Same broad technique class (ATT&CK level 1) | Same technique-combination sequence | A rare procedure order + parameter habits | Needs other corners stacked before it is upgraded |
| Timeline | Active periods are close | Overlapping periods + matching cadence | Interleaved event sequences (each is a precondition of the other) | Can only corroborate; cannot decide the case alone |
| Counter-evidence | One contradictory piece | Several contradictory pieces | A structural contradiction (capability does not match the claim) | Every grade must list counter-evidence |

## Confidence decision flow (combined playbook)

1. Grade each piece of evidence on the table above (weak/medium/strong)
2. Merge same-class sources (the same data chain counts once)
3. Count independent evidence classes (infrastructure / capability / behavior / timeline)
4. Match the grade: 1 weak class = low; 2 classes cross-checked or 1 strong class = medium; ≥3 classes + no counter-evidence = high
5. Check counter-evidence: contradictory evidence → drop one grade and write it into the report's "unresolved items"
6. Wording corresponds strictly to confidence (see the statement boundary in [[gotchas]])

## Implementation lessons (internalized)

- "Control vs shared" is the first judgment, not a similarity judgment — first ask whether a third party could buy / rent / steal this evidence, then talk about strength
- Evidence must be reproducible: mark the source and query time of each piece (whois records expire; archive a screenshot)
- A grade is not the end: a high-confidence statement still writes its "assumptions" (for example "assuming this infrastructure was not hijacked")
- Attribution output is a probabilistic statement; the report forbids absolute assertions

## Usage notes

- Everything runs inside the authorized scope and redaction requirements (do not name a real organization/victim; see the SKILL.md red line)
- Deliver conclusions in the [[re-analyze/analysis-contract]] format; separate the external report from the internal conclusion
- This skill's conclusion is an intelligence judgment, not judicial evidence (the standards differ; see [[gotchas]])
