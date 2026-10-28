---
name: re-binaryninja
description: >
  Binary Ninja workflow: MLIL, script API. Triggers: Binary Ninja, binaryninja, bn, MLIL
capabilities: [decompilation]
---

# Binary Ninja reversing workflow

## When to use / when not to use

- Use: you need MLIL intermediate language (much more readable than raw disassembly) to read function logic; Python-script automated annotation/batch processing; selection by budget (personal edition / commercial edition)
- Use: you need a DFG data-flow graph (visualizing register/constant propagation paths) to trace where a single piece of data goes (a key, a flag)
- Use: a multi-architecture target (common architectures such as x86/ARM/MIPS/RISC-V/PowerPC are all supported; mobile/embedded targets can be analyzed directly)
- Use: as the decompiler when `RE_DECOMPILER=binaryninja`
- Do not use: you already have a Ghidra/IDA workflow and no reason to switch (per the `RE_DECOMPILER` session variable, [[re-ghidra]] is the default)
- Do not use: fast pure-CLI analysis ([[re-radare2]] is lighter); the simplest headless batch case (the [[re-ghidra]] analyzeHeadless ecosystem is more mature)
- Do not use: a target whose work is mainly dynamic debugging (BN's built-in debugger is experimental — debugging goes to [[re-gdb]] / [[re-x64dbg]] / [[re-lldb]])
- Do not use: large-scale headless automation on the personal edition (headless is a commercial-edition capability; see [[gotchas]])

## Tool preparation

See [[re-analyze/platform-tips]] — Binary Ninja static analysis can skip the sandbox; when a script triggers dynamic execution, it defaults to inside the sandbox.

### Binary Ninja (commercial, with a personal edition)

- Download/purchase: the binary.ninja site (Commercial / Personal; the personal edition is personal use only, and automation and some features are limited by edition; there is also a free Free tier)
- Free edition: no API or plugin access, and IL is limited; supported architectures are x86 / x86_64 / armv7+Thumb2 / armv8 — when you need MLIL or script automation, move up a tier by budget
- Windows: run the installer directly; macOS: `brew install --cask binary-ninja` (community cask; you need an existing license); Linux: unpack the official tar and run `./binaryninja`
- Container formats: import PE/ELF/Mach-O/Dalvik/firmware ROM and similar directly (no separate unpack step); a packed target is the exception (the packer section is not decrypted; unpack first)
- Verify: open any sample, finish automatic analysis, and the `Functions` panel has a function list; `Options > About` shows the license type
- Linux with no graphics environment: the GUI build needs an X display (`xvfb-run ./binaryninja` can run it temporarily); batch jobs go straight to headless (commercial edition), and headless does not need a display
- Version differences: 6.x is the current mainline; from 6.0 the plugin manager is rebuilt as Extension Manager (the old `pluginmanager` is only a shim), bundled Python rises to 3.13 (covering Linux for the first time) while external Python is still 3.10 minimum — 2.x → 3.x → 4.x → 6.x have breaking API changes between major versions, so a script dependency first checks `core_version()` and the release notes (see [[gotchas]])

### binaryninja Python API

- Install: run `python install_api.py` in the Binary Ninja install directory (registers the API into the Python environment; PyPI has no binaryninja package, and `pip install binaryninja` fails)
- The install script detects/prompts for a matching Python version — on a version mismatch the script errors or registration fails; switch Python versions as prompted
- Verify: `python3 -c "import binaryninja; print(binaryninja.core_version())"` prints a version number consistent with the software version
- Headless batch (commercial edition): there is no `binaryninja-headless` executable — the proper path is to write a script with `binaryninja.load()` after `install_api.py` registers it (see [[commands]] sequence 2); a headless license uses the official standalone download package (no GUI; only a headless license can download it)

## Procedure

1. **Import and analyze**:
   - `File > Open` selects the sample → automatic analysis (the progress bar at the bottom) → confirm the analysis result in the left `Functions` / `Data` / `References` views
   - Confirm: the entry function (entry) is identified, the import table (the `Imports` view) has contents, and strings (the `Strings` view) are visible
   - Abnormal analysis (few functions / garbled strings) → it may be packed; do [[re-packer-id]] / [[re-anti-analysis]] first
   - Analysis options: `Options > Analysis` checks/unchecks passes — look here first on a first import of a large file or an obfuscated sample; turning everything on by default is slow

2. **Read MLIL (switch the IL view)**:
   - Double-click a function to enter the decompile view (HLIL, high-level IL, by default); `i` cycles disassembly/LLIL/MLIL/HLIL, or pick the IL level from the bottom-right `Options` menu
   - MLIL features: variables are explicit (`rax = rax ^ 0xdeadbeef`), types are recovered, and conditional branches are semantic — more readable than raw disassembly; read MLIL on a key function before concluding
   - MLIL example (disassembly vs MLIL): `cmp eax, 0x1337 / jne L1 / mov byte [rdi], 1 / jmp L2 / L1: mov byte [rdi], 0 / L2: ...` → MLIL presents `if (rax == 0x1337) *(uint8_t*)rdi = 1; else *(uint8_t*)rdi = 0;` directly — reading the logic does not require following jumps one by one
   - When the decompile is unclear, drop down: MLIL → LLIL (`View > IL > LLIL`, low-level IL, keeping instruction-level detail) → disassembly (the `Space`/assembly view) and cross-check layer by layer
   - Note: the `m` key in Binary Ninja is "apply an enumeration display to an integer", not an MLIL switch — switch IL with `i`

3. **Rename / types**:
   - Rename: with the cursor on a symbol/variable, `n` (or right-click Rename) — functions, variables, and global data all work
   - Change a type: `y` (for example `void *`, `DWORD`, `int (*)(void *, size_t)`); type propagation automatically improves later decompile quality
   - Define a struct: create a Structure in the `Types` panel → apply it to a variable/pointer → field names enter the decompile view with type propagation
   - Other type shortcuts: `o` sets a pointer reference, `a` sets a character array, `d` cycles integer width, `*` builds an array (see the [[commands]] shortcut table)

4. **Python scripts (automated annotation)**:
   ```python
   import binaryninja
   bv = binaryninja.load("sample.bin")
   bv.update_analysis_and_wait()          # headless mode: trigger a full analysis by hand
   for f in bv.functions:
       if f.analysis_skip_reason is None and f.medium_level_il:
           n = len(list(f.medium_level_il.instructions))
           if n > 200:
               print(f"big function: {f.name} @ {hex(f.start)} len={n}")
   ```
   - Batch rename: `bv.get_function_at(0x401000).name = "check_license"` then `bv.save()` writes it back
   - Export decompile text: `str(f.high_level_il)` takes the HLIL pseudocode string directly — the fastest way to batch-export function logic
   - Plugins: 6.x manages them through Extension Manager (the old `File > Manage Plugins` duty was merged into it); plugin directories by platform: Windows `%APPDATA%\Binary Ninja\plugins`, Linux `~/.binaryninja/plugins`, macOS `~/Library/Application Support/Binary Ninja/plugins` (macOS is not `~/.binaryninja`; the wrong place is not loaded)
   - Try a hand-written script first in the `File > Python` panel (you can see `print` output and exceptions), and only after it is stable turn it into a plugin or a headless script — debugging a script is much faster than looking at the result after it finishes
   - Headless mode: the commercial edition can use headless — there is no `binaryninja-headless` CLI; the proper path is a script after `install_api.py` registers it (`binaryninja.load()` + `update_analysis_and_wait()`, the code structure above); a headless license uses the official standalone download package; when the personal edition is limited, run the same code in the GUI `File > Python` panel
   - A headless script error does not pop a dialog — exceptions go straight to stderr/the log file; debug from the tail of the output and `bv.log_info` traces

5. **String/reference location chain**:
   - Find a prompt string in the `Strings` view → double-click into disassembly → right-click `Show References` (or the `xrefs` panel) → jump to the referencing function → read MLIL
   - When there are many strings, sort by reference count/length (click the column header) and handle strings referenced from many places first — they are usually key nodes such as error prompts / format strings
   - Same idea as Alt+T→x→F5 in [[re-ida]] and izz→axt→pdf in [[re-radare2]]; batch annotation uses `bv.get_strings()` + `f.get_callers()` scripts (see [[commands]] sequence 2)

6. **DFG data-flow graph (trace one value's flow)**:
   - In the MLIL/HLIL view, right-click an instruction → `Show DFG` — the variable/constant propagation path graph starting from that instruction
   - Case: trace the full path of a key/flag from load to compare; a DFG is faster than reading MLIL line by line, and fits "where did this value come from / where did it go"
   - Cross-check call boundaries with `x` / right-click `Show References`; `Esc` in the DFG view returns to the original view

7. **Evidence check (wrap-up)**: renames/types/comments are persisted with `bv.save()`; headless export artifacts (function inventory / HLIL text) are checked against the [[re-triage]] survey values; write key conclusions into [[re-analyze/analysis-contract]] — annotations must be recoverable into a report, not left only in the project

8. **Cross-check (several decompilers corroborate each other)**: decompile the same function with [[re-ghidra]] / [[re-ida]] (if available) and compare — when MLIL and Ghidra pseudocode have the same structure, the conclusion is more trustworthy; when they differ a lot, go back to LLIL/assembly and cross-check, and prefer assembly-layer evidence

6. **Compare and choose (price / plugin ecosystem)**:
   - Price: Binary Ninja (commercial paid; the personal edition is cheaper but limited to personal use) vs [[re-ida]] (the most expensive) vs [[re-ghidra]] (free and open source) vs [[re-radare2]] (free and open source CLI)
   - Ecosystem: the Ghidra community is the largest and its scripts (Java/Python/headless) are the most mature; IDA idapython plugins have the longest history; Binary Ninja has fewer plugins but a modern API design (Python first)
   - Decision: budget-sensitive → Ghidra/radare2; you want MLIL readability + a Python API → Binary Ninja; you already have an IDA license → stay on IDA, and use this skill only when switching stacks

## Cross-domain joins

- [[re-binary-core]]: an alternative decompiler at workflow step 5 (`RE_DECOMPILER=binaryninja`)
- [[re-ctf]]: reversing-challenge decompile and scripted solving
- [[re-malware]]: deep analysis of a malware sample (Python batch annotation export)
- [[re-cracking]]: recover a license/check algorithm
- [[re-kernel]]: an optional tool for driver decompilation (one of three with [[re-ghidra]] / [[re-ida]])
- [[re-android-native]] / [[re-ios]]: MLIL readability is clearly valuable when analyzing a mobile native library (ARM64 instructions + few symbols)
- [[re-game]]: an optional tool for a game binary (decompile + scripted batch annotation)
- There is no direct project interchange format with [[re-ghidra]] / [[re-ida]]; when switching stacks, move annotations by hand per function or unify them with a script

## Common pitfalls

- **MLIL distorts obfuscated code**: symptom — a junk-instruction / control-flow-flattened sample decompiles into a bizarre structure (dead code, a constantly-false condition); cause — MLIL is rebuilt from data flow, and obfuscation destroys control-flow information; fix — drop to LLIL/assembly and cross-check, or do [[re-deobfuscate]] before import
- **Script API version differences**: symptom — `import binaryninja` reports a version error / behavior does not match the docs; cause — the pip package does not match the installed software's major version (API major versions are incompatible); fix — rerun `install_api.py` in the install directory to align versions, and compare `core_version()` with the About version
- **Headless-mode usage**: symptom — `binaryninja.headless` does not exist on the personal edition; cause — headless automation is a commercial-edition capability and is cut from the personal edition; fix — on the personal edition, run scripts in the GUI `File > Python` panel, or in a script only do the alternative path of `load` + `update_analysis_and_wait`
- **A large binary's first analysis is slow / memory is high**: symptom — a 100MB+ sample takes several minutes or even hangs; cause — every default analysis pass is on; fix — turn off extra passes in `Options > Analysis` (for example keep only the minimum set that dataflow and decompile need), or analyze only key functions (the `f.analysis_skip_override` approach)
- **The result does not change after a patch (forgot to reanalyze)**: symptom — `bv.write` changed bytes, but the decompile output is still the old one; cause — the analysis-result cache was not invalidated; fix — after the edit, call `bv.update_analysis_and_wait()` to force reanalysis, or reload
- **The project database is separate from the sample**: a `.bndb` project database saves every annotation, and the sample itself does not change — when distributing annotations, send the .bndb (watch version compatibility), and do not expect the sample to carry the annotations; writing bytes back into the sample is a different matter (in a script, `bv.write` + save follows the official patch flow)
- **Wide-character / UTF-16 strings are garbled**: symptom — Chinese / wide strings in the `Strings` view display as garbage or split; cause — the data-variable width was judged wrong; fix — select the data and right-click to set a 2-byte width (or change the type in a script after `bv.get_data_var_at`), then trigger analysis again
- Version differences, plugin/headless details, and the shortcut cross-check: [[gotchas]] / [[commands]]
