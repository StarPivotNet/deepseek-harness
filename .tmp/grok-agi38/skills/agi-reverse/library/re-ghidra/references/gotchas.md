# Ghidra tool-specific pitfalls and boundaries

## Version differences (JDK / API / build chain)

- **JDK version**: running an official 11.3+ release needs JDK 21 (the wrong JDK reports `UnsupportedClassVersionError`); building Ghidra itself from source needs JDK 25 + Gradle 9.1+ (that is a different requirement from "running"; do not mix them)
- **12.x breaking API changes**: function-management classes and similar have migrations (ongoing since 11.x) — check the target version's javadoc before writing a script; if compilation fails, suspect an API difference before business logic
- **MemoryBlock permission API method names differ across versions** (for example 12.x `isExecute()` vs older names): when writing a script that judges memory-block permissions, confirm the current version's method name with a small verification script
- **GhidraDev/Eclipse version pairing**: the GhidraDev plugin version has a pairing table with the Eclipse version; if it will not install, check the combination in the official release notes first
- **Extension compatibility range**: a Java extension's extension.properties declares the Ghidra version range it applies to; installing outside that range is refused (see [[re-plugin-dev]])

## Headless batch pitfalls

- **headless and GUI analysis options differ**: the default analysis-option sets are not identical — for consistency, explicitly run an analysis script with `-postScript`
- **Project lock conflict**: opening the same project from the GUI and headless at once reports a lock (File Lock) — headless uses a separate project directory, or close the GUI first
- **-import and -process are mutually exclusive**: rerun an already imported file with `-process`; a repeat import needs `-overwrite` (otherwise existing files are skipped)
- **Do not mix the two logs**: `-log` is the run log, `-scriptlog` is script print/exceptions — if a script produced no output, look at the latter first
- **Paths with spaces**: `-scriptPath` separates multiple paths with semicolons and quotes the whole value; quote argument values that contain spaces the same way

## Script / API pitfalls

- **Jython 2.7 limits**: no f-string/walrus operator, and pip packages cannot be imported; `SyntaxError`/`ImportError` are both this cause — modern Python needs go through ghidra-bridge
- **Big loops are slow**: getByte/setByte byte by byte on a multi-megabyte range is an order-of-magnitude disaster; switch to mem.getBytes/setBytes
- **Address strings**: in a script, `"0x401000"` must go through `getAddressFactory().getDefaultAddressSpace().getAddress()`; writing `"401000"` outside a direct `currentAddress` is ambiguous
- **A script crash leaves no trace**: under headless, a script exception goes into `-scriptlog` but may not affect the exit code — a batch script should print a success marker at the end
- **Chinese output is garbled**: Chinese from print is garbled on some terminals because of encoding; handle character encoding inside the script first, or print an ASCII summary

## Analysis-result pitfalls

- **Auto-analysis misses obfuscated code**: junk instructions / scrambled segments were not disassembled — manually select the segment and force-mark with `C`; if needed, `Create Function` to repair the boundary
- **Decompiler illusions**: hand-written assembly / tail calls / no frame pointer make function-boundary and frame inference wrong — trust Listing assembly semantics; do not blindly trust decompiled C
- **Large-file analysis hangs**: indirect-call explosion / large C++ RTTI / obfuscated control flow — first shrink auto-analysis scope (limit/disable indirect-call and RTTI options); `-analysisTimeoutPerFile` is the fallback
- **-noanalysis capability boundary**: after skipping auto-analysis there are no functions/decompilation, but symbols (including JNI exports) and string scan still work — single-function decompilation still needs a local analysis run first

## Usage notes

- Static analysis skips the sandbox; if memory is under 4GB, switch to [[re-radare2]] (it stutters from startup)
- Archive sample/project/export products with sha256 ([[re-triage]]); conclusions go into [[re-analyze/analysis-contract]]
- Version-dependent behavior (API method names, analysis options) follows what the target version actually does
