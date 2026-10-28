# Binary variant / patch-comparison decision tree and evidence grades

## Scenario decision tree (entry → branches)

### 1. Analysis-goal branch (level 1)

```
Goal
├─ N-day patch location (before/after the fix) → step 3: changed set → rank candidates
├─ family variant tracing → step 4: pairwise matrix → cluster → evolution chain
├─ similar-sample correlation (is this the same family) → shared-function ratio decision
└─ shared-code identification (reuse / borrowing judgment) → unique functions + constant/string hits
```

### 2. Comparability branch (level 2)

```
Pairing input
├─ same architecture + same toolchain → full function-level match (instruction hash + call graph + constants)
├─ same architecture + different compiler → lower the instruction-hash weight; call graph/constants lead (pitfall 1)
├─ cross-architecture → compare only the logic layer (call graph/constants/strings), and mark the cross-architecture limitation
└─ symbol state
   ├─ not stripped → symbol alignment first (fast and accurate)
   └─ stripped → structural match (entry features / call pattern / constant anchors)
```

### 3. Match-level branch (level 3)

```
Match granularity
├─ function level (default) → matched/changed/new/deleted sets
├─ instruction level → per-instruction diff inside a changed function (locate the edit)
├─ structure level → call-graph / data-reference comparison (reorder / merge detection)
└─ semantic level → restore symbol semantics with [[re-cpp-abi]] first, then compare
```

### 4. Candidate-ranking branch (level 4, during a patch diff)

```
changed function set
├─ new checks / bounds handling (if / length / range checks) → high priority: vulnerability-site candidates
├─ behavior change (new calls / argument changes) → medium priority: feature change / fix
├─ pure refactor (equivalent reorder) → low priority: skip or annotate
└─ no changed → the fix may be inlined / reorganized across functions (pitfall 7) → widen the comparison surface
```

### 5. Result-check branch (level 5)

```
Match result
├─ consistent across tools (BinDiff + rz-diff agree) → accept it
├─ conflict → spot-check the differing functions by hand (decompilation review)
├─ inflated similarity → check shared-library dependencies ([[re-imports]] comparison) and exclude them
└─ threshold not calibrated → spot-check 10-20 functions by hand, set the threshold, then batch
```

## Evidence grade table

| Grade | Evidence shape | Example | Use |
|---|---|---|---|
| A strong | consistent across tools + manual decompilation confirmation | the changed function's difference is confirmed semantically in decompilation (a new check) | a "vulnerability site / fix site" conclusion is allowed |
| B medium | high similarity from one tool + a closed call chain | function similarity > threshold and the call relation corresponds | "highly suspected" is allowed |
| C weak | feature level | only a string/constant hit, and the function-level match does not close | supports only "correlation candidate" |
| counter-evidence | benign explanation | the difference is a refactor / platform branch, with no security semantics | record and archive |

- An inferred defect pattern (out of bounds / missing check) gets its own confidence mark, stated separately from the "function changed" fact
- A similarity score is evidence, not a conclusion: the score itself carries no semantics. Grade it only after a manual review

## Lessons (internalized)

- Pair first, then compare: record sha256 / architecture / toolchain fingerprint first. If comparability does not hold, downgrade immediately. Do not waste a full match
- Calibrate the similarity threshold first: infer the threshold from the manual spot-check of each sample-pair set, then draw the cluster line
- Excluding shared libraries is the first gate against inflation: the dependency list ([[re-imports]]) comes first, then compare business code
- Cross-architecture compares only the logic layer: an instruction-level comparison is meaningless across architectures. Mark the limitation
- Rank a patch diff by change semantics, not by similarity: new checks / bounds handling come before refactor-class differences
- Cross-check across tools: when the BinDiff family and rz-diff agree, evidence strength rises sharply

## Notes

- When the sample source is untrusted, handle it inside a sandbox ([[re-sandbox]]). Comparison is a static operation. Dynamic confirmation uses the matching skill
- Grade conclusions with this table, and note the tool version and thresholds (similarity score, exclusion rules)
