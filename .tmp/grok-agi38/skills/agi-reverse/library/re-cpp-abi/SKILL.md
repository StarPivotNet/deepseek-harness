---
name: re-cpp-abi
type: atomic
description: >
  Modern C++ binary reversing: RTTI/exception/vtable recovery, ABI identification, mangling decode.
  Triggers: `C++逆向`, RTTI, `虚表恢复`, `异常处理`, C++ ABI, mangling, `C++反编译`.
capabilities: [decompilation]
---

# Modern C++ reversing (RTTI / exceptions / vtables)

## When to use / when not to use

- Use: a binary dense with RTTI/exception tables, or a C++ target whose decompile is messy (class hierarchy / virtual calls / exception flow cannot be read directly)
- Do not use: C code or pure assembly (go to the [[re-binary-core]] generic path); a target dominated by obfuscation (do [[re-deobfuscate]] first)

## Tool preparation

### readelf / llvm-objdump (section table and exception tables)

- Linux: `apt install binutils llvm` / `dnf install binutils llvm` / `pacman -S binutils llvm`
- macOS: `brew install llvm` (macOS already has part of binutils)
- Windows: WSL or a prebuilt llvm
- Verify: `readelf --version`, `llvm-objdump --version`

### c++filt / undname (mangling decode)

- Linux/macOS: `c++filt` (ships with binutils); Windows: `undname` (the VS toolchain)
- Verify: `echo '_ZN3foo3barEv' | c++filt` (output `foo::bar()`)

### Ghidra / IDA (decompile base, scripted RTTI walk)

- Install and verify: see [[re-ghidra]] / [[re-ida]] tool preparation

### gdb (exception breakpoints, optional)

- Install and verify: see [[re-gdb]]

## Procedure

Run in order and archive each step's artifacts (path + sha256; see [[re-triage]]).

1. **Identify the ABI**:
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | head    # Itanium (GCC/Clang)
   strings sample | grep -E '^\?\?_' | head              # MSVC
   ```
   - Itanium features: `_ZN` (functions), `_ZTV` (vtables), `_ZTI` (RTTI type info)
   - MSVC features: `??_7` (vftable), `??_R` (RTTI) (after strip, ??_ is in the symbol table rather than the string area — also check the import table for __CxxFrameHandler / msvcp features to help the judgment)
   - A wrong identification skews everything that follows — confirm first, then continue

2. **Rebuild RTTI (Itanium)**:
   ```sh
   readelf -s sample | grep _ZTI | head
   # _ZTI<class name> points at typeinfo: it starts with a vptr (pointing at a type-info vtable such as _ZTVN10__cxxabiv1...),
   # and the next pointer-sized slot is __type_name; usually +0/+8 on 64-bit, +0/+4 on 32-bit
   # before parsing, fix the ELF class / pointer width; parse __si_class_type_info / __vmi_class_type_info the same way, by the target ABI's alignment and field widths
   ```
   - Structure: `typeinfo` → the `__class_type_info` derived chain → each class's full inheritance path
   - Script it: walk _ZTI references in Ghidra/IDA and rebuild the class inheritance graph (a parent/child table)
   - Output: a class name → inheritance-chain map (written into the session symbols_known; see [[re-analyze/analysis-contract]])
   - MSVC: walk `??_R0<class name>` TypeDescriptor symbols + `_RTTICompleteObjectLocator` (COL) to rebuild the inheritance graph

3. **Recover vtables**:
   ```sh
   readelf -s sample | grep _ZTV | head
   ```
   - `_ZTV<class name>` points at the vtable start (an array of virtual-function pointers); the vtable prefix is two slots (8 bytes on 32-bit / 16 bytes on 64-bit): offset-to-top + a typeinfo pointer (Itanium ABI)
   - After locating the vtable: each slot's function address → infer the virtual method name backward from call sites (combined with the inheritance graph from step 2)
   - A virtual call (`call *reg`) cannot be named statically → narrow the candidates with call-site context (how arguments/return values are used)

4. **Exception-handling tables**:
   ```sh
   readelf -S sample | grep -E 'eh_frame|gcc_except'   # ELF: .eh_frame (readelf does not parse PE; PE uses the command below)
   llvm-readobj --coff-unwind-info sample.exe            # PE: .pdata/.xdata (or objdump -h / pefile)
   ```
   - PE: RUNTIME_FUNCTION in `.pdata` (Begin/End/UnwindInfo) → unwind data in `.xdata` → the exception handler (__CxxFrameHandler3)
   - ELF: FDE/CIE in `.eh_frame` → unwind rules and the LSDA (.gcc_except_table) → exception-handler functions
   - Use: recover control flow broken by an exception path, and locate destructor/cleanup logic (catch blocks)

5. **Identify templates / lambdas**:
   - Templates: the symbol contains `<...>` parameters (expanded into a long string in Itanium mangling); when instantiation explodes, cluster by call pattern
   - Lambdas: a closure type is a real anonymous class type; ordinary call sites often do not emit standalone RTTI, so a missing `_ZTI` can neither rule a lambda out nor infer one (there can be matching RTTI when typeid and similar ODR-use it). Prefer Itanium `_ZZ<scope>ENK...` / `operator()` mangling, the captured-member layout, and the call site; on MSVC, `<lambda_...>`
   - Output: a list of suspected template instantiations / lambdas + call sites

6. **Decode mangling (batch)**:
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | awk '{print $8}' | c++filt | head -20
   ```
   - MSVC: `undname` or an online equivalent
   - Write the decoded result into the symbol table (for renaming in [[re-ghidra]] / [[re-ida]])

## Cross-domain joins

- The [[re-binary-core]] gateway: where this skill belongs (already mounted on the re-binary-core selection tree)
- [[re-ghidra]] / [[re-ida]]: decompile base and scripting
- [[re-deobfuscate]]: the join between obfuscation and ABI analysis
- [[re-analyze/analysis-contract]]: the class inheritance graph / symbol table is passed per the data contract
- [[re-analyze/rerouting]]: RTTI/exception-table features trigger this skill (already on table A)

## Common pitfalls

- **A wrong ABI makes every parse fail**: symptom — parsing an MSVC target with Itanium structures (or the reverse) misaligns everything; cause — the identification step was skipped; fix — do step 1 first, and check mangling features both ways
- **Template expansion explodes symbols**: symptom — readelf prints tens of thousands of `_Z...` lines; cause — template instantiation; fix — cluster by call pattern and filter standard-library symbols (libstdc++/STL prefixes)
- **A lambda missing RTTI is treated as typeless**: symptom — the class inheritance graph is missing a node, and you wrongly think a lambda is not a real type; cause — a closure type is a real anonymous class type; ordinary call sites just often do not emit a standalone typeinfo, so a missing `_ZTI` can neither rule it out nor infer it; fix — identify it from `_ZZ<scope>ENK...` / `operator()` mangling, the captured-member layout, and the call site; do not force a search for RTTI (ODR-use such as typeid can have separate RTTI)
- **Exception-table version differences**: symptom — .xdata parsing is misaligned; cause — the MSVC exception-handling version (__CxxFrameHandler3 and others) differs; fix — confirm the version from the imported function (__CxxFrameHandler) before parsing
- **A virtual call cannot be named statically**: symptom — every `call *reg` is an indirect call; cause — virtual dispatch; fix — narrow the candidates with the vtable slot and call-site evidence; do not guess
