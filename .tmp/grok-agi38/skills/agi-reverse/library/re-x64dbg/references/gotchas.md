# x64dbg tool-specific pitfalls and boundaries

## Compatibility differences between x64dbg and OllyDbg

- **Plugins/scripts are not shared**: OllyDbg plugins (.dll/.opa) and OllyScript scripts cannot be used directly in x64dbg — x64dbg has its own plugin API and script engine (the Script view; commands are in [[commands]]). A port has to be rewritten against the new API
- **Conditional-breakpoint syntax is similar but not equivalent**: x64dbg's expression system is more complete (registers / `[memory]` / bitwise ops / string formatting). An OllyDbg `cond` condition cannot be copied as-is. Rewrite it as an x64dbg expression
- **Debug-database formats differ**: OllyDbg's .udd vs x64dbg's .dd64/.dd32 are not shared. An x64dbg database is stored per module in a same-named `.dd*` file
- **Bitness**: OllyDbg is 32-bit only. The same x64dbg package has x64dbg.exe (64-bit targets) + x32dbg.exe (32-bit targets). Do not open the wrong process (see the Windows branch of [[re-analyze/platform-tips]])

## Scylla usage notes

- **The OEP field is a full virtual address (VA), not an RVA**: Scylla auto-fills it as entry point + ImageBase. A hand fill is also a VA — filling an RVA searches the wrong place
- **You must be paused at the OEP**: a running process's memory keeps changing, and the dumped image may be bad. Stop the target at the OEP before Dump/Fix Dump
- **A wrong OEP → the log "IAT not found at OEP ..."**: IAT Autosearch fails outright or scans a pile of garbage imports — go back to the debugger, confirm the real OEP (standard function-prologue features), fill the value again, and search again
- **Normal and advanced Autosearch may differ**: normal is fast and has fewer false positives. Advanced is slow and suits obfuscated / non-standard structure — when the results differ a lot, try both, and take the one with more valid imports. Clear the previous result before a retry
- **Red invalid items after Get Imports**: Show Invalid to view them, and right-click Cut thunk to delete invalid items. After deleting a small number of invalid items, Fix Dump may still produce a runnable file (except delay-load imports of an individual DLL)
- **Fix Dump points at the dumped file**: Dump first and save the process image, then Fix Dump selects that file and writes `*_SCY.exe` — repairing the original exe directly is meaningless
- **Built-in vs standalone**: the Scylla built into an x64dbg release is the packaged build that updates with the version. Standalone NtQuery/Scylla updates more often. Feature differences follow each About box

## Anti-debug bypass boundaries

- **ScyllaHide coverage is limited**: what it hides is common API checks (IsDebuggerPresent, some NtQueryInformationProcess variants, and similar) — checks not on its list (custom timing, a performance counter, a specific syscall combination, kernel-mode verification) still hit. The plugin list is fixed. Do not assume "ScyllaHide on means invisible"
- **Hardware breakpoints can be exposed by reading DR registers**: after a hardware/memory breakpoint is set, the target can read DR0-DR3/DR6/DR7 and notice — ScyllaHide injection mode can hide some of this, but against a targeted check only a logical breakpoint remains, or patch the check point first
- **The debugger's own features can be fingerprinted**: the x64dbg module name / window class / DLL name / memory features can all be enumerated — when the target crashes only under x64dbg, treat it as feature detection (see pitfall 6 of SKILL.md)
- **TLS callbacks / logic before the entry**: in launch mode the default stop is the system breakpoint, and a TLS callback may already have run — breaking logic before the entry requires checking the event breakpoints under Options > Events (TLS callbacks/entry breakpoint). A miss cannot be replayed
- **If a timing-class check cannot be bypassed, patch it statically**: changing the compare point inside the debugger for a timing-delta / execution-count check only works one hit at a time. A high-frequency check target is cheaper to patch statically (see [[re-patching]])
- **Kernel-mode checks (driver layer) are outside the debugger's capability**: x64dbg is a user-mode debugger. A PPL process and a driver-layer check cannot be attached or bypassed — prepare kernel-debug capability per the Windows branch of [[re-analyze/platform-tips]], or drop it

## Version differences

- **v1.0 (the only formal stable release of 2023) → CalVer major versions from 2025.06.30** ("Type System and Modernization"): type-system rework (bitfields/enums/anonymous types, the ManyTypes plugin), AVX-512 and half-precision float support, the build moved to VS2022+CMake, Windows XP is no longer supported (Win7/8.1 have a deprecation warning)
- **Script engine rewrite from 2025.08.19**: script commands execute deterministically on the event loop. The command line added `-c <command>` / `-cf <script file>` / `-pid` / `-tid` and similar — old script behavior may change. Check the new syntax before scripted debugging
- **Snapshot builds are still rolling**: dev-branch products are newer than the formal release but may regress. Formal analysis prefers the release build
- **x32dbg and x64dbg keep shortcut/plugin configuration separately**: each side saves its own settings and database. Do not assume the configuration is shared

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]]). Attach needs administrator privilege
- Version-dependent behavior (the built-in Scylla version, script syntax) follows how the target version actually behaves
