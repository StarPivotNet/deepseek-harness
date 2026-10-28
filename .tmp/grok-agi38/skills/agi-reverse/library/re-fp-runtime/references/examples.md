# Functional-runtime minimal parse examples

The examples use real products compiled on this machine with GHC 9.14.1 (ghcup) and OCaml 4.14.2 (opam) as specimens. readelf/nm/xxd output and byte checks can be compared field by field. Layout rules are in [[layout]].

## 0. Specimen build

```haskell
-- hello.hs
main :: IO ()
main = putStrLn "hi from ghc"
```

```ocaml
(* hello.ml *)
let add x y = x + y
let () = print_endline (string_of_int (add 40 2))
```

```sh
ghc -O1 hello.hs -o hello_ghc
ocamlopt -o hello_ocaml hello.ml     # 原生
ocamlc   -o hello_bc   hello.ml      # 字节码
```

## 1. GHC symbol comparison (measured with readelf/nm)

```
$ nm hello_ghc | grep -E 'Main_main|newCAF|hs_init'
0000000000407c12 T main                     ← C RTS 入口
00000000004da4f0 D Main_main_closure        ← 顶层 main 的 closure（CAF，数据段）
0000000000407bc8 T Main_main_info           ← entry code
00000000004da500 D Main_main4_closure
0000000000407be8 T Main_main4_info
0000000000494190 T newCAF                   ← CAF 分配（RTS）
000000000047f780 T hs_init_ghc              ← RTS 初始化

$ nm hello_ghc | grep -c stg_              # RTS STG 机械符号（实测 334 个）
334
$ nm hello_ghc | grep -E 'stg_upd_frame_info|stg_enter_info'
000000000049bba0 T stg_upd_frame_info      ← 更新帧（thunk 求值写回）
00000000004980e0 T stg_enter_info          ← 进入求值
```

Comparison points: `module_name_closure` (data) + `module_name_info` (code) come in pairs; `newCAF`/`hs_init_ghc` are RTS anchors; a `stg_*` machinery-symbol count on the order of hundreds is a GHC signature.

## 2. GHC closure byte check (first field = info pointer)

```python
import struct

# hello_ghc 非 PIE 时 vaddr == file offset；PIE 需先按 PT_LOAD 换算（见 re-format-elf 思路）
d = open('hello_ghc', 'rb').read()
# 用 readelf 的节映射换算 0x4da4f0 的文件偏移（此处示意：已换算）
off = 0x4da4f0                       # Main_main_closure vaddr
v = struct.unpack_from('<Q', d, off)[0]
print(hex(v))                        # 0x407bc8 == Main_main_info 地址
# 前 16 字节: info 指针 + 8 字节字段（CAF 载荷）
print(d[off:off+16].hex())
# c87b400000000000 0000000000000000
# └─ info 指针(0x407bc8)┘ └─ 载荷区(CAF 空载荷)┘

# 反汇编 entry code（0x407be8 = Main_main4_info）：加载 closure 跳转 runMainIO
#   leaq 0xd28da(%rip), %r14           ; 装载 Main_main1_closure（thunk）
#   jmp  GHCziInternalziTopHandler_runMainIO1_info   ; 求值链（z 编码: GHC.Internal）
```

Comparison points: the first 8 bytes of a closure = the info pointer (the dispatch point); entry code starts at the info pointer; `GHCziInternal` = `GHC.Internal` (z-encoding).

## 3. OCaml native symbol comparison (measured with nm)

```
$ nm hello_ocaml | grep -E 'camlHello__|caml_apply|caml_start|caml_alloc'
0000000000022a00 T caml_apply3             ← 闭包调用分派（3 参数）
0000000000022a50 T caml_apply2             ← 闭包调用分派（2 参数）
0000000000022ac0 T camlHello__add_267      ← 模块级函数：caml<模块>__<名>_<id>
00000000000239d0 T camlCamlinternalAtomic__entry   ← 各模块 entry
0000000000025ec0 T caml_startup_common     ← 入口链：caml_main → caml_startup_common
0000000000026150 T caml_startup            ← 等价 C API 入口（caml_startup(argv)）
0000000000026180 T caml_main               ← 入口链：main → caml_main（4.14.2 实测）
000000000004a990 T caml_start_program      ← 仅 native 运行库（libasmrun.a），是 native 特征
000000000004df68 D camlHello               ← 模块全局数据

$ nm hello_ocaml | grep -wE 'main|_start'
00000000000261f0 T main                    ← C 入口（call caml_main）
0000000000022540 T _start
```

Comparison points: `caml_applyN` is closure partial-application dispatch (driven by argument count); `caml_main` exists in 4.14.2 (0x26180; disassembly shows `main → call caml_main` → `caml_startup_common`); runtime/main.c defines `main` and calls `caml_main` (`caml_main` is defined in startup_byt.c/startup_nat.c); module entry symbols are `caml<module>__entry`.

## 4. OCaml bytecode product identification (measured with file + xxd)

```
$ file hello_bc
hello_bc: a /home/user/.opam/default/bin/ocamlrun script executable (binary data)
                                   ↑ file 直接识别脚本头（示例路径为脱敏占位）

$ xxd -l 64 hello_bc
00000000: 2321 2f68 6f6d 652f 7573 6572 2f2e 6f70  #!/home/user/.op
00000010: 616d 2f64 6566 6175 6c74 2f62 696e 2f6f  am/default/bin/o
00000020: 6361 6d6c 7275 6e0a 5400 0000 df02 0000  camlrun.T.......
00000030: 0000 0000 5700 0000 0100 0f00 1000 0000  ....W...........
         └ 脚本头 "#!...ocamlrun\n"（脱敏占位路径）┘ └魔数 T┘ └代码区（分节表在尾部 TOC）┘

$ ocamlobjinfo hello_bc | head -8        # 结构视图（导入单位/CRC）
File hello_bc
Imported units:
        -------------------------------- Stdlib__Weak
        -------------------------------- Stdlib__Unit
        ...
```

Comparison points: a bytecode exe header = `#!<ocamlrun path>\n` + magic `T` + a code region; sections (CODE/PRIM/DATA/SYMB/CRCS and similar) and the length table are in the file-tail TOC (big-endian, ending in `Caml1999X031`); `ocamlobjinfo` can parse a bytecode executable directly. The example path is a redacted placeholder (the real path on this machine contains a username).

## 5. OCaml object-file (.cmx) structure (measured with ocamlobjinfo)

```
$ ocamlobjinfo hello.cmx
File hello.cmx
Name: Hello
CRC of implementation: 63b3383284e2773bc5d450ad0fa510d5
Globals defined: Hello
Interfaces imported: Stdlib / CamlinternalFormatBasics ...
Clambda approximation:
  (0: function camlHello__add_267 arity 2 (closed) (inline) -> ...)
```

Comparison points: a `.cmx` carries a CLambda approximation (function name / arity / whether it is inlined) — arity information can be used directly to judge argument layout at a call site.

## 6. tagged int and block-header cheat sheet (for reading disassembly)

```
整数 42        → 内存值 0x55（42<<1|1），最低位=1
指向 block 的指针 → 最低位=0（8 字节对齐）
block 头(3 字段,tag 0) → (3<<10)|(0<<8)|0 = 0xC00
```

## Lessons internalized

- Start everything from a symbol anchor: a GHC `module_name_closure/info` pair, an OCaml `caml<module>__<name>_<id>`
- The first field of a closure = the info pointer is the dispatch core; pattern matching / closure calls all jump through it
- Identify bytecode with `file` / header bytes; `caml_start_program` exists only in the native runtime library and is a native signature; the bytecode criterion uses `caml_interprete`

## Usage notes

- Measured on this machine's 9.14.1 / 4.14.2; a user's product follows its own version (entry symbols/magic change with version; see version differences in [[layout]])
- Use together with [[re-analyze/analysis-contract]] (data-flow diagram handoff) and [[re-triage]] (triage fallback)
