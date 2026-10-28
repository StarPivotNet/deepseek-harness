---
name: re-variant
type: atomic
description: >
  Binary variant / patch comparison: function matching, N-day patch diff, variant tracing, and similarity analysis.
  Triggers: `二进制对比`, `补丁对比`, N-day, `变体分析`, BinDiff, `函数匹配`, `样本相似`.
capabilities: [binary-diffing]
---

# Binary variant / patch comparison

## When to use / when not to use

- Use: before/after patch comparison (vulnerability location), family-variant correlation, sample tracing, N-day analysis
- Use: identifying reused same-origin code (shared functions / library-code judgment)
- Use: fix-coverage audit — compare the fixed sample against each branch version, and check which versions were fixed and which were not
- Use: vulnerability research — a full recovery of structural and behavioral differences before and after the fix (patch → defect pattern)
- Do not use: deep analysis of a single sample (the general path in [[re-binary-core]])
- Do not use: no comparison baseline (only one sample, no second version to compare) — take the single-sample path first
- Do not use: behavior-level comparison (dynamic behavior differences go to [[re-behavior]]; this skill only compares static code structure)
- Do not use: a comparison that needs semantic-level recovery (restore ABI/symbol semantics with [[re-cpp-abi]] first, then come back to this skill to locate differences)

## Tool setup

### BinDiff / Diaphora (function-matching plugins)

- BinDiff (Google/Zynamics family, a Windows commercial tool, official installer): mainly an IDA plugin. From BinDiff 6 the official build supports Ghidra (export needs the BinExport plugin). BinExport also supports Binary Ninja — the export format can bridge several decompilers
- Diaphora: multi-platform open source (`git clone https://github.com/joxeankoret/diaphora`), mainly an IDA plugin (Ghidra-side support is still advancing)
- Alternatives with no IDA: qbindiff (Quarkslab; reads BinExport/quokka exports), ghidriff (headless Ghidra comparison)
- Typical flow: BinExport from inside the decompiler → the tool loads both samples → match → export the result (similarity / change set) as a report. The BinExport plugin and the decompiler version must match (see [[gotchas]])
- Verify: the plugin loads inside the decompiler and can export/import match results

### radiff2 / rz-diff (rizin command-line comparison)

- The install matrix is in [[re-radare2]] (including the radare2 compatibility layer). After install, verify with `rizin -v`
- Verify: `rz-diff --version`; radiff2 ships with the radare2 package
- Use: fast function-level comparison with no GUI, and batch scripting (see the step 1 command). radiff2 is a byte/instruction quick look (`radiff2 -s` bytes, `-C` instructions) — use it for a small-file quick look. Function-level comparison uses rz-diff

### readelf (symbol-alignment assist)

- Install and verify are in [[re-cpp-abi]] Tool setup
- Use: `readelf -s` (symbol table / dynamic symbols) and `readelf -d` (dynamic section) for import/export alignment and pair checking

### Pairing assist (comparison prerequisite)

- Hash/baseline: `sha256sum`. Architecture/compiler determination: the import table and toolchain fingerprint in [[re-imports]] — confirm comparability before pairing (same architecture / same toolchain; see pitfalls 1 and 3)
- Verify: `sha256sum --version`
- Packer check: [[re-packer-id]] identifies packing. Unpack a packed sample first ([[re-unpack-simple]]), then compare — packer code pollutes the match (see the counterexample group in [[gotchas]])

## Steps

Run in order. Archive each step's product (path + sha256; see [[re-triage]]). Pass the final difference list under the data contract in [[re-analyze/analysis-contract]].

1. **Pairing preparation (confirm comparability before comparing)**:
   - Record the baseline: sha256 of both samples, architecture (x86_64/ARM and so on), bitness, compiler fingerprint (version strings / imported-library set, [[re-imports]])
   - Comparability: same architecture + same toolchain → full function-level matching. Cross-architecture / different compiler → downgrade to a logic-layer comparison (call graph / constants / strings), and mark the limitation
   - Bitness/endianness: do not compare 32/64 mixed or big/little-endian mixed directly — unify to the same bitness and endianness, then match
   - Symbol state: stripped / not stripped decides the match strategy (not stripped aligns symbols directly; see step 2)

2. **Function matching**:
   ```sh
   # Fast command-line comparison (rizin family): function-level match (-B auto-analyzes, then compares by function, including a similarity column)
   rz-diff -B -t functions sample_v1 sample_v2 | head -30
   ```
   - Match dimensions: instruction hash (identical code), call graph (subgraph isomorphism), import/export alignment, string/constant references
   - Data-reference dimension: global constant / string references as a function-identity fingerprint — more stable than an instruction hash after refactor/reorder, and a reliable anchor for cross-version matching
   - Tool (BinDiff/Diaphora) output: matched / changed / new / deleted function sets
   - Reading the output: matched is the same, changed is a change, new/deleted is added or removed functionality — changed goes to step 3. new/deleted hints at a functional-surface difference; give a follow-up action per class
   - Missing symbols after strip: rely on structural matching (entry features / call pattern / constant anchors) — weight adjustments for match dimensions are in pitfall 1 and [[decision-tree]]
   - Address differences: after PIE/relocation, function addresses differ — align by symbol name / function order. Do not compare bare addresses (see pitfall 2)
   - Name/comment migration: tools can migrate names/comments of already-named functions onto matched functions — annotate a known sample first, then compare, and semi-automatically restore symbols on the new sample. Mark the source of a migrated name. It is only an auxiliary anchor (see the symbol group in [[gotchas]])

3. **Patch diff (N-day)**:
   - Before/after the fix → the `changed` function set = vulnerability-site candidates
   - Classify changed functions by semantics: new checks / bounds handling (high priority) > behavior change > pure refactor (low priority) — rank candidates by class ([[decision-tree]] grades)
   - Dig into changed functions: new conditional branches / new checks / new calls ([[re-ghidra]] / [[re-ida]] decompilation)
   - Infer the vulnerability backward: the old code's defect pattern (missing check / out of bounds / use after free)
   - Fix-pattern recognition: common fix patterns (length check / null-pointer check / tightened out-of-bounds upper bound) are classified against defect patterns — filter candidate functions quickly by pattern
   - Fix-coverage check: compare the fixed sample against each branch version, and confirm the vulnerability-fix coverage (which versions were fixed, which were not)
   - Product: vulnerable function + inferred defect pattern (confidence mark; evidence grades are in [[decision-tree]])

4. **Variant tracing**:
   - Pairwise comparison of samples inside the family → similarity matrix → clustering (shared-function ratio threshold)
   - Evolution chain: order samples by timeline / similarity (early vs late variants)
   - Shared unique functions = a family marker (joins capability evidence in [[re-attribution]])
   - Unique-function decision: compute the in-family shared set first, then take functions missing from out-of-family samples as the family marker — avoid treating generic code as a marker
   - Link strength: judge from the count of shared unique functions plus the similarity distribution together. A single indicator is not the only basis
   - Sample-count control: a pairwise matrix is O(n²) when the family has many samples — coarse-cluster by features first (architecture / size / import set), then compare finely inside the cluster
   - Threshold calibration: spot-check similarity scores by hand and calibrate before drawing the cluster line (see pitfall 5), to avoid inflated links

5. **Emit the difference list and check it**:
   - Format: changed-function table (function name / address / change type / similarity) + conclusion
   - Pass it under the data contract in [[re-analyze/analysis-contract]] (downstream consumption)
   - False-positive check: exclude shared-library code (compare the [[re-imports]] dependency list), recheck a different compiler (same source, different compile differences), cross-check across tools ([[decision-tree]] grades)
   - The report must be reproducible: attach the tool and version, the similarity threshold, and the exclusion rules to the difference list. For an important conclusion, keep the match export file + the manual decompilation review record

## Related skills

- [[re-binary-core]] gateway: this skill belongs there (the "patch / N-day comparison" branch of the selection tree)
- [[re-ghidra]] / [[re-ida]]: decompilation base (digging into changed functions)
- [[re-attribution]]: capability-evidence handoff for variant correlation
- [[re-imports]]: import table / toolchain fingerprint (pair comparability and shared-library exclusion)
- [[re-cpp-abi]]: symbol-semantic recovery (prerequisite for a semantic-level comparison)
- [[re-packer-id]] / [[re-unpack-simple]]: unpack a packed sample before comparing (packer code pollutes the match)
- [[re-analyze/analysis-contract]]: the difference list is passed under the data contract

## Pitfalls

- **Compiler differences disturb matching**: symptom — the same source compiled with different compilers is judged dissimilar; cause — optimization / code-generation differences; fix — weight the call graph and constant references, and lower the instruction-hash weight
- **Missing symbols after strip**: symptom — no function names at all; cause — symbols were stripped; fix — structural matching (entry features / call pattern), anchored on the import table
- **Cross-architecture comparison is downgraded**: symptom — x86 vs ARM match rate is low; cause — the instruction sets differ; fix — compare only the logic layer (call graph / constants / strings), and mark the cross-architecture limitation
- **A large amount of similarity causes a false link**: symptom — shared-library code inflates similarity; cause — a common dependency (libc/framework); fix — exclude shared-library symbols and compare only business code ([[re-imports]] dependency comparison)
- **Patch-diff location is biased**: symptom — many changed functions, and the vulnerability site is drowned; cause — the patch includes a refactor; fix — filter by change semantics (new checks / bounds handling first)
- **Bare-address comparison fails**: symptom — the same function is reported as different; cause — PIE / relocation / version differences drift the address; fix — align by symbol / function order. Do not compare bare addresses
- **"Nothing diffed" ≠ "not fixed"**: symptom — the patch comparison has no changed functions; cause — the fix was inlined into a neighboring function or reorganized across functions; fix — widen the comparison surface (including the instruction hash after inline expansion), and check it against version history
- **Name migration pollutes**: symptom — function names on the new sample look known; cause — they were migrated from the match source, not real symbols; fix — mark the source of a migrated name. It is only an auxiliary anchor. Confirm critical functions by decompilation
- **The symbol table was forged**: symptom — symbol names are complete but the structure does not match; cause — an obfuscation / anti-analysis tool renamed them (forged symbols); fix — run a structural confirmation (call pattern / constants) on the symbol-alignment result. Do not trust the symbol name itself
- **The blind spot of comparing only .text**: symptom — function matches are all identical but behavior differs; cause — data-section differences (config / constant tables) were left out of the comparison scope; fix — include the data-reference dimension in the match, and compare constant tables / config structures separately
- Decision branches (comparability / match level / candidate ranking) are in [[decision-tree]]. Match algorithms and tool boundaries are in [[gotchas]]
