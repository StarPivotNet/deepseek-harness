---
name: re-swift
type: atomic
description: >
  Swift binary reversing: mangling decode, protocol witness tables, closure capture, ObjC interop.
  Triggers: `Swift逆向`, swiftc, witness table, swift demangle, `闭包捕获`, `Swift 产物`.
capabilities: [lang-runtime-analysis]
---

# Swift reversing

## When to use / when not to use

- Use: a Swift build (a Mach-O/ELF with the Swift mangling signature, a `$s` prefix, or a `__swift5_*` reflection section) when symbols, protocol conformance, or closure structure must be recovered
- Use: telling the Swift layer apart from the ObjC/C layer in a mixed build (do the ObjC path first, then enter the Swift layer)
- Do not use: pure ObjC (the ObjC path in [[re-ios]] / [[re-macos]]); pure C/C++ ([[re-cpp-abi]])
- Do not use: only an ordinary decompilation is needed ([[re-ghidra]] / [[re-ida]] directly)

## Tool setup

### swift-demangle (the Swift toolchain, mangling decode)

- macOS: shipped with Xcode (`xcrun swift-demangle`); Linux: the official Swift toolchain (download the tar from swift.org and extract it; it includes `swift-demangle`); Windows: the official Swift toolchain
- Check: `echo '$s4main6myFuncyyF' | swift-demangle` (on macOS, `xcrun swift-demangle`; with no arguments it reads stdin and prints `$s... ---> main.myFunc() -> ()`)
- Batch: `llvm-nm sample | swift-demangle`; `-simplified` prints the short name; `-expand` prints the decode tree

### swiftc / swift (optional, a comparison build)

- macOS: shipped with Xcode; Linux/Windows: the same official toolchain (it includes the compiler, so a same-version sample can be compiled locally to compare symbol shape)
- Check: `swift --version`

### llvm-nm / llvm-objdump (symbols and sections)

- Install and check as in the tool setup of [[re-cpp-abi]]. The Mach-O side also needs otool (the tool setup of [[re-format-macho]])
- Purpose: `llvm-nm -m sample` shows symbols and which section they belong to; `otool -l sample | grep swift5` locates reflection sections

### Ghidra / IDA (decompiler base)

- Install and check as in [[re-ghidra]] / [[re-ida]]. The Swift symbol decode is used for a batch rename (Ghidra can be scripted: write the demangle output back into the symbol table, and the decompiler view recovers readable function names)

## Steps

Run in order. Archive each product (path + sha256; see [[re-triage]]).

1. **Identify the build**:
   ```sh
   strings -a sample | grep -E '^\$s|^_T0|^_\$S' | head
   llvm-nm sample 2>/dev/null | grep -E 'swift_|^\$s' | head   # ELF 用 readelf -s 同效果
   otool -l sample 2>/dev/null | grep -c swift5               # Mach-O 反射段存在性
   ```
   - `$s` (Swift 5+), `$S` (Swift 4.2), and `_T0` (Swift 4.0) are three generations of mangling prefixes. `swift_*` runtime imports (swift_retain / swift_release / swift_allocObject) confirm the runtime
   - Pure ObjC has none of those features → switch to [[re-ios]] / [[re-macos]]. A `__swift5_*` section whose symbol names were stripped is still Swift (reflection metadata does not disappear with strip; see pitfall 5)

2. **Mangling decode (batch)**:
   ```sh
   llvm-nm -m sample | awk '$3 ~ /^\$s/ {print $3}' | swift-demangle | head -20
   # ELF: readelf -s sample | awk '$8 ~ /^\$s/ {print $8}' | swift-demangle
   ```
   The decode contains: module name / type / function signature / expanded generic parameters. Write the result into the symbol table for a [[re-ghidra]] / [[re-ida]] rename. A quick look at the mangling structure is in step 3 and [[layout]].

3. **A quick look at the mangling structure (reading a symbol by hand)**:
   ```
   $s 前缀 + 长度前缀标识符 + 类型字母 + 签名
   $s 13ExampleModule 3Foo C 3bar Si y F
      └模块(13字符)   └类型 └类 └方法 └结果 └参数 └函数
   C=类 O=枚举 V=结构体 P=协议；Si=Int SS=String Sq=Optional；y=空元组 ()
   ```
   Encoding rules: an identifier is a decimal length plus ASCII. The signature order is **the result type first, then the parameters**, and `F` at the end means a function. A signature can carry modifier bits (async/throws, which appear explicitly in the decoded output). A `_To` suffix is an @objc bridging thunk. A `TE` suffix is a distributed thunk. The detailed rules and the official examples are in [[layout]] / [[examples]].

4. **Protocol witness table (the core of dynamic dispatch)**:
   - A witness table is the dispatch table of protocol methods. Locate the conformance record: the Mach-O `__swift5_proto` section / the ELF `swift5_protocol_conformances` section (protocol descriptors are in `__swift5_protos` / `swift5_protocols`), or search for a `_swift_getWitnessTable` call site
   - Recovery: a conformance record is an array of method slots. A slot value is the implementation address of the matching protocol requirement → together with the vtable-recovery idea in [[re-cpp-abi]], infer "which type conforms to which protocol"
   - With no symbol names, infer from a protocol-method call site: find the function-pointer table at the witness-method call. The table order is the protocol's declaration order
   - Note an indirect conformance (the `witness_table_indirect` flag): the slot stores a pointer to an indirect table, not a direct implementation address, so one more layer must be resolved

5. **Closure capture**:
   - A closure is a context object: a `swift_allocObject` call site → context allocation → captured-field initialization. The context header is a pointer to the capture-layout descriptor, and the fields follow in capture order
   - Recovery: the context struct's fields → captured variable names and types (tied to the function signature). A reference-semantics field is confirmed by `swift_retain` / `swift_release` call sites
   - A compiler-generated "partial apply forwarder" symbol (the decode contains `partial apply forwarder`) is the typical shape of a closure entry

6. **ObjC interop**:
   - `@objc` bridging: a Swift class is visible through the ObjC runtime (an NSObject subclass, message send via objc_msgSend). The Swift-side implementation entry is the bridging thunk that ends in `_To`
   - Analysis: the ObjC method list (the class-dump idea) → the bridging thunk → the Swift implementation. `swift_` runtime call sites separate Swift-side logic
   - A mixed build: do the ObjC path first ([[re-ios]] / [[re-macos]]) and then enter the Swift layer. A Swift build on Linux has no ObjC layer (no __objc_classlist); analyze it as a pure ELF

7. **Reflection metadata (recovering type structure)**:
   ```sh
   otool -l sample | grep -A2 swift5_fieldmd      # 字段描述（类型内布局）
   otool -l sample | grep -A2 swift5_typeref      # 类型引用（字符串池）
   otool -l sample | grep -A2 swift5_reflstr      # 反射字符串
   ```
   `__swift5_fieldmd` records a type's field names and type references. Together with `__swift5_typeref` it recovers a struct or class layout faster than decompilation alone.

8. **Symbol recovery**: after a batch rename from the decode, cluster and filter generic-specialization symbols (a large number of `Gy` suffixes). Recover "the core methods of each type" first, then the specialized copies (see pitfall 2).

9. **Byte-level check**: when symbol extraction or section location looks wrong, check bytes with `xxd` (a mangled name is a length prefix plus ASCII; a reflection section is fixed-size records inside a data section). The smallest byte sample and the check flow are in [[examples]]. Do not throw away a tool parse failure as "not a Swift build".

## Cross-domain handoff

- [[re-binary-core]] gateway: this skill belongs there (the "Swift build" branch of the selection tree)
- [[re-ios]] / [[re-macos]]: the ecosystem continues here (the ObjC layer, app-layer analysis)
- [[re-format-macho]]: the toolchain that locates Mach-O sections and reflection sections
- [[re-cpp-abi]]: vtable and witness-table recovery share the same idea
- [[re-frida]]: hook a Swift function at runtime (the name after symbol decode is the hook point)
- [[re-analyze/analysis-contract]]: the symbol table is passed through the data contract

## Pitfalls

- **Mangling version differences**: symptom — a newer Swift build fails to decode or prints garbage; cause — the mangling scheme moved (`$s` / `$S` / `_T0`, three generations); fix — use a swift-demangle of the same generation as the target compiler, or newer. A new tool can still decode an old `_T0` symbol, but an old tool cannot decode a new symbol
- **Generic expansion explodes the symbol set**: symptom — the decode prints a large number of `$s...Gy` generic instances; cause — generic specialization; fix — cluster and filter by module and type, and recover the unspecialized prototype first
- **A witness table has no symbol names**: symptom — every dispatch-table slot is a bare address; cause — protocol conformance has no named symbol; fix — infer slot meaning from a protocol-method call site (the witness-method call)
- **A closure capture includes reference semantics**: symptom — a context field is a reference-counted object; cause — a captured variable holds a class instance; fix — confirm reference fields from swift_retain/release call sites. Do not read them as value types
- **Pure ObjC entered by mistake**: symptom — there is no `$s`, but the Swift flow was followed anyway; cause — the build is actually ObjC; fix — step 1 confirms first (no `$s` / `__swift5_*` means switch)
- **A mangled name is not an ordinary string**: symptom — `strings` / grep truncates or misses some symbols; cause — a mangled name can contain `\x01-\x1f` control characters followed by pointer bytes (a symbolic reference). It is not a clean `\0`-terminated string; fix — extract symbols from the symbol table with `llvm-nm` / `readelf -s`, not with `strings` as a fallback. A parser that hits a control character must refuse to read the pointer bytes
- **After strip the reflection sections remain but the symbol names are gone**: symptom — the `__swift5_proto` section is still there and the `$s` symbol list is empty; cause — strip only deletes the symbol table. Reflection metadata (conformance / fieldmd) lives in a data section; fix — rebuild type and protocol relations from the reflection sections. Do not depend on symbol names
- **A `_To` suffix is treated as an ordinary symbol**: symptom — `foo.bar.bas(zim:)` and `@objc foo.bar.bas(zim:)` both exist, and the latter is missed; cause — `_To` is an @objc bridging thunk; fix — analyze `_To` and the body as a pair. An ObjC-side call enters the Swift implementation through the thunk
- **The entry is not the ObjC view of main**: symptom — analyzing `main` finds an "entry" that is only a thin layer; cause — a Swift executable's entry is `@main` / top-level code going through runtime initialization (swift_retain appears heavily on the startup path); fix — from the `main` disassembly, follow the runtime call chain to the first method call of a user type, then go deeper. Do not spin inside the initialization wrapper
- **An old Swift 4 build has no reflection sections**: symptom — there is no `__swift5_*` section, the symbols were stripped, and only `_T` / `_T0` prefix remnants remain; cause — the reflection system arrived in 5.0; fix — identify Swift-side code from the mangling prefix (`_TtC` and the rest) and from `swift_retain` / `swift_release` runtime call sites, and fill the type skeleton from the ObjC section (__objc_classlist)
