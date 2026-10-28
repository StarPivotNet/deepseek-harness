# IDA tool-specific pitfalls and boundaries

## Version differences (7.x / 8.x / 9.x)

- **Database format**: from IDA 7.5 on, `.i64` is unified (one format for 32/64-bit); 7.4 and earlier used 32-bit `.idb` and 64-bit `.idb64` — opening an old database the first time runs an upgrade, and the upgrade cannot be rolled back. Back up important databases first
- **Host OS**: from IDA 8.x on, only a 64-bit host is supported (there is no 32-bit installer); Linux needs the Qt runtime libraries. Headless mode does not need a graphical environment
- **IDA 9.0 (2024)**: 32/64-bit installs are merged (there is no separate IDA32); a new FLIRT signature manager (download signatures online); new idalib (call the C++/Python API outside IDA for headless processing); Python 3.8–3.13, switched with `idapyswitch` (3.13 from 9.0 SP1)
- **IDAPython 8→9 breaking changes**: `get_struc` / `get_member` / `ida_typeinf.get_ordinal_qty` and others were removed. Struct APIs moved to `tinfo_t` / `til_t`; `idautils.StructMembers` now returns a triple — compare old plugins/scripts with the migration guide (idapython-porting-guide-ida-9) before running them
- **Hex-Rays versions**: pseudocode output changes with the version (from IDA 9, x64 MSVC exception handling can decompile to try/catch) — different versions emit different output for the same function. When cross-checking across versions, name the version

## IDA Free boundaries

- **x86/x64 only**: the analyzer does not support ARM/MIPS and other architectures; cloud decompilation also covers only x86/x64
- **No local Hex-Rays**: disassembly + idapython only; cloud decompilation is a paid per-function quota
- **Debugger is local x86/x64 user-mode only**: no remote debugging, no kernel debugging; anti-anti-debug is weaker than the commercial build
- **No plugins / no FLIRT extensions**: third-party plugins cannot be installed (decompiler-plugin class is unavailable); FLIRT can use only the bundled sigs
- Conclusion: IDA Free is positioned as "disassembly + scripting". If you need decompilation, go straight to [[re-ghidra]]

## Headless batch pitfalls

- **No `auto_wait()` produces an empty set**: under `-A` the script runs in parallel with auto-analysis. Call `ida_auto.auto_wait()` before walking the function list
- **No `qexit` and the process hangs**: the script finishes and does not exit, so CI/batch jobs stall — `idc.qexit(0)` (alias `ida_pro.qexit(0)`)
- **A log that never hits disk is hard to debug**: `-L"ida.log"` writes the IDA log; script print goes to the output window, not a stdout file (redirection does nothing)
- **Modifying scripts are irreversible**: run on a copy of the .i64 first, verify read-only, then write the database (see SKILL.md pitfalls 5/6)
- **`-A` vs `-c`**: `-c` forces a re-analysis (discards existing analysis results); re-running a script on an existing .i64 without `-c` keeps the old analysis
- **A legitimately empty product**: when exporting only non-library functions, a small binary with no user code producing 0 functions is legitimate — judge with two channels, "log keywords + product count"

## Anti-debug and dynamic-debug boundaries

- **Debugger features are detectable**: the IDA debugger has default markers (process name / window class / module features) that a sample can enumerate — locate the checks statically (`IsDebuggerPresent` / `NtQueryInformationProcess` xrefs) and then handle them; see [[re-anti-analysis]]
- **PPL / protected processes cannot be attached**: a Windows kernel-protected process is beyond IDA user-mode debugging. Switch to kernel debugging ([[re-windbg]]) or give up
- **TLS callbacks / logic before the entry**: when debugging starts it stops at the system breakpoint, and pre-entry logic may already have run — when needed, enable event breakpoints in the debugger options
- **wow64 targets**: a 32-bit sample running on a 64-bit system shows an x64 context in the stack/register view — switch to the x86 view, or use [[re-x64dbg]] (x32dbg), which is less work

## Large binaries and performance

- Auto-analysis fully on is extremely slow on a 100MB+ binary: `Options > General > Analysis` turns off nonessential passes such as constant propagation; manually `MakeCode` / `MakeFunction` only on the segments that matter
- Headless is faster than the GUI but uses more resources (multi-core analysis fully on) — queue batch jobs. Do not open several at once

## Usage notes

- Execute entirely inside a sandbox (top principle in [[re-analyze/platform-tips]]); dynamic debugging uses the default sandbox
- Scripts / plugins / databases are tightly bound to the IDA version — on a version change, first run `idaapi.IDA_SDK_VERSION` from `File > Script command` to confirm
