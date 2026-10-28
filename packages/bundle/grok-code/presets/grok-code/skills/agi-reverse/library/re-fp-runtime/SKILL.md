---
name: re-fp-runtime
type: atomic
description: >
  Functional-language runtime reversing (Haskell/OCaml): closure/heap-object model, calling convention, data-flow-first strategy.
  Triggers: `Haskell逆向`, `OCaml逆向`, GHC RTS, thunk, STG, OCaml runtime, `闭包`, `函数式产物`.
capabilities: [lang-runtime-analysis]
---

# Functional-runtime reversing (Haskell / OCaml)

## When to use / when not to use

- Use: a Haskell/OCaml product (GHC RTS symbols, OCaml block-header signatures), and you need to recover closures/heap objects, evaluation order, and pattern-match branches
- Use: distinguish an OCaml native/bytecode product and analyze bytecode (ocamlrun script-header signature)
- Do not use: an imperative-language product (each has its own skill: C++ → [[re-cpp-abi]], Go → [[re-go]], Rust → [[re-rust]])
- Do not use: you only need function logic and the control flow is complete (a functional product's control flow is scattered, so direct decompilation pays little; see step 4)

## Tool setup

### readelf / llvm-nm (symbol analysis)

- Install and verify are in [[re-cpp-abi]] Tool setup

### ghc toolchain (Haskell side, optional)

- Linux/macOS: the GHC package (`apt install ghc` / `brew install ghc` / ghcup); Windows: ghcup (`winget install ghcup` or the official installer); verify: `ghc --version`
- Use: compile a comparison product with the same version, and verify closure/info-table shape (GHC versions differ a lot)

### ocamlobjinfo / ocamlopt (OCaml side, optional)

- Linux/macOS: the OCaml toolchain (`apt install ocaml` / `brew install ocaml`); Windows: opam (`winget install OCaml.opam`) or the official installer; verify: `ocamlobjinfo` processes any .cmx and prints the CRC and import table
- Use: bytecode-product / object-file structure analysis (ocamlobjinfo can read .cmo/.cmx/a bytecode executable)

### Ghidra / IDA (decompiler base)

- Install and verify are in [[re-ghidra]] / [[re-ida]]

### file / xxd / Python struct (byte-level check)

- Ship with the system (`file`/`xxd`); Python 3 ships `struct`
- Use: identify a bytecode product (ocamlrun script header), verify closure first-field / block-header bytes (examples in [[examples]])

## Procedure

Run in order; reversing emphasizes **data flow** rather than control flow (a functional product's control flow is scattered; see pitfall 4). Archive each step's products (path + sha256; see [[re-triage]]).

1. **Identify the runtime**:
    ```sh
    readelf -s sample | grep -iE 'ghc|stg_|RTS|HsMain|_closure|_info' | head   # GHC 特征
    readelf -s sample | grep -iE 'caml_' | head                                # OCaml 特征
    file sample                                                              # 字节码产物判别（脚本头）
    ```
   - GHC: `main` (C RTS entry) + RTS runtime symbols (`stg_*`/`hs_*`) + business symbols `Main_main_closure`/`Main_main_info` (the `module_name_closure/info` shape)
   - OCaml native: `main` → `caml_main` → `caml_startup_common` → `caml_start_program` → `caml<module>__entry`; `caml_startup`/`caml_startup_pooled` are equivalent entries for C embedding (the signature is also void (char_os **argv); the difference is the pooling flag and exception behavior); do not mistake them for the main chain; `caml_*` runtime symbols (caml_alloc/caml_apply2/3 and similar)
   - **Bytecode vs native**: `caml_start_program` exists only in the native runtime library (measured in 4.14.2 libasmrun.a) and is a native signature; the bytecode criterion uses `caml_interprete` (only libcamlrun.a has it); identify a bytecode product with `file` (`ocamlrun script executable`) / an `xxd` header (`#!...ocamlrun\n` script header + `T`/`C` magic + sections)
   - The entry chain is consistent across versions: runtime/main.c defines `main` and calls `caml_main(argv)` (`caml_main` is defined in startup_byt.c/startup_nat.c; the native chain is `main → caml_main → caml_startup_common → caml_start_program`; measured 4.14.2 addresses are in [[examples]]); the bytecode runtime entry is `caml_main → caml_startup_aux → caml_interprete`
   - Identification cheat sheet: GHC = a `stg_*` machinery-symbol group + `module_name_closure/info` pairs; OCaml native = a `caml_*` group + `caml<module>__<name>_<id>`; OCaml bytecode = a `#!ocamlrun` script header

2. **Closures and heap objects**:
   - GHC: heap-object layout of a thunk (an unevaluated closure) and an already-evaluated value — the first field of a closure is the info-table pointer (measured byte verification is in [[examples]]); a CAF is statically allocated as a thunk and evaluated only on first reference (lazy); `Main_main_closure` is a CAF, and its info points at thunk-evaluation code
   - GHC value shapes: unevaluated (thunk, info points at evaluation code) vs already-evaluated WHNF (info points at a constructor header/function header) — two states in the same address space; after evaluation the closure contents are overwritten
   - OCaml: block header (tag + size; on 64-bit header = (size<<10)|(color<<8)|tag); tagged-int judgment uses the value's low bit (bit 0; odd=integer, even=pointer/block)
   - Analysis: fields and constructors are the main leads (data-flow first)

3. **Calling convention**:
   - GHC: arguments are passed on the stack; the return is in registers R1-R3 (a boxed value is in R1); entry code pivots on the info table (an `_info` symbol = entry code)
   - OCaml: arguments are passed in registers (the first N); a closure call goes through `caml_applyN`; native code calling a closure = load registers + `caml_apply2/3` or jump directly to the entry
   - Analysis: identify the runtime wrapper first (`caml_apply` / stg entry), then enter user logic; tail-call optimization turns recursion into a jump (no growing stack frame); read it as a loop
   - Shared point of GHC and OCaml: a function is not "called"; it is "jumped to at the entry" — a `jmp` target address in the decompilation is the function entry; do not read it with call/ret pairing

4. **Analysis strategy (data-flow first)**:
   - Scattered control flow: lazy evaluation makes evaluation order unpredictable — static control-flow analysis has low value
   - Data-flow leads: closure-field initialization sites (constructor arguments), pattern-match branches (constructor-tag dispatch), string/constant references
   - Product: a data-flow diagram (constructor → field → use site) replaces a control-flow graph (joins the [[re-analyze/analysis-contract]] data contract)
   - Recover pattern matching: branches dispatch by constructor tag (OCaml) or info-table pointer comparison (GHC) — tag/pointer value → constructor index; recovering the constructor set recovers the data type
   - Product format (for the analysis report and the next stage to consume):
      ```
      Constructor C1 (tag 0, 2 fields) ← allocation site A (caml_alloc2 / info table)
        field0 ← function argument/constant (data source)
        field1 ← string-pool reference
      Use site: tag compare → branch B (business logic)
      ```

5. **Bytecode product (OCaml-specific)**:
    ```sh
    head -c 64 sample | xxd          # #!...ocamlrun 脚本头 + 魔数 T/C + 长度
    ocamlobjinfo sample              # 直接解析字节码可执行文件（导入单位/CRC）
    ```
   - A bytecode exe = script header + magic `T` + code region + each section's data; section names (CODE/PRIM/DATA/SYMB/CRCS and similar, 4 characters) and the big-endian length table are in the file-tail TOC; the file ends in `Caml1999X031` (structure in [[layout]]; byte samples in [[examples]])
   - Bytecode disassembly is not ordinary decompilation (the instruction set is OCaml bytecode's own); the analysis entry uses ocamlobjinfo's structure view

## Cross-domain joins

- [[re-binary-core]] gateway: this skill belongs there (the "Haskell/OCaml product" branch of the selection tree)
- [[re-analyze/analysis-contract]]: the data-flow diagram is handed off under the data contract
- [[re-cpp-abi]]: vtable/info-table comparison approach (table-pointer dispatch is isomorphic)

## Common pitfalls

- **RTS version differences**: Symptom — closure-layout interpretation fails; cause — GHC/OCaml version evolution; fix — confirm the layout against the target version (this skill's field table is measured on 9.14/4.14; see [[layout]])
- **A thunk's lazy evaluation misleads**: Symptom — an unevaluated closure is treated as already-evaluated data; cause — lazy evaluation; fix — distinguish a thunk header (info points at evaluation code) from an already-evaluated value (info points at a WHNF header); a CAF is a thunk until its first reference
- **OCaml bytecode is not native**: Symptom — decompilation is all runtime wrappers; cause — a bytecode product; fix — after identifying the ocamlrun script header / bytecode-segment signature, analyze by bytecode structure (not ordinary decompilation; `caml_start_program` exists only in the native runtime library and is a native signature; the bytecode criterion uses `caml_interprete`)
- **Scattered control flow makes static analysis fail**: Symptom — the function body has no continuous logic; cause — a functional compile product; fix — switch to data-flow analysis (step 4); do not chase control flow by force
- **tagged int misread**: Symptom — an integer is treated as a pointer / a pointer as an integer; cause — the OCaml value tag bit; fix — distinguish by the low bit (1=integer, 0=pointer); untag before access (int >> 1 takes the real value)
- **GHC module names use z-encoding**: Symptom — a symbol such as `GHCziInternalziTopHandler_runMainIO1_info` is hard to read; cause — `z` plus a lowercase letter escapes a special character (GHC mangling: `zi`=`.` `zu`=underscore `zz`=z `zc`=: `zh`=# and similar); fix — restore the module name by hand from the escape rules (`GHCziInternal` → `GHC.Internal`); after restoration it corresponds to the source module structure
- **An info table and entry code are two views of the same pointer**: Symptom — disassembly at the info pointer is field-table data rather than code; cause — the info-table pointer points at entry code, and table fields sit before the entry code; fix — start disassembly at the info pointer (that is the entry); read the field table at negative offsets
- **Tail-call optimization turns recursion into a jump**: Symptom — analyzing recursive logic by the call tree breaks; cause — a functional compiler's tail-call optimization (TCO); fix — a `jmp` back to the function's own address = recursion; read it as loop semantics; do not look for a growing stack frame
- **Lazy evaluation order is unpredictable**: Symptom — single-stepping dynamically in source order does not match; cause — a thunk is evaluated only on first reference, and the evaluation trigger is "where the value is needed" rather than "where the value is produced"; fix — dynamic analysis focuses on data dependence (which closure is forced); static analysis focuses on field initialization sites; do not assume execution order
- **Cross-runtime misjudgment (GHC machinery symbols treated as business code)**: Symptom — `stg_ap_*`/`stg_upd_frame_info` and similar are analyzed as business logic; cause — STG machinery symbols are the evaluation mechanism; fix — first exclude RTS machinery symbols by the `stg_`/`hs_` prefix; business code concentrates in `module_name_info` and fragments that call `caml_applyN`/`caml_alloc*`
