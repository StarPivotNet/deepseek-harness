# Swift binary layout: mangling grammar / swift5 reflection sections / witness tables / closures

Compared with a C/C++ build, a Swift build adds two kinds of structure: mangled symbol names (every top-level symbol is encoded with `$s`) and `__swift5_*` reflection-metadata sections (protocol conformance, type descriptors, field descriptors). They complement each other: the symbol name gives the "name", and the reflection section gives the "structure".

## Mangling prefix variants

| Prefix | Era | Meaning |
|---|---|---|
| `$s` | Swift 5+ | the current stable mangling (the default object of this skill) |
| `$S` | Swift 4.2 | the 4.2 transitional variant |
| `_T0` | Swift 4.0 | the 4.0 variant |
| `_T` / `_Tt` | Swift 3.x and earlier | ObjC-era mangling (the `_TtC3foo3bar` shape) |
| `$e` | — | Embedded Swift (unstable) |
| `@__swiftmacro_` | — | a file-name symbol from macro expansion |

## Encoding grammar (the stable `$s` format)

### Basic units

| Unit | Rule | Example |
|---|---|---|
| Identifier | a decimal length plus an ASCII string (non-ASCII uses Punycode, prefix `00`) | `4Test` → "Test"; `13ExampleModule` → "ExampleModule" |
| Type letter | C=class O=enum V=struct P=protocol E=extension | `3FooC` → class Foo |
| Standard-library abbreviations | Si=Int SS=String Sq=Optional Sa=Array Sd=Double Sb=Bool | `Si` → Swift.Int |
| Module abbreviations | s=Swift So=C/ObjC module SC=Clang importer | in `s4main`, `s` is the Swift module |
| Empty tuple | y | `()` (an empty parameter or result) |
| Function | the declared name + the label list + the signature + `F`; **signature order = result type first, then parameters** | `3bar Si y F` → `bar() -> Int` |

### Suffix modifiers (entity level)

| Suffix | Meaning |
|---|---|
| `_To` | an @objc bridging thunk (appears as a pair with the body; the ObjC side enters the Swift implementation through it) |
| `TE` | a distributed thunk |
| `Tg5` / `Tg` and similar | generic specialization |
| `TA` | a closure partial-apply forwarder |
| `TW` | a protocol witness thunk (`{T:} protocol witness for ...`) |
| `TI` | a dispatchable thunk (method dispatch thunk) |

### Substitution and symbolic references

- Substitution table: a lowercase letter starting at `A` refers to a module or type that already appeared (it compresses a repeated prefix)
- Symbolic reference: a mangled name embeds a `\x01-\x1f` control character plus pointer-sized bytes — **it is not an ordinary `\0`-terminated string**. `strings` / strlen truncate it (see pitfall 6 of SKILL.md)

### A hand-read example (official test vectors)

```
$s4main6myFuncyyF          → main.myFunc() -> ()
└模块"main"└函数"myFunc"└结果y(())└参数y(())└F

$s3foo3barC3bas3zimyAaEC_tF  → foo.bar.bas(zim: foo.zim) -> ()
└模块foo └类bar └方法bas └标签zim └参数y └结果(替换A→foo.zim)└F

$s3foo3barC3bas3zimyAaEC_tFTo → {T:...,C} @objc foo.bar.bas(zim: foo.zim) -> ()
                                 （同符号 + _To = @objc 桥接 thunk）

$s4main3fooyySiFyyXEfU_TA.1 → {T:} partial apply forwarder for closure #1
                               () -> () in main.foo(Swift.Int) -> ()（闭包）
```

## swift5 reflection sections (Mach-O name / ELF name / COFF name)

| Contents | Mach-O (inside the __TEXT segment) | ELF | COFF |
|---|---|---|---|
| Protocol conformance (conformance records) | `__swift5_proto` | `swift5_protocol_conformances` | `.sw5prtc$B` |
| Protocol descriptors | `__swift5_protos` | `swift5_protocols` | `.sw5prt$B` |
| Type descriptors | `__swift5_types` | `swift5_types` | `.sw5tyd$B` |
| Field descriptors (layout inside a type) | `__swift5_fieldmd` | `swift5_fieldmd` | `.sw5fld$B` |
| Type-reference string pool | `__swift5_typeref` | `swift5_typeref` | `.sw5tyr$B` |
| Reflection strings | `__swift5_reflstr` | `swift5_reflstr` | `.sw5rfl$B` |
| Closure-capture descriptors | `__swift5_capture` | `swift5_capture` | `.sw5cpt$B` |
| Associated types | `__swift5_assocty` | `swift5_assocty` | `.sw5ast$B` |
| Builtin types | `__swift5_builtin` | `swift5_builtin` | `.sw5bui$B` |
| Polymorphic enums | `__swift5_mpenum` | `swift5_mpenum` | `.sw5mpe$B` |
| Accessibility | `__swift5_accessible` | `swift5_accessible` | `.sw5acc$B` |
| Replacement range | `__swift5_replace` | `swift5_replace` | `.sw5rpc$B` |
| Module hash | `__swift_modhash` | `swift_modhash` | `.sw5mh$B` |

Locate them: Mach-O `otool -l sample | grep -A2 swift5_`; ELF `readelf -S sample | grep -i swift5`. These sections are data sections (resident in memory). **strip does not delete them** — a stripped Swift build rebuilds type and protocol relations from them.

## Witness tables and conformance records

- A conformance record (`__swift5_proto`) points at: the witness table (if indirect), the conformance descriptor, the nominal type descriptor, and the protocol descriptor
- A witness-table slot is the array of implementation addresses of the protocol's required methods. Slot order matches the protocol's declaration order
- The entry to locate: a `_swift_getWitnessTable` call (a direct fetch) or a `swift_getWitnessTable` call (a table lookup). The second argument at the call is the conformance record
- With no symbol names: find the witness-method call site (an indirect call of a protocol method inside a generic function). Its function-pointer table is the witness table

## Closure context layout

```
swift_allocObject(闭包布局描述符, size, align) → context 对象
context 头部 = 指向闭包捕获布局描述符的指针（swift5_capture 段条目）
其后按捕获顺序排列字段：值类型=内联值；引用类型=强引用指针（配 swift_retain/release）
```

Locate: the constant argument of a `swift_allocObject` call is the capture-layout descriptor (it includes the captured field count and types). The closure entry is a partial-apply forwarder (a `TA`-suffix symbol).

## Runtime symbols (the `swift_` prefix, import confirmation)

| Symbol | Meaning |
|---|---|
| swift_retain / swift_release | strong-reference increment / decrement (a reference-semantics field marker) |
| swift_allocObject / swift_allocBox | heap-object / closure-box allocation |
| swift_beginAccess / swift_endAccess | exclusive-access modifiers (exclusivity) |
| swift_getWitnessTable / _swift_getWitnessTable | fetch a protocol witness table |
| swift_getTypeByMangledName | look up type metadata by a mangled name |
| swift_dynamicCast | a dynamic type cast |

## Version-difference points

- Three generations of mangling prefix (`$s` / `$S` / `_T0`). The toolchain must be the same generation as the build, or newer, to decode it
- A Swift 4 or earlier build has no `__swift5_*` sections (the reflection system arrived in 5.0). An old build is recovered from symbol names plus the ObjC section (__objc_classlist)
- The number of generic specializations grows with the version (the compiler is more aggressive). A `Tg5` specialized symbol coexists with the prototype

## Notes

- Use together with [[re-format-macho]] (section location), [[re-cpp-abi]] (the vtable idea), and [[re-ios]] / [[re-macos]] (the ObjC layer)
- Extract symbols from the symbol table (llvm-nm / readelf -s), not with strings (a symbolic reference truncates)
