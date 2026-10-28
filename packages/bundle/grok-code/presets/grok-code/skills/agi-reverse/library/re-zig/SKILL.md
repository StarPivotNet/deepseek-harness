---
name: re-zig
type: atomic
description: >
  Reverse engineering Zig build products: product identification, comptime expansion, panic/error-handling paths, the C ABI boundary.
  Triggers: `Zig逆向`, zig, comptime, `zig 产物`, panic.
capabilities: [lang-runtime-analysis]
---

# Zig reverse engineering

## When to use / when not to use

- Use: a Zig product (no C++ RTTI/exception tables, a panic function-chain feature, a `_start → main` startup shape), and you need to recover the error-handling path, the C ABI boundary, and behavior after comptime expansion
- Use: separating Zig-side code inside a mixed Zig/C product (the side with no RTTI + Zig symbol patterns)
- Do not use: a C/C++ product (use [[re-cpp-abi]]; RTTI/exception tables mean it is not a Zig-only product)
- Do not use: you only need function logic (a decompiler skill directly)

## Tool setup

### readelf / llvm-nm (symbols and sections)

- Install and verify are in [[re-cpp-abi]] Tool setup
- Use: `readelf -S` looks for exception-table sections. `readelf -s`/`llvm-nm` look at symbols and visibility (Zig business functions are mostly LOCAL symbols)

### llvm-objdump / objdump (disassembly)

- Install and verify are in [[re-cpp-abi]] Tool setup
- Use: locate panic call sites, and the error-code compare of catch/orelse (`cmpw` + a branch)

### Ghidra / IDA (decompilation base)

- Install and verify are in [[re-ghidra]] / [[re-ida]]
- A Zig product has no type information (when there is no DWARF). Pair it with behavior analysis (see steps 3/4)

### strings (string pool / error names)

- Ships with the system. Verify: `strings --version`
- Use: `@errorName` error-name strings, panic messages, format-string location

### zig compiler (optional, compile a comparison)

- Official tarball / `brew install zig` / the Windows official installer. Verify: `zig version`
- Use: compile a comparison product with the same version, and verify the panic chain / error-union layout (version differences are large; see [[layout]])

## Steps

Run in order. Archive each step's product (path + sha256; see [[re-triage]]).

1. **Product identification**:
   ```sh
   readelf -s sample | grep -iE 'panicking|panicExtra|defaultPanic|zig' | head
   readelf -S sample | grep gcc_except_table   # should print nothing (a Zig product often has .eh_frame, which cannot be the discriminator)
   readelf -s sample | grep __gxx_personality_v0   # should not match
   readelf -s sample | grep -wE '_start|main'      # startup shape
   ```
   - Zig features: a panic function chain (`debug.panicExtra`/`debug.panicking` and similar, version-dependent), `std` symbol patterns (`std.debug.print` and similar), **no C++ RTTI/exception tables** (compare with the dense RTTI/exception features in [[re-cpp-abi]])
   - Discriminator combination: no `.gcc_except_table` + no `__gxx_personality_v0` + no `_ZTV*` (RTTI vtable) → no C++ exception mechanism. Both have `.eh_frame`, so it cannot be a discriminator by itself
   - Mixed compilation with C: Zig symbols and C symbols coexist (see the step 5 boundary)

2. **Symbol visibility and the startup path**:
   ```sh
   readelf -s sample | grep -E 'GLOBAL|LOCAL' | grep -cE 'FUNC'
   readelf -s sample | grep -wE '_start|main' | head
   ```
   - Startup path: `_start` (GLOBAL) → runtime init (std.start) → `main` (LOCAL). Zig's `main` is an ordinary function. The entry is wrapped by std.start (exit handling is in the wrapper)
   - **Symbol visibility**: Zig exports only `_start` and functions explicitly marked `export` by default. Business functions are LOCAL symbols (the symbol table is still there in debug/ReleaseSafe; ReleaseFast can strip) — seeing them in `nm` is not the same as exported. The hook/injection surface is counted from the export table
   - comptime expansion products: compile-time computation is already inlined/expanded — there is no matching source structure. Analyze by behavior (see pitfall 1)

3. **panic / error-handling path**:
   ```sh
   readelf -s sample | grep -iE 'panic' | head        # panic-chain symbols (version-dependent names)
   ```
   - panic chain: `@panic` / an assertion failure → the panic function (print + abort) — locating panic call sites finds input checks / invariants. The panic handler itself is "print + exit". The call site is the business check
   - Error union: the `!T` type. The layout splits in two by payload size (a small payload is an 8-byte slot with the error code in the high side; a large payload has the error code first and the payload inlined at its alignment — [[layout]] has a measured table). At the call site, check the `orelse`/`catch` branch (compiled as an error-code compare + a branch)
   - Analysis: the error path is the reverse-engineering focus (check logic, failure branches) — the error-code compare point is the branch condition. Error names can be recovered from the `@errorName` string pool
   - Error-name recovery: the string from `@errorName(e)` is in a `__zig_tag_name_*` symbol / the string pool — error names in `strings` correspond directly to code paths, and are the first-hand lead for error semantics

4. **Constant and string location (the behavior-analysis entry)**:
   ```sh
   strings -n 5 sample | head -30        # format strings / error names / panic messages
   readelf -S sample | grep -E 'rodata|data'   # constant area
   ```
   - The format string of `std.debug.print` is in read-only data. A cross-reference walks back to the call site (the error-output path)
   - A constant evaluated at comptime is inlined directly as an immediate. There is no constant table — find the "magic number" and walk the argument back from the call site

5. **comptime and generic expansion**:
   - A constant / inline function computed at comptime leaves no runtime trace. Generic instantiation produces repeated code (specialized by the call-site arguments)
   - Recovery strategy: analyze by behavior (where a constant appears → which call argument it walks back to), not by mapping to source
   - std functions such as `std.debug.print` are heavily inlined (Release mode). `readelf -s` may be left with only startup and the panic chain

6. **C ABI boundary**:
   - `@extern` / `@cImport`: Zig calls a C library (the import table is easy to check — NEEDED and import symbols from `readelf -d`)
   - `export fn`: the Zig side exports for C/the host to call (a GLOBAL symbol, visible in the export table)
   - A mixed product: separate by symbol origin (Zig symbols vs C symbols — linker groups / section ownership). The boundary is the logic entry (the Zig main logic is inside the boundary)
   - Calling convention: **it is the C ABI only on an `extern` / `export` boundary, or an explicit `callconv(.c)` boundary** — the compiler's own definition is "`c` is an alias of this target's C calling convention; **a function marked `extern` or `export` gets that convention by default**", while **an ordinary Zig `fn` uses Zig's default convention** (the definition's wording: used when it is neither `export` nor `inline`; **it makes no guarantee about stack alignment, registers, and similar, and it can be used only inside the same Zig compilation unit**). So `callconv(.c)` is an **explicit request** for the C convention, not the default of an ordinary function
   - **A pure Zig internal function cannot be forced onto the C ABI unconditionally**: register arguments, aggregate passing, and return-value rules may all differ from the target platform's C ABI. When recovering a prototype, infer from actual use near the call site. SysV on x86-64 applies only to the mapping of `.c` on that target. It does not represent Zig's internal convention itself
   - Read the argument layout of a C-library call site by the ABI (unlike C++ thiscall in [[re-cpp-abi]], there is no hidden argument / vtable indirection) — **this applies only to a boundary already confirmed to be the C ABI**

7. **stripped / ReleaseFast fallback**:
   ```sh
   strings -n 6 sample | grep -iE 'panic|error' | head     # panic messages / error names (@errorName string pool)
   ```
   - Under ReleaseFast both the symbol table and the panic chain may be stripped. Recover from behavior features (the error-code compare pattern, the string pool). The first-look fallback is [[re-triage]]

## Related skills

- [[re-binary-core]] gateway: this skill belongs there (the "Zig product" branch of the selection tree)
- [[re-cpp-abi]]: boundary separation (no RTTI/exceptions → not C++)
- [[re-imports]]: the C-library boundary (NEEDED/import symbols) and the export table
- [[re-analyze/analysis-contract]]: the symbol table is passed under the data contract
- [[re-triage]]: first-look fallback

## Pitfalls

- **comptime expansion inflates symbols**: symptom — product symbols do not correspond to the source; cause — compile-time expansion / inlining / generic specialization; fix — analyze by behavior rather than mapping to source
- **The panic path misleads**: symptom — a large amount of panic-handling code is treated as the main logic; cause — the error path and the normal path are interleaved; fix — separate panic call sites (the checks) first, then analyze the normal path
- **Error-union layout differs by version**: symptom — the error code is read at the wrong offset; cause — the error-union layout changes with the version (a small payload is an 8-byte slot / error code on the high side; a large payload is inlined at its alignment); fix — confirm the layout for the target version (the measured table in [[layout]]). The error code is always u16
- **A mixed compile with C is hard to split**: symptom — Zig/C symbols are mixed; cause — mixed compilation; fix — group by symbol origin and section ownership. Enter Zig logic at the boundary
- **No exception table ≠ no protection**: symptom — a false judgment that there is no error handling; cause — Zig error handling uses an error union, not an exception table; fix — check error-union call sites (the error-code compare on a `catch`/`orelse` branch)
- **Business functions are LOCAL symbols**: symptom — `nm` lists a pile of functions, but `nm -g` (global) shows only `_start`; cause — Zig does not export business symbols by default; fix — count the hook/injection surface from the export table. Analysis can still locate them by LOCAL symbols
- **panic-chain names change with the version**: symptom — searching symbols for `std.debug.panic` finds nothing; cause — 0.14+ reworked it into the `debug.panicExtra`/`defaultPanic` chain (older versions name `std.debug.panic` directly); fix — locate by the panic call site (the `@panic` compile product: a print+abort sequence), and do not depend on a specific symbol name
