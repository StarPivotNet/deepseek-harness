---
name: re-vuln
type: gateway
description: >
  Vulnerability-hunting gateway. Orchestration: target and input-surface identification → coverage-guided fuzzing →
  crash analysis → reverse-engineering location → report.
  Sub-skills: [[re-fuzzing]] [[re-crash-triage]] [[re-exploit]].
  Triggers: `漏洞挖掘`, `挖洞`, fuzz, `模糊测试`, AFL, libFuzzer, `崩溃分析`,
  crash, vulnerability hunting, fuzzing.
capabilities: [fuzzing, symbolic-execution, constraint-solving]
---

# Vulnerability hunting (coverage-guided fuzzing / crash location)

## Full workflow

Run in order. Record each step's products (target / input-surface conclusion, fuzz run directory, crash sample, location evidence) with evidence path + sha256 (evidence method is in [[re-triage]] (capability: `triage`)) for the report.

1. **Target and input-surface identification** — first make clear "what to fuzz, and where the input enters" (see pitfall 1):
   - Target shape: local file parsing (image/compression/document/custom format), a network service (a listening port that receives packets), a library function (a parse API that gets called), a command-line tool (argv/stdin)
   - Input surface: the fuzz input channel (file / file contents / network packet / stdin / argv) and the parse-entry function
   - First look: `file` / `strings` / entropy / checksec ([[re-triage]] (capability: `triage`)); statically locate the parse entry ([[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) base, [[re-ghidra]] (capabilities: `decompilation`, `debugging`) decompiles to find the main processing function)
   - Decision: fuzz engine and instrumentation method (source can be instrumented / no-source QEMU mode). See the "selection tree"
2. **Coverage-guided fuzzing → [[re-fuzzing]] (capability: `fuzzing`)** — instrument + corpus + run:
   - Source available: AFL++ compiler wrapper + ASAN build (`afl-clang-fast -fsanitize=address`); write a harness for a library function; no source uses `-Q` (QEMU mode)
   - Initial corpus (the smallest valid sample, deduped with `afl-cmin`). Run `afl-fuzz` as several instances (`-M main` / `-S secondary`)
   - Coverage monitoring (afl-cov / afl-whatsup). Watch paths grow. Add a dictionary / structured input to speed up
3. **Crash analysis → [[re-crash-triage]] (capability: `debugging`)** — handle a crash as soon as it appears:
   - Deterministic reproduction (the same input crashes again every time). Read the ASAN report (heap overflow / out of bounds / UAF / double-free)
   - Minimize the input (afl-tmin / afl-cmin) → minimal PoC
   - A non-deterministic crash is recorded and replayed with rr
4. **Reverse-engineering location ([[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) base)** — translate the crash into the vulnerability root cause:
   - [[re-triage]] (capability: `triage`): sha256 the crash input for evidence + record the target baseline
   - [[re-ghidra]] (capabilities: `decompilation`, `debugging`; or [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`)): frames with no symbols in a gdb backtrace are filled in by decompilation (see pitfall 5). Locate the crashing function and the input data flow
   - Confirm: which logic the out-of-bounds / dangling access is in, whether the input is controllable, and whether the path is really reachable (see pitfall 3)
   - A crash core (the process is already dead / a core dump already exists) → [[re-memdump]] (capability: `memory-dump`) analysis
5. **Report**:
   - Record: crash type, reproduce command, minimal PoC (file + sha256), root cause (function/line/offset), reachability analysis, impact (out-of-bounds read/write, RCE/DoS), fix suggestion
   - Product: the PoC / crash features can go into [[re-ioc]] (capability: `threat-intel`)

## Which atomic skill to use (selection tree)

Branch by the target's input shape / current state:

- **Local file parsing** (the input is one file: an image/compression/document/custom-format parser) → [[re-fuzzing]] (capability: `fuzzing`) uses **AFL++** (source instrumentation + ASAN; no source uses `-Q` QEMU mode)
- **Library function** (the target is a library API, such as libpng's `png_read_*`, or a custom parser function) → [[re-fuzzing]] (capability: `fuzzing`) uses **libFuzzer** (`-fsanitize=fuzzer,address` + a fuzz-target harness), or an AFL++ persistent-mode harness
- **Network service** (listening port, protocol parsing) → network fuzz: [[re-netcap]] (capability: `network-capture`) captures real traffic as seeds, and a harness replays them into the parse function (see pitfall 5 of [[re-fuzzing]] (capability: `fuzzing`)). What you fuzz is the parser, not the network stack
- **An existing crash / crash input** (no need to rerun fuzz) → go straight to [[re-crash-triage]] (capability: `debugging`): deterministic reproduction → minimize → locate
- **The crash is located and you need to read function logic** → the [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) base ([[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`))
- **The crash is a core file** (the process is already dead) → [[re-memdump]] (capability: `memory-dump`) analyzes the core, then reverse as needed
- **The target has no input parsing (pure algorithm / pure logic)** → fuzz is a poor fit. Symbolic execution is better ([[re-angr]] (capability: `symbolic-execution`) / [[re-z3]] (capability: `constraint-solving`))

## Related skills

- **Base [[re-binary-core]]**: step 4 reverse-engineering location always calls it ([[re-triage]] first look and evidence / [[re-ghidra]] decompilation location / [[re-ida]] / [[re-radare2]]). The static stages ①-⑤ of this gateway all land on the base skills (spec 2.4: crash-sample location = re-vuln → re-binary-core + re-memdump)
- **Crash core → [[re-memdump]]**: when the process is already dead / a core dump already exists, crash-sample analysis uses a memory dump and core extraction
- **CTF pwn → [[re-ctf]]**: fuzzing / crash analysis of a pwn challenge is handed to this gateway. A challenge binary uses this gateway's flow the same way
- **Dynamic-execution sandbox**: fuzzing / reproducing a crash is dynamic execution. Default to running inside [[re-sandbox]] (top rule in [[re-analyze/platform-tips]])
- **Network target**: [[re-netcap]] captures packets as seed corpus and to confirm the input surface
- **Entry dispatch**: this gateway is dispatched by [[re-analyze]] on trigger words (vulnerability hunting / fuzz / crash analysis). triage is already wired explicitly
- **Product**: PoC hash / crash features / vulnerability fingerprint can go into [[re-ioc]]

## Pitfalls

- **Starting the run before the target / input surface is identified well enough**: symptom — fuzz runs for days with zero crashes, or every crash is in unrelated code; cause — the input channel / parse entry is wrong (for example fuzzing a network program as a file parser, so the core parse logic is never covered); fix — step 1 statically confirms the parse entry first ([[re-ghidra]] decompiles to find the main processing function), the harness connects directly to the parse function, and [[re-netcap]] captures real traffic to verify the input surface
- **A crash ≠ a vulnerability**: symptom — the out-of-bounds / UAF reported by ASAN is on a dead-code branch, or the crash was introduced by the harness itself; cause — a fuzzer being able to trigger it does not mean it is really reachable or exploitable; fix — step 4 of [[re-crash-triage]] does a gdb backtrace + [[re-binary-core]] decompilation to confirm the crash path is really reachable and the input is controllable. Separate a harness bug from a target bug
- **No instrumentation means no coverage**: symptom — execs climb fast but paths do not move, and no new crash ever appears; cause — the target was not instrumented (a release binary, or a wrong argument fuzzed an unrelated program); fix — [[re-fuzzing]] uses `afl-showmap` to verify coverage changes. With no source, switch to `-Q` QEMU mode
- **Crash dedup is missing**: symptom — tens of thousands of crash files for the same bug drown the analysis; cause — every mutated input was saved to disk, and they were not separated by crash site; fix — minimize with afl-tmin + merge by ASAN type / backtrace (see [[re-crash-triage]])
- **Missing symbols make location hard**: symptom — gdb `bt` is all `??`; cause — stripped symbols / static linking; fix — record the module base and offset, and fill frames with [[re-ghidra]] decompilation (the [[re-binary-core]] base)
