# Binary variant / patch-comparison pitfalls and boundaries

## Match-algorithm group (sources of misjudgment)

- **Instruction hashes are affected by compile differences**: the same source at a different optimization level / compiler version changes the instruction-level hash — judging "different" by instruction hash is not "logically different". Weight it below the call graph and constants
- **Call graphs are affected by inlining / splitting**: after the compiler inlines, function boundaries drift, and a call-graph comparison pairs the wrong functions — when a match fails, suspect inlining first. Widen the match granularity, or anchor on constants
- **A similarity score carries no semantics**: a high score may only be shared code / template instantiation. A low score may be same-origin logic that was deliberately rewritten — the score is only a ranking basis. Semantics come from a manual review
- **Cross-architecture match rate is necessarily low**: different instruction sets invalidate the whole instruction-level dimension — compare only the logic layer (call graph / constants / strings), and mark the cross-architecture limitation
- **Template / generic instantiation interferes**: several functions from C++ template instantiation are highly similar — separate instances by template parameters. Do not treat instantiation as a family marker

## Symbol and address group

- **No symbol anchor after strip**: when there are no function names, match by entry features / call pattern / constants — the error rate is high. Calibrate the threshold and spot-check by hand
- **Address drift: do not compare bare addresses**: PIE/ASLR/relocation/version-build differences all move function addresses — align by symbol / function order. Normalize section layout before comparing across versions
- **Symbol names can mislead**: leftover symbols from an incomplete strip, and forged symbols (an obfuscation tool renamed them), glue different functions together — the symbol-alignment result still needs a structural confirmation pass
- **The import table is a stable anchor but not the whole set**: aligning imported functions is reliable, but internal functions do not appear — import alignment is only an auxiliary dimension. It cannot replace function-level matching

## Tool-difference group

- **BinDiff and Diaphora use different algorithms, so results may disagree**: match strategy (the weight of instruction hash vs graph isomorphism) differs — review conflicts by hand. High agreement is stronger evidence
- **The BinExport version and the decompiler version must match**: the BinExport plugin is strictly bound to the IDA/Ghidra version. A version mismatch fails the export or produces an abnormal result — check versions before exporting
- **rz-diff -B spends analysis time**: `-B` auto-analyzes both binaries first (disassembly + function identification). Large files take a long time — limit the scope with `-t functions` first, and batch large runs with a script
- **Memory pressure on a large binary**: a full function-graph comparison uses a lot of memory on a very large binary (a kernel / a large framework) — compare by section (for example .text), or raise the tool's memory
- **qbindiff/ghidriff result formats differ**: open-source alternatives emit CSV / BinDiff formats that are not equal — unify the format before downstream consumption (per [[re-analyze/analysis-contract]])

## Counterexamples and boundaries

- **Shared libraries inflate similarity**: two unrelated samples both link the same libc/framework, and the shared-function ratio is inflated — exclude shared-library symbols ([[re-imports]] dependency comparison) before computing similarity
- **"Nothing diffed" ≠ "not fixed"**: the fix may be inlined into a neighboring function, reorganized across functions, or only a constant change — widen the comparison surface (including inline expansion) and check version history
- **Many changed ≠ many vulnerabilities**: patches often carry a refactor / platform adaptation — filter by change semantics (new checks / bounds handling first), and exclude the refactor class
- **Variant "similar" ≠ "same origin"**: same-origin code recompiled across compilers and platforms drops in similarity. Deliberate rewriting (junk instructions / constant obfuscation) also drops it — a tracing conclusion needs several pieces of evidence to close (timeline / unique functions / the behavior side)
- **A single-tool conclusion does not reproduce across tools**: a match from only one tool may be completely different in another tool — an important conclusion needs at least two tools, or a manual review

## Notes

- When the sample source is untrusted, handle it inside a sandbox ([[re-sandbox]]). Comparison is a static operation. Dynamic confirmation uses the matching skill
- Grade conclusions with [[decision-tree]], and note the tool version, threshold, and exclusion rules
