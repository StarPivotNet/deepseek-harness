---
name: re-ida
description: >
  IDA workflow: import → FLIRT → Hex-Rays → idapython.
  Triggers: IDA, Hex-Rays, idapython
capabilities: [decompilation, debugging]
---

# IDA reversing workflow

## When to use / when not to use

- Use: you already have an IDA license or IDA Free, and the target needs FLIRT library identification, Hex-Rays decompilation, or idapython batch processing
- Use: large-scale repetitive annotation/export (headless batch `idat -A -S`; sequences in [[commands]])
- Do not use: IDA Free cannot handle it (no Hex-Rays → fall back to [[re-ghidra]]); you only need a quick conclusion ([[re-triage]])
- Do not use: a memory-constrained environment (a large binary stalls; switch to [[re-radare2]]); a quick pure-CLI analysis ([[re-radare2]] is lighter)
- Do not use: dynamic debugging of a macOS/Linux target ([[re-lldb]] / [[re-gdb]]); the IDA debugger is most valuable on a local Windows target

## Tool setup

See [[re-analyze/platform-tips]] — static analysis needs no sandbox; when the IDA debugger is used for dynamic debugging, run inside the default sandbox under the top principle.

### IDA (commercial / free)

- Download: hex-rays.com (IDA Free supports x86/x64; other architectures and analyzers need the commercial build)
- Windows: run the installer directly; `choco install ida-free` (community package, or download manually from the site)
- macOS/Linux: unpack the official tar and run `ida` (Windows counterpart `ida.exe`; headless uses `idat` / `idat.exe`)
- Verify: after start, a sample opens and finishes auto-analysis, and the functions window has content; `idat --help` produces output; a headless trial `idat -A -L"t.log" /bin/true` exits normally
- Version differences: from 7.5 the database is unified as `.i64` (old `.idb` / `.idb64` can be upgraded); 8.x needs a 64-bit host; from 9.0 the 32/64-bit install is merged, with a built-in FLIRT signature manager and the idalib headless API — **9.x executables no longer have a 64 suffix** (`ida` / `idat` is one binary that handles 32/64-bit). Only IDA ≤8.x splits `ida` / `ida64` and `idat` / `idat64` — details in [[gotchas]]

### idapython (built in)

- IDA 6.8+ ships a Python environment; nothing extra to install. IDA 9 uses `idapyswitch` (IDA root) to switch the external Python (3.8–3.13)
- Verify: menu `File > Script command` (Shift+F2) runs `print(idaapi.IDA_SDK_VERSION)` and prints the version

### FLIRT signature library

- IDA ships a `sig/` directory (flair). After you apply signatures, library functions are annotated automatically. IDA 9's signature manager can download more signatures online
- Verify: after applying signatures to a known libc program, `_init` / `malloc` and similar are marked as library functions

## Procedure

1. **Import and auto-analysis**:
   - `File > New`, pick the sample → wait until the lower-left `AU: analyzing` finishes (no AU text and the analysis log has stopped)
   - Confirm Auto-analysis is on under `Options > General > Analysis`; confirm `segments` and `entry point` were identified
   - Headless batch: `idat -A -S"myscript.py" -L"log.txt" sample` (`-A` is auto mode; on Windows use `idat.exe`)
   - A headless script starts with `ida_auto.auto_wait()` to wait for analysis and ends with `idc.qexit(0)` to exit — without those two lines you get an empty function list or a hung process

2. **FLIRT library-function identification**:
   - `File > Load file > FLIRT signature file...` and pick the matching `.sig` (MSVC: `mssdk`, `vc64rtf`, and similar; GNU: the `libstdc++` series)
   - After identification, library function names are applied automatically. In the functions window, library functions (light color) separate from user functions — focus on the non-library functions
   - Match failure (packed / obfuscated library) → the packer or a custom compiler is indicated. Go to [[re-anti-analysis]]

3. **Shortcut main line (everyday static analysis)**:
   - `x` cross-references; `n` rename (function/variable); `y` change type (for example `int __cdecl f(int, char*)`); `;` comment (repeatable uses `:`)
   - `G` jump to an address; `Alt+T` text search (string keywords); `Alt+B` binary search (byte pattern); `Esc` go back
   - `F5` Hex-Rays decompile; `Tab` switches between pseudocode and the assembly view
   - The full shortcut and command table is in [[commands]]

4. **Reading Hex-Rays decompilation**:
   - `F5` into pseudocode: read the function signature and locals first, then follow the call chain (double-click a call to enter, `Esc` to return) and walk the data flow
   - Rename locals/parameters to improve readability; `y` corrects the calling convention and parameter types
   - When pseudocode and disassembly disagree (structural differences from optimization), check the disassembly — decompilation is a view, not a fact
   - Algorithm / decrypt recovery: locate the loop in the decompiler output and compute key constants with idapython (sequence in [[commands]] operation sequence 3)

5. **idapython batch processing (decrypt loops / bulk annotation)**:
   ```python
   import ida_bytes, idc
   # batch patch: XOR 0x100 bytes from 0x401000 with 0x55
   base = 0x401000
   for i in range(0x100):
       ida_bytes.patch_byte(base + i, idc.get_byte(base + i) ^ 0x55)
   ```
   ```python
   # batch rename: mark the source of every unnamed import
   import ida_funcs, ida_name
   # walk functions: ida_funcs.get_func() / idc.get_func_name()
   ```
   Headless run: `idat -A -S"script.py log.txt" sample`. End the script with `idc.qexit(0)` so it exits (`idc.qexit` is an alias of `ida_pro.qexit`, consistent on IDA 7.0+).

6. **Handling IDA Free limits**:
   - IDA Free has no Hex-Rays: use disassembly + idapython (recover loops/algorithms by hand the way step 5 does), or export straight to Ghidra:
     menu `File > Produce file > Dump typeinfo` / use idb2pat to generate library signatures; or switch to [[re-ghidra]] for decompilation
   - IDA Free feature cuts: no local Hex-Rays (an x86/x64 cloud decompiler can be tried first), the debugger is local x86/x64 only, no disassembler extensions — adjust the flow to the cut scope

7. **Dynamic debugging (local Windows target, commercial build)**:
   - `F9` run, `F2` toggle breakpoint, `F8` / `F7` single-step, `Ctrl+F2` restart — same habits as [[re-x64dbg]]
   - Locate anti-debug checks (`IsDebuggerPresent` and similar) statically first, then handle them. Boundaries are in [[gotchas]]

8. **Evidence check (close-out)**: renames / comments / recovered structures are archived with the .i64 (`File > Save`; copy-backup the original database); headless export products (function list / decompiled .c) are filed against the [[re-triage]] survey values; key conclusions go into [[re-analyze/analysis-contract]] — annotations in IDA must be recoverable into the report. Do not leave them only in the database

## Function-analysis context checklist

Before analyzing each function, collect (see the context checklist in [[re-analyze/analysis-contract]]): xrefs, strings referenced by the target function, caller/callee signatures, the named-symbol table, recovered structs. Give all of it at once, then analyze. Actively requesting extra evidence is at most 8 tool calls per function.

Deep analysis follows the five-step "single-function deep-analysis order" in [[re-analyze/analysis-contract]] (types → constants → vtables → identity → decompilation). Under IDA, types use idapython `get_type` / struct definitions. Symbol/constant evidence can be assisted by exports from readelf / strings / objdump.

## Cross-domain

- [[re-binary-core]]: alternate decompiler at workflow step 5 (`RE_DECOMPILER=ida`)
- [[re-cracking]]: locating registration algorithms / check logic commonly uses IDA
- [[re-malware]]: debugging and analysis of malware samples (IDA debugger)
- [[re-plugin-dev]]: IDAPython is the plugin language; scripts → plugin engineering
- When IDA Free has no Hex-Rays, hand off to [[re-ghidra]]

## Common pitfalls

- **IDA Free has no decompiler**: IDA Free has no Hex-Rays — confirm version capability first. If decompilation is missing, go straight to Ghidra. Do not force-read the disassembly
- **Anti-debug detection**: a sample can detect the IDA debugger with `IsDebuggerPresent` / `NtQueryInformationProcess` (default debugger markers) — prefer static analysis, or use a debugger-hiding plugin (ScyllaHide class)
- **Large binaries stall**: auto-analysis fully on is extremely slow on a 100MB+ binary — turn off some analysis options (for example constant propagation) or switch to [[re-radare2]]
- FLIRT matches the real library "after unpacking" — unpack a packed sample before running signatures
- **Address-returning API results were not checked for BADADDR**: symptom — an idapython script gets an address like `0xFFFFFFFFFFFFFFFF` on some samples, and later addressing/renames are all wrong or crash; cause — IDA APIs use `BADADDR` (-1) for failure (name missing, illegal address, function missing), and the script kept using the return value without checking; fix — after every API that returns an address (`get_name_ea` / `get_func` and similar), check `== BADADDR` first. On failure, print the scene and continue. The script verifies read-only before writing the database (see the next item)
- **A modifying script is run on the original database, and a bad edit is hard to roll back**: symptom — after a batch rename/byte-patch script finishes, a pile of wrong annotations is found, and undo is painful or impossible; cause — the read-only check was skipped and the database was written directly, and it was not done on a copy; fix — the official recommendation is to run a read-only script first (print database path / architecture / function and string stats) and confirm expectations. Modifying scripts are verified incrementally (smallest script → look at output → add function). Before a bulk change, copy the .i64/.idb or run on the copy

- **Hex-Rays interr (decompiler internal error)**: symptom — headless decompilation hits a function, reports something like `interr: create_stkvar(...) dtype=7`, and the whole process crashes. Skip/retry does nothing; cause — an internal decompiler bug on a particular stack layout, unrelated to the sample/script; fix — finish that target in Ghidra (cross-checking is also better). Do not keep forcing the same function. For batch decompilation, trial a small sample first and confirm it does not trigger before the full run
- **A headless batch export did not wait for auto-analysis (silently produces 0 functions)**: symptom — `idat -A -S"export.py" sample` finishes a batch export with 0 functions or a badly incomplete set, and the log has no error; cause — under `-A` script injection and auto-analysis run asynchronously in parallel, so the script walks the function list before analysis finishes and gets an empty set, and the failure is swallowed silently; fix — before collecting functions, `ida_auto.auto_wait()` blocks until analysis ends; the export loop try/excepts per function, a single failure is only recorded (address/name/reason) and the loop continues, and the end summarizes total/exported/failed without aborting the full run. When exporting only non-library functions (FUNC_LIB flag), a small binary with no user code legitimately produces 0. Verify with two channels, "log keywords + product count", and tolerate that legitimate empty product. Compute the call graph (callers/callees) as a whole and cache it before the decompile loop. Order the export cheap to expensive (strings → imports → exports → memory → decompile), one address-named file per function
- (Source: LazyReverse (a0yami), MIT)
- IDA 9 script migration (`get_struc` and others were removed), version differences, and anti-debug boundaries: [[gotchas]]
