# Nim minimal parse examples

The examples use a real build from this machine's nim 2.2.10 as the specimen (`nim c -d:release --gc:orc`). The output and the Python parse can be checked field by field. The product's structure definition is in [[layout]].

## 0. Building the specimen

```nim
# hello.nim（含字符串比较、对象、字符串拼接）
import std/strutils
type Pet = object
  name: string
  age: int
proc check(s: string): bool =
  if s == "admin": return true
  false
proc main() =
  let p = Pet(name: "rex", age: 3)
  if check(p.name): echo "match: ", p.age
  else: echo "no: ", p.name & "!"
main()
```

```sh
nim c -d:release --gc:orc -o:hello_orc hello.nim     # orc（2.x 默认）
nim c --gc:refc -o:hello_refc hello.nim              # refc（对照）
```

## 1. Symbol comparison (a release build)

```
$ nm hello_orc | grep -iE 'NimMain|newString|eqStrings'
000000000000be10 T NimMain            ← 入口链（C main → NimMain → NimMainInner → NimMainModule）
000000000000bdf0 T NimMainInner
000000000000be30 T NimMainModule
0000000000008110 t rawNewString       ← 字符串分配（1.x 与 2.x 均为此 importc 名）
```

Comparison points: under release, `nimGC_*` / `eqStrings` are inlined (nm printing nothing is normal; see pitfalls 1 and 7 of SKILL.md). `NimMain*` and `rawNewString` are stable anchors. A debug build (`nim c --gc:orc`) shows `eqStrings`, `nimIncRefCyclic`, and `nimDecRefIsLastCyclicDyn`. A refc build shows `nimGC_setStackBottom`, `nimGCunref`, and `nimGCvisit` — the GC mode is decided directly from whether these symbols exist (the decision table is in [[layout]]).

## 2. Checking the string layout (the generated C struct, measured)

```
$ grep -A6 'struct NimStringV2' 生成缓存目录/@mhello.nim.c
struct NimStringV2 {
    NI len;
    NimStrPayload* p;
};
struct NimStrPayload {
    NI cap;
    NIM_CHAR data[SEQ_DECL_SIZE];   /* 内联字符 */
};
```

Comparison points: an orc product's string is `len + a payload pointer` (payload = cap + inline data). It is **not** the inline `len/reserved/data` of 1.x refc — a hand-written parser must pick the layout from the GC mode first (the decision table in [[layout]]). Bit 62 of cap (64-bit) is the literal flag strlitFlag.

## 3. Parsing NimStringV2 in Python (a memory view, a minimal example)

```python
import struct

# 模拟 Nim 对象布局：Pet = { name: NimStringV2, age: int }
# NimStringV2 = { len: int64, p: ptr }（orc 布局，64 位小端）

def read_nimstr_v2(buf, off):
    ln, p = struct.unpack_from('<QQ', buf, off)
    if p == 0 or ln == 0:
        return '' if ln == 0 else '(nil payload!)'
    cap, = struct.unpack_from('<Q', buf, p)
    data = buf[p+8 : p+8+ln]
    return data.decode('utf-8', 'replace')

# 用途：在转储中定位 NimStringV2（len 字段与 payload 里的 cap/data 互相印证），
# 还原字符串即找到校验/命令分发点。refc 布局改为内联读取：
def read_nimstr_desc(buf, off):
    ln, reserved = struct.unpack_from('<QQ', buf, off)
    return buf[off+16 : off+16+ln].decode('utf-8', 'replace')
```

Comparison points: under the v2 layout the string contents are on the heap (the payload), and the stack only has len + a pointer. When searching for a string, the `cap` prefix feature (an aligned capacity value) is more reliable than the contents.

## 4. Exception-implementation comparison (2.2.10, Linux x86-64)

```
$ nim c --gc:orc -o:exc_nim exc.nim     # 含 try/except 的程序
$ nm exc_nim | grep -iE 'setjmp|raiseException|personality'
00000000000075db t raiseExceptionAux__system_u4320
00000000000076db t raiseExceptionEx
# 无 nimSetjmp、无 __gxx_personality_v0 —— goto 式异常（无 setjmp）
$ readelf -S exc_nim | grep -E 'except_table|eh_frame'
  [15] .eh_frame_hdr
  [16] .eh_frame                # 有 unwind 信息但无 .gcc_except_table

# 对照：--exceptions:setjmp 构建
$ nim c --gc:orc --exceptions:setjmp -o:exc_nim_sj exc.nim
$ grep -c setjmp 生成缓存目录/@mexc.nim.c
3                                  # setjmp 调用出现 = 老式异常
```

Comparison points: a 2.2 default product "has exception handling but no setjmp symbol". `nimSetjmp` appears only under the old default or an explicit `--exceptions:setjmp`. The raise-path anchor is `raiseExceptionEx`.

## 5. A byte sample (the entry and the signature strings)

```
$ xxd -l 32 hello_orc | head -2
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
00000010: 0300 3e00 0100 0000 9011 0000 0000 0000  ..>.............
         e_type=03(DYN/PIE) e_machine=003e(x86-64) e_entry=0x1190

$ strings -n 6 hello_orc | grep -E '\.nim' | sort -u
@mhello.nim.c                          ← C 代码生成缓存文件名（含模块名，release 也嵌入）
@psystem.nim.c  @pstd@sprivate@sdigitsutils.nim.c  ← 运行时模块
fatal.nim                              ← std 运行时源文件名
```

Comparison points: the `.nim` signature strings embedded in a Nim product are `@m<module>.nim.c` (a C cache name) and std-module source file names. They do not include business source names — the stripped fallback matches the module list with `@m*.nim.c`.

## Lessons (internalized)

- Judge the GC mode before picking the string / GC layout. The decision table is in [[layout]]. The symbol test uses a debug build; a release build uses behavior
- The `NimMain*` trio and `rawNewString` / `eqStrings` are stable anchors across versions. Symbol location starts from them
- "No setjmp" for exceptions does not mean there is no exception handling: 2.2+ defaults to goto-style, and the anchor changes to `raiseExceptionEx`

## Notes

- Static analysis needs no sandbox. Differences between the measured output of this machine's nim 2.2.10 and the user's product are judged from the product's own symbols
- Use together with [[re-analyze/analysis-contract]] (symbol-table handoff) and [[re-triage]] (the first-look fallback)
