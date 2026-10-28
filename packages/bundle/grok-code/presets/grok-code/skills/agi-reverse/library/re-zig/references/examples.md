# Zig minimal parse examples

The examples use a real product compiled with this machine's zig 0.17.0-dev as the specimen (Debug and ReleaseSafe builds). readelf/disassembly output can be compared field by field with the measured data. Layout rules are in [[layout]].

## 0. Specimen build

```zig
// hello.zig
const std = @import("std");
fn check(x: u32) !u32 {
    if (x == 0) return error.BadInput;
    return x * 2;
}
pub fn main() void {
    const r = check(21) catch |e| {
        std.debug.print("err {s}\n", .{@errorName(e)});
        return;
    };
    std.debug.print("val {d}\n", .{r});
}
```

```sh
zig build-exe hello.zig -O Debug -femit-bin=hello_dbg
zig build-exe hello.zig -O ReleaseSafe -femit-bin=hello
```

## 1. Product discrimination (readelf, measured)

```
$ readelf -S hello | grep -E 'gcc_except|eh_frame'
  [ 2] .eh_frame_hdr
  [ 3] .eh_frame            ← has .eh_frame but no .gcc_except_table (cannot be a discriminator by itself)

$ readelf -s hello | grep -E '__gxx_personality_v0|_ZTV'   # no output = no C++ exceptions/RTTI
$ readelf -s hello | grep -E 'panic' | head -3
    26: 0000000000000000     8 TLS     LOCAL  DEFAULT    5 debug.panic_stage
    27: 0000000001088000     1 OBJECT  LOCAL  DEFAULT    9 debug.panicking
    64: 000000000107ac00   718 FUNC    LOCAL  DEFAULT    4 debug.panicExtra[...]
```

Comparison points: panic-chain symbols (0.17 names `debug.panicExtra`/`debug.panicking`; older versions are `std.debug.panic`). `.eh_frame` is a uniform C-compiler product. Discrimination looks at `.gcc_except_table` and `__gxx_personality_v0`.

## 2. Symbol visibility (LOCAL vs GLOBAL)

```
$ readelf -s hello | grep -wE '_start|main'
     2: 0000000001024c30    16 FUNC    LOCAL  DEFAULT    4 start._start
   838: 0000000001024c30    16 FUNC    GLOBAL DEFAULT    4 _start      ← the only default export
    18: 0000000001075540   388 FUNC    LOCAL  DEFAULT    4 hello.main   ← business function, LOCAL

$ readelf -s hello | grep FUNC | awk '$7=="GLOBAL"' | wc -l     # global function count (about 1-2)
```

Comparison points: business functions are LOCAL symbols (Debug/ReleaseSafe keep the symbol table but do not export). The hook/injection surface is counted from GLOBAL.

## 3. Error-union layout (disassembly, measured on 0.17)

Key fragment of `check` (Debug build):

```
00000000011df000 <hello.check>:
 11df008: 89 44 24 18             movl %eax, 0x18(%rsp)   ; argument x
 11df00c: 83 f8 00                cmpl $0x0, %eax
 11df00f: 0f 85 12 00 00 00       jne  ...                ; x!=0 takes the normal path
 11df015: e8 16 a3 e4 ff          callq lang.returnError  ; error-return path (0.17 name)
 11df01a: 48 8b 04 25 94 6a 27 01 movq 0x1276a94, %rax    ; load the error-table value (error code is on the high side)
 11df02c: bb 02 00 00 00          movl $0x2, %ebx         ; normal path: x*2
 11df05f: 48 89 54 24 10          movq %rdx, 0x10(%rsp)
 11df064: 89 44 24 10             movl %eax, 0x10(%rsp)   ; payload (u32) is in the low 4 bytes of the slot
 11df068: 66 c7 44 24 14 00 00    movw $0x0, 0x14(%rsp)   ; error code u16=0 (no error) at offset+4

; call site in main (catch check):
 11df0e0: b8 15 00 00 00          movl $0x15, %eax        ; x=21
 11df0e5: e8 16 ff ff ff          callq hello.check
 11df0ea: 48 89 44 24 28          movq %rax, 0x28(%rsp)   ; 8-byte slot
 11df0ef: 66 83 7c 24 2c 00       cmpw $0x0, 0x2c(%rsp)   ; ← error-code compare (catch/orelse)
 11df0f5: 0f 85 0e 00 00 00       jne  error branch
```

Comparison points: `E!u32` is an 8-byte slot — the payload is in the low 4 bytes, and the error code u16 is at offset +4 (no error = 0). `cmpw $0, slot+4` + a branch is the compile product of `catch`.

## 4. Measured error-union sizes (sizeOf)

```
$ zig build-exe sizez.zig -O ReleaseSafe -femit-bin=sizez && ./sizez
u32: 8  u128: 32  struct16: 24  u8: 4  bool: 4
```

| Payload | E!T size | Notes |
|---|---|---|
| u8/bool | 4 | payload + u16 error code + padding |
| u32/u64 | 8 | error code after the payload (high side) |
| u128 | 32 | error code in the first 2 bytes, payload inlined at alignment 16 |
| struct{u64,u64} | 24 | payload inlined at alignment 8 |

## 5. Startup chain and stack check (ReleaseSafe, measured)

```
$ readelf -s hello | grep -E '_start|probe'
   838: 0000000001024c30    16 FUNC    GLOBAL DEFAULT    4 _start
   833: 000000000107e460    54 FUNC    LOCAL  HIDDEN     4 __zig_probe_stack

0000000001024c30 <_start>:                ; 16-byte short stub
 1024c30: 48 8d 3d 21 e0 05 00  leaq 0x5e021(%rip), %rdi
 1024c37: e9 14 00 00 00       jmpq  0x1024c50           ; → std.start init
```

Comparison points: `_start` is a short stub jump. `__zig_probe_stack` is the stack probe (a security feature). ReleaseSafe keeps the `hello.main` LOCAL symbol and the panic chain.

## Lessons (internalized)

- The discriminator combination uses three independent features: no `.gcc_except_table` / no `__gxx_personality_v0` / no `_ZTV*`. `.eh_frame` does not count
- The error code is always u16, and the check pattern is always "compare the high 16 bits of the slot" — find `cmpw` + a branch first and every catch/orelse is located
- Symbol visibility decides the hook surface: a LOCAL symbol is only a lead. `export`/GLOBAL is the host call site

## Notes

- Measured on this machine's 0.17.0-dev. A user's product follows its own version (panic-chain names and error-union details change with the version; see version differences in [[layout]])
- Use together with [[re-cpp-abi]] (C++ discrimination) and [[re-analyze/analysis-contract]] (symbol-table passing)
