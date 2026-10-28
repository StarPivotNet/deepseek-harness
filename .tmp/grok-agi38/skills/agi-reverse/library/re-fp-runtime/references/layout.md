# Functional-runtime layout: GHC heap objects / OCaml value representation / calling convention

Shared traits of Haskell (GHC) and OCaml products: a heap-object header carries a "dispatch pointer" (GHC info table / OCaml block header), and a function call jumps indirectly through a closure. Fields in this file are measured on GHC 9.14.1 and OCaml 4.14.2; version differences are marked separately.

## GHC heap object (closure)

### Closure layout (measured)

```
closure:
  +0  info-table pointer (StgInfoTable entry-code address) ← dispatch point
  +8  field 0 (constructor argument / captured variable / evaluation result)
  +16 field 1 ...
```

- **The first field of a closure = the info pointer** (measured: the contents of `Main_main_closure` = the address of `Main_main_info`; byte verification is in [[examples]])
- Dispatch: a call/evaluation = read the info pointer → jump to entry code; the end of entry code usually `jmp`s to later handling (update frame / return)

### Info table and entry code

- An `_info` symbol = the entry-code address; info-table fields (layout/type/srt) sit in the negative-offset region before the entry code
- Symbol shape: `<module>_<name>_closure` (data) + `<module>_<name>_info` (code); module names are z-encoded (`zi`=`.` and similar)
- Evaluation chain: a thunk's entry code writes the closure back after evaluation and jumps to the update frame (related to `stg_upd_frame_info`) — where `stg_upd_frame_info`/`stg_enter_info` appear = the lazy-evaluation mechanism

### CAF (constant applicative form)

- A top-level constant / zero-argument function is statically allocated as a CAF (the .data region) and evaluated only on first reference (a thunk)
- Location: the `newCAF` call site (an RTS symbol); `Main_main_closure` is a typical CAF

### GHC calling convention

| Item | Rule |
|---|---|
| Arguments | passed on the stack (the STG stack, not the hardware stack) |
| Return | registers R1-R3 (a boxed value is in R1) |
| Dispatch | through the info pointer (a closure call = read info → jump to the entry) |
| Evaluation trigger | thunk entry → evaluate → update the closure (WHNF) |

## OCaml value representation

### tagged int and block (64-bit, native code)

| Value | Representation | Judgment |
|---|---|---|
| Integer | `value = real << 1 \| 1` | low bit=1 (odd) |
| block pointer | an 8-byte-aligned pointer to the header | low bit=0 (even) |
| Unboxed double | a special-tag (250) block, or a register | — |

### Block header (header, 64-bit)

```
header = (size << 10) | (color << 8) | tag
         size: field count (words)   color: GC three-color   tag: constructor tag
```

- tag semantics: 0-246 are constructor tags (pattern matching dispatches by tag); 247-255 are special (250=double, 248=string, and similar)
- Two-field speedup: `caml_alloc2/alloc3` allocates a multi-field block in one shot (`caml_alloc` is the single-field general case)

### Closure (function value)

- A closure = a tagged block; fields = the environment (captured variables) + a code pointer (the first field)
- Call: load arguments into registers → `caml_apply2`/`caml_apply3` (dispatch by argument count) or jump directly to the closure code
- Runtime function symbols: `caml_apply1..N` (partial application), `caml_alloc*` (allocation), `caml_main`/`caml_startup_common`/`caml_startup`/`caml_start_program` (entry chain)

### OCaml entry chain (native, measured 4.14.2)

```
main (C entry, runtime/main.c)
  └─ caml_main(argv)                ← runtime/main.c defines main and calls caml_main (caml_main is defined in startup_byt.c/startup_nat.c)
       └─ caml_startup_common
            └─ caml_start_program   ← native runtime library only (measured in 4.14.2 libasmrun.a); bytecode entry is caml_main → caml_startup_aux → caml_interprete (this symbol is absent)
                 └─ caml<module>__entry (each module's init, including global-data allocation)
                      └─ business entry (camlHello__entry)
```

- The main chain is `caml_main`; `caml_startup`/`caml_startup_pooled` are equivalent entries for a C embedder to call (the signature is also void (char_os **argv); the difference is the pooling flag and exception behavior); do not conflate them. Measured 4.14.2 addresses: caml_main=0x26180, caml_startup_common=0x25ec0, caml_startup=0x26150, caml_start_program=0x4a990 (disassembly is in [[examples]])
- Module-level function naming: `caml<module>__<name>_<numeric id>` (for example `camlHello__add_267`)

### OCaml bytecode product structure

```
Executable:
  #!<ocamlrun path>\n    script header (file reports "ocamlrun script executable")
  T                      leading magic (measured on 4.x)
  code region (no length field; the length is in the tail TOC)
  each section's data + tail TOC: section name (4 characters) + big-endian length listed one by one; the end is the section count and "Caml1999X031"
  sections: CODE code / PRIM primitive table / DATA data / SYMB global symbols / CRCS CRC string / DLLS dynamic libraries
```

- Identification: `file sample` prints `ocamlrun script executable`; `head -c 32 | xxd` shows the `#!` header
- Structure analysis: `ocamlobjinfo sample` (.cmo/.cmx/a bytecode exe all work; prints imported units/CRC/CLambda approximation)

## Version-difference points

| Item | Old version | Measured version (this document) |
|---|---|---|
| OCaml entry | `main → caml_main → caml_startup_common → caml_start_program` (consistent across versions; runtime/main.c defines `main` and calls `caml_main`; `caml_main` is defined in startup_byt.c/startup_nat.c) | same as the left (measured 4.14.2; addresses in [[examples]]) |
| Bytecode magic | the magic string is in the file-tail TOC (`Caml1999X`+version number, defined in exec.h) | leading `T` + tail `Caml1999X031` (measured on 4.14) |
| GHC version | RTS symbol naming is tweaked with version | 9.14.1 (stg_ap_*/stg_upd_frame_info are stable) |

- Anchors that are stable across versions: the OCaml tagged-int low-bit rule, the low byte of a block-header tag, and the GHC closure first-field info pointer

## Usage notes

- Static analysis needs no sandbox; product structure is consistent across platforms (Linux/Windows/macOS) (a C runtime port)
- Use together with [[re-analyze/analysis-contract]] (data-flow diagram handoff) and [[re-cpp-abi]] (table-pointer dispatch comparison)
