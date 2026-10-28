---
name: re-ghidra
description: >
  Ghidra workflow: import → auto-analysis → decompile → script.
  Triggers: Ghidra, `反编译`, headless
capabilities: [decompilation, debugging]
---

# Ghidra reversing workflow

## When to use / when not to use

- Use: you need decompilation and deep static analysis; headless batch processing; scripted auto-annotation / decrypt-loop emulation; PE/ELF/Mach-O are all supported
- Do not use: memory under 4GB (it stutters from startup; switch to [[re-radare2]]); you only need a quick triage (go to [[re-triage]])
- Do not use: you already have an IDA workflow and the target is clear (choose by the `RE_DECOMPILER` session variable)

## Tool setup

See [[re-analyze/platform-tips]] — Ghidra is the main static-analysis tool (skips the sandbox); a low-memory environment switches to [[re-radare2]] per platform experience; headless batch fits a remote environment.

### Ghidra (official install, Java 21 required)

- Download: GitHub `NationalSecurityAgency/ghidra` releases; unzip and use (no install)
- JDK 21 (required by Ghidra 11.3+):
  - Linux: `apt install openjdk-21-jdk` / `dnf install java-21-openjdk` / `pacman -S jdk21-openjdk`
  - macOS: `brew install openjdk@21` or `brew install --cask temurin`
  - Windows: `choco install temurin21` (or Oracle JDK 21)
- Start: `./ghidraRun` (GUI) / `./support/analyzeHeadless` (headless)
- Verify: `java -version` (must be 21+); `./support/analyzeHeadless -help` prints normally
- Version: 12.x is the current main line (verification baseline 12.1.4); at install time trust Latest on the official Releases; running an official release needs only JDK 21; building Ghidra itself from source needs JDK 25 + Gradle 9.1+; 11.x → 12.x has breaking script API changes; check the target version's javadoc before writing a script; details in [[gotchas]]

### ghidra-bridge (Python remote control)

- All platforms: `pip install ghidra-bridge`
- Prerequisite: run `ghidra_bridge_server.py` from Script Manager in the Ghidra GUI
- Verify: `python3 -c "import ghidra_bridge; print(ghidra_bridge.__version__)"`

## Procedure

1. **analyzeHeadless headless import + analysis**:
    ```sh
    $GHIDRA/support/analyzeHeadless /tmp/proj sample_proj \
      -import ./sample.bin -deleteProject -log /tmp/ghidra.log
    ```
   Add `-overwrite` when you only want to build a project with no interaction; batch several samples by calling it in a loop. Watch the log with `-log`; analysis-complete mark: no exception, and the project can be re-imported.
   - `-process` mode (rerun a script/analysis on files already in an imported project; mutually exclusive with `-import`):
      ```sh
      $GHIDRA/support/analyzeHeadless /tmp/proj sample_proj \
        -process -postScript MyScript.java -scriptPath /tmp/scripts
      ```
   - When you only want symbols/strings/single-function decompilation, add `-noanalysis` (skip auto-analysis; finishes in seconds); add `-readOnly` for a read-only recheck; the full parameter family is in [[commands]]

2. **GUI: navigate / cross-references / decompile**:
   - `File > Import File` → select the sample → `Analyze` (wait for the lower-left progress to finish)
   - Jump: `Go To` (G) and enter an address; the entry point is already marked `entry` in Program Trees
   - Cross-references: with the cursor on a function/variable, press `R` (References window), or right-click > References > Show References To
   - Decompile: in Listing press `Ctrl+E` (Decompiler window; the default shortcut may differ by version/keymap; trust Help > Key Bindings) or right-click > Decompile Function; the decompiler view can be copied
   - Function graph: on a function press `F` (Function Graph) to see branch/loop structure, navigating in sync with the Decompiler
   - Underscore address difference: Listing shows VA (including ImageBase); scripts commonly use `getAddressFactory().getDefaultAddressSpace().getAddress("0x401000")`

3. **Rename + type-propagation marks**:
   - Rename a function: `L` in Listing; rename a variable: `L` in the Decompiler
   - Set a type: right-click a variable > Set Data Type (`y`), such as `char *`, `DWORD`, `int (*)(int)`
   - Define a struct: Data Type Manager > new Structure; after it is referenced in the Decompiler, type propagation automatically improves decompilation quality
   - Mark a known library function: right-click > Set Data Type + `f` (Function signature), which improves argument semantics at later call sites

4. **Python scripts (auto-annotation, decrypt-loop emulation)**:
    ```python
    # @category Analysis  — 放 GhidraScripts 目录，Script Manager 中 Run
    from ghidra.program.model.listing import CodeUnit
    fm = currentProgram.getFunctionManager()
    for f in fm.getFunctions(True):
        body = f.getBody()
        if body.getNumAddresses() > 10000:
            print("large:", f.getName(), hex(body.getMaxAddress().getOffset()))
    ```
   Decrypt loop: after locating an XOR loop, the script patches or computes directly:
    ```python
    from ghidra.program.model.mem import *
    fm = currentProgram.getFunctionManager()
    f = fm.getFunctionAt(currentAddress)
    # 示例: 从 0x403000 起 0x100 字节异或 0x55
    addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x403000")
    for i in range(0x100):
        b = getByte(addr.add(i)) ^ 0x55
        setByte(addr.add(i), b)
    ```
   - **Copy before changing bytes**: `setByte` writes the current Program directly (saving changes the original file) — analyzing a malicious sample must first copy the Program (`File > Save As` to a separate copy) or operate on a temporary copy; do not patch the original sample directly, or the evidence chain is destroyed
   Headless batch: `analyzeHeadless ... -postScript MyScript.java -scriptPath <dir>`

5. **Export decompiled C**:
   - `File > Export Program` → format `C/C++`, export the whole decompilation tree
   - Or `Copy` function by function from the Decompiler window into notes
   - **What is exported is the decompilation result, not recovered original source**: variable names / type inference may be wrong (they improve only after renaming), and it does not represent the original implementation — use it only as a reading aid; key logic must be verified against disassembly/Listing
   - After export, check: unnamed function names in the C keep a comment (the function address); compare with the original Listing

## Function-analysis context checklist

Before analyzing each function, collect (see the context checklist in [[re-analyze/analysis-contract]]): xrefs (who references it / what it references), strings referenced by the target function, caller/callee signatures, the named-symbol table, recovered structs. Give all of it at once before analyzing, so you do not keep flipping xrefs; actively requesting extra evidence stays under 8 tool calls per function.

## Single-function deep-analysis order

Advance in the five steps of "single-function deep-analysis order" in [[re-analyze/analysis-contract]] (types → constants → vtables → identity → decompilation; do not skip steps; do not decompile first and reason backward). Corresponding operations in Ghidra: types use Type Manager / Apply Function Signature, vtables use vtable analysis, and symbol/constant evidence can be assisted by readelf / strings / objdump exports.

## Cross-domain joins
- [[re-address-space]]: convert between a Ghidra base and a runtime address (load bias)

- [[re-binary-core]]: workflow step 5 default decompiler
- [[re-malware]]: deep analysis of a malicious sample (obfuscation-script annotation)
- [[re-ctf]]: main tool for reversing challenges
- [[re-firmware]]: decompile firmware ELF components
- [[re-mobile]]: analyze an app .so library
- Read structure together with [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]; a low-memory environment uses [[re-radare2]]

## Common pitfalls

- **Auto-analysis misses obfuscated code**: junk instructions / scrambled code segments may not have been disassembled — manually select the segment and force-mark with `C` (code); if needed, repair the function boundary (right-click > Create Function)
- **Wrong Java version fails to start**: `UnsupportedClassVersionError` → confirm `java -version` is 21+, and `JAVA_HOME` points at the right JDK
- **Stutter under 4GB of memory**: analyzing a large binary exhausts memory → switch to [[re-radare2]] or shrink the analysis scope (`-analysisTimeoutPerFile`)
- headless default analysis options differ from the GUI (some optional items are missing) → explicitly run an analysis script with `-postScript` to keep them consistent
- **Large-file auto-analysis hangs**: Symptom — after importing a large binary, auto-analysis does not finish for a long time / the UI freezes; cause — large-file hang triggers = indirect-call explosion / large C++ RTTI / obfuscated control flow / a large data segment; fix — first shrink auto-analysis scope (limit/disable indirect-call and RTTI analysis options), locate the entry/strings/cross-references first and then expand step by step; see the static-first principle in [[re-analyze/platform-tips]]
- **Abnormal function boundary → check decompiler illusions**: Symptom — in the decompiler view a function is wrongly split/merged, fake arguments appear or stack variables are scrambled, and the function body looks like garbage data, so analysis from it yields absurd logic; cause — hand-written assembly, obfuscated code, a tail call (a tail call wrongly merges adjacent functions), and no frame pointer (not using rbp/ebp distorts frame inference) make the decompiler's boundary and frame inference wrong; fix — first check Listing assembly against the real bytes, manually correct the boundary with `C`/Create Function, and for a tail-call or no-frame-pointer function trust assembly semantics and do not fully trust decompiler output (see [[re-binary-core]] analysis methodology R4)
- **The built-in script interpreter is Jython 2.7, not Python 3**: Symptom — a script immediately reports `SyntaxError` (f-string/walrus operator) or `ImportError` (cannot find a pip-installed third-party library); cause — Ghidra's built-in Jython 2.7 is Python 2 syntax and standard library; it does not support Python 3 syntax and cannot import pip-installed packages; fix — write scripts in Python 2 compatible syntax (no f-string; use `xrange`); when you need modern Python capability (numpy and similar), switch to ghidra-bridge so an external Python 3 interpreter drives the analysis (see Tool setup)
- **Wrong script/extension choice → automation maintenance cost runs away**: Symptom — one-shot batch logic gets more complex with every write, triggering it by hand every time is annoying, or you need always-on automation but keep clicking a script by hand; cause — the boundary between Script (a script: lightweight single file, manual trigger, suited to one-shot / simple repeated tasks) and Extension (an extension: can register menus/panels/event listeners, runs automatically when the project loads, ZIP-packaged for team distribution) was not drawn; fix — a simple repeated task uses a script and is done; build an extension only when you need UI integration, an external service, automatic execution on load, or standardized team distribution

- **Script API is incompatible across versions**: Symptom — a headless script fails to compile (skipping, and reports that a method such as `getPermissions()`/`getExecute()` does not exist); cause — APIs such as MemoryBlock changed across Ghidra versions (12.x is `isExecute()`; method names differ by version); fix — check the current version's javadoc before writing a script (a small verification script); if compilation fails, suspect an API difference before business logic
- **If full analysis is too slow, use -noanalysis**: when you only want the symbol table / strings / single-function decompilation, after `analyzeHeadless -noanalysis` import the script can be used directly — symbols (including JNI exports) and string scan do not depend on auto-analysis, and finish in seconds
- The command cheat sheet (headless parameter family / GUI shortcut family / script API family) is in [[commands]]; more pitfalls on version differences, headless batch, and the script API are in [[gotchas]]
