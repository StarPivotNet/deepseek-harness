# Zig binary layout: startup path / error union / panic chain / symbol visibility

The largest differences between a Zig product and a C product are error handling (an error union rather than an exception table) and symbol visibility (business functions are LOCAL). Confirm the Zig version before reading the layout — panic-chain names and error-union details evolve with the version.

## Startup path (ELF, x86-64 measured on 0.17.0-dev)

```
_start (GLOBAL)           ← linker entry (not visible to user code)
  └─ std.start runtime init (stack pointer / safe stack, exit handling)
       └─ main (LOCAL)    ← the user's main function (Zig's main is an ordinary function)
            exit goes through the std.start wrapper (handling after return)
```

- `_start` is the only business-unrelated GLOBAL function exported by default. `export fn` is what produces other exports
- Disassembly entry chain: `_start` is a short stub (on the order of 16 bytes) → the std.start init function (large, including security-feature installation)

## Symbol visibility (an important difference from C)

| Build mode | Business-function symbols | Notes |
|---|---|---|
| Debug / ReleaseSafe | LOCAL (symbol table kept) | visible to `nm` but not exported; `_start` is GLOBAL |
| ReleaseFast / ReleaseSmall | can be stripped | recover from behavior features |
| `export fn` | GLOBAL | explicit export (the C ABI boundary, the host call site) |

- Discriminator command: `readelf -s sample | grep FUNC | awk '$7=="GLOBAL"'` counts global functions
- The hook/injection surface is counted from the export table (GLOBAL + dynamic symbols). LOCAL symbols are only analysis leads

## Error union layout

`E!T` (an error union) compiles to "error code + payload": the error code is always u16 (0 = no error). The layout splits in two by payload size.

### Payload ≤ 8 bytes: one slot for the whole value, error code after the payload (high side)

| Payload type | Slot size (measured on 0.17) | Error-code position |
|---|---|---|
| u8 / bool | 4 bytes | after the payload (u8 is at offset 1) |
| u32 | 8 bytes | offset +4 (u16) |
| u64 | 8 bytes | high-side u16 |

### Payload > 8 bytes: error code in the first 2 bytes, payload inlined at its own alignment

| Payload type | Slot size (measured on 0.17) |
|---|---|
| u128 (alignment 16) | 32 bytes |
| struct { u64, u64 } (alignment 8) | 24 bytes |

- Disassembly recognition: after the call site, `cmpw $0, slot+offset` + a branch = the error-code check of `catch`/`orelse`. The error-return path `call lang.returnError` (the 0.17 name) then loads the error-table address
- `@errorName(e)` leaves the error name in the string pool (`__zig_tag_name_*` symbols/strings), which can recover the error semantics

## panic chain

| Version | Chain shape |
|---|---|
| 0.14+ (measured on 0.17.0-dev) | `@panic` / assertion → `debug.panicExtra` / `debug.FullPanic.defaultPanic` → `debug.panicking` state + print + abort; overflow check `debug.FullPanic(...).integerOverflow` |
| earlier versions | `std.debug.panic` (named directly) |

- The location method does not depend on the symbol name: find a "print + abort" sequence (a stack-check call near `__zig_probe_stack` is also common)
- `debug.panicking` is TLS state (a panic during a panic short-circuits)

## C ABI boundary

- **Assume the C ABI only on an `extern` / `export` boundary, or an explicit `callconv(.c)` boundary** — the compiler's definition: `c` is an alias of this target's C call, and `extern`/`export` functions get it by default. **An ordinary Zig `fn` uses Zig's default convention** (used when it is neither `export` nor `inline`, and it makes no guarantee about registers / stack alignment). When reversing an internal function, do not apply the C ABI's argument and return-value rules
- `.c` has its own mapping on each target (SysV AMD64 on x86-64 Linux, the x64 convention on Windows, AAPCS64 on AArch64) — that is a mapping **on the boundary**, not Zig's internal convention itself
- Import: `@extern`/`@cImport` → the dynamic symbol table (`readelf -d` NEEDED + UND symbols)
- Export: `export fn` → GLOBAL (the export table)
- Mixed-product discrimination: the Zig side has no RTTI/exception-table symbols (`_ZTV*` / `__gxx_personality_v0` are missing). The C++ side has them

## Version-difference points

- panic-chain names: the difference around 0.14 is large (`debug.panicExtra` vs `std.debug.panic`)
- Error-union layout: the u16 error code does not change. Slot size/alignment is tuned slightly by version (follow a measurement; [[examples]] has a 0.17 measurement)
- The `main` symbol shape is stable (a LOCAL ordinary function). `_start` is stable (GLOBAL)
- ReleaseFast may remove the panic chain (safety checks are off under `-Drelease-fast`)

## Notes

- Static analysis does not need a sandbox. Cross-architecture Zig products (ARM/RISC-V) follow the same layout rules (the error code stays u16). Slot size follows the pointer width
- Use together with [[re-analyze/analysis-contract]] (symbol-table passing) and [[re-cpp-abi]] (C++ discrimination)
