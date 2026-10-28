---
name: re-nim
type: atomic
description: >
  Nim build reversing: runtime identification, the NimString layout, and exception and GC paths.
  Triggers: `Nim逆向`, nim, NimString, NimMain, `nim 产物`.
capabilities: [lang-runtime-analysis]
---

# Nim reversing

## When to use / when not to use

- Use: a Nim build (`NimMain` / GC symbols, NimString layout) when you need to recover string logic, exception paths, and GC / ownership
- Use: a mixed Nim/C build, after grouping symbols by origin, for the Nim side of the code (that side follows this skill)
- Do not use: a pure C/C++ build (use the general path in [[re-cpp-abi]] / [[re-binary-core]])
- Do not use: only the function logic is needed (go straight to a decompiler skill)

## Tool setup

### readelf / llvm-nm (symbols and sections)

- Install and check as in the tool setup of [[re-cpp-abi]]
- Nim builds are mostly ELF (the Linux default is the C backend); on macOS use llvm-nm

### Ghidra / IDA (decompiler base)

- Install and check as in [[re-ghidra]] / [[re-ida]]; Nim symbols (NimMain / NimStringV2 and the rest) are readable as soon as they are imported

### nim compiler (optional, for a comparison build)

- Linux: `apt install nim` / `dnf install nim` / `pacman -S nim`; macOS: `brew install nim`; Windows: choosenim / the official installer
- Check: `nim -v`; purpose: compile a comparison build of the same version and confirm the string layout and GC symbol shape (version differences are in [[layout]])

### xxd + Python struct (byte-level check)

- Shipped with the system (`xxd`); Python 3 ships `struct`
- Purpose: when symbol or layout output looks wrong, parse NimString and object structures directly by offset (examples are in [[examples]])

## Steps

Run in order. Archive each product (path + sha256; see [[re-triage]]).

1. **Identify the build**:
   ```sh
   readelf -s sample | grep -iE 'NimMain|nimGC|NimString' | head   # ELF；Mach-O 用 llvm-nm
   readelf -s sample | grep -iE 'nimIncRef|nimDecRef|rawNewString|eqStrings' | head
   ```
   - Nim signs: `NimMain` (the entry chain), GC symbols (`nimGC_*` for refc / `nimIncRefCyclic` and similar for orc), and the `NimStringV2` / `NimStringDesc` structure types
   - Note: a release build often inlines or eliminates GC symbols (see pitfall 1); fall back on `NimMain` and the string functions
   - Entry chain: C `main` → `NimMain` → `NimMainInner` → `NimMainModule` (module init) → the business main
   - Module init order follows the dependency topology (import relations): the init section inside `NimMainModule` runs depended-on modules first — when breaking or drilling into the init section, match the call order against the import chain

2. **String and sequence layout (judge the GC mode first)**:
   - **orc/arc** (2.x defaults to orc): `NimStringV2 = {len: int, p: ptr NimStrPayload}`; `NimStrPayload = {cap: int, data: inline character array}` — a string is "len + a heap payload pointer", and the high bits of cap carry the literal flag (see [[layout]])
   - **refc** (the old default): `NimStringDesc = {len, reserved, data[]}` — the characters are inline in the struct
   - Locate: the `rawNewString` allocation call (this importc name is the same on 1.x and 2.x) → the structure layout → string operations (`eqStrings` and the rest)
   - Analysis: string-compare sites are the key logic (checks / protocol / command dispatch) — an `eqStrings` call site is a string-equality test
   - A sequence (seq) has the same shape as string: the v2 layout is also `len + payload pointer` (the payload carries cap), and refc is also `len/reserved + inline` — use the same decision table
   - Memory view (v2 layout, 64-bit):
     ```
     栈/对象内:  len(int64) | p(ptr) ───────────────┐
     堆上 payload:  cap(int64, bit62=字面量标记) | data[cap+1] ←┘
     ```
     The string itself is only a 16-byte handle; the contents live in a separate heap block — when analyzing an object, follow the handle, do not look for character data inside the object

3. **Finding strings in memory (dynamic / dump)**:
   ```python
   # 在内存转储中按 v2 布局找字符串：cap 是 8 字节对齐的容量值，data 后跟可打印 ASCII
   # 候选: 8 字节对齐的 cap + len 匹配的 data → 反推 NimStringV2 起点
   ```
   String contents are in the heap payload; the stack only has len + a pointer. Locate the payload by the `cap` prefix first, then walk back to the NimStringV2 that references it ([[examples]] has a full example).

4. **Exceptions and raises paths**:
   - Nim 2.2.x (Linux x86-64 default) uses a goto-style exception table and **has no setjmp symbol**; the raise path goes through `raiseExceptionEx` / `raiseExceptionAux`
   - The old default (`--exceptions:setjmp`, Nim 2.0 and earlier) uses setjmp/longjmp: the `nimSetjmp` symbol is visible
   - Locate: a `raiseExceptionEx` call site → exception-object allocation and the message → the catch branch (driven by the exception table)
   - Analysis: exception paths reveal input checks and failure handling, and they expose boundary conditions earlier than the happy path

5. **GC and reference counting (split by GC mode)**:
   - refc: reference counting plus cycle collection — call sites of `nimGC_*` / `nimGCunref` / `nimIncRef` / `nimDecRef`
   - orc/arc: ARC semantics — `nimIncRefCyclic` / `nimDecRefIsLastCyclicDyn` and similar; explicit inc/dec is rare, and releases are inserted at compile time
   - Analysis: GC call sites help identify object lifetime and ownership (together with the string layout); after release inlining, infer from allocation and free boundaries instead

6. **The C mixed-compile boundary**:
   - With `{.compile:}` / `{.importc:}` mixing, Nim and C symbols coexist: Nim symbols carry a module prefix (the `hello__u8` shape) and the runtime (NimMain / NimString); C symbols do not
   - The boundary is the logic entry: Nim business logic is inside the NimMain call chain, and C library calls go through the import table

7. **Fallback for a stripped build**:
   ```sh
   strings -n 6 sample | grep -E '@m.*\.nim\.c' | head      # C 生成缓存文件名（含模块名，release 也嵌入）
   strings -n 6 sample | grep -iE 'fatal\.nim|Exception' | head
   ```
   - After `NimMain` and the rest are stripped, identify the build from signature strings (`@m<module>.nim.c`, std runtime source file names) and runtime behavior (the [[re-triage]] first-look fallback); business source names are not embedded in the binary, so do not expect them

## Cross-domain handoff

- [[re-binary-core]] gateway: this skill belongs there (the "Nim build" branch of the selection tree)
- [[re-analyze/analysis-contract]]: the symbol table is passed through the data contract
- [[re-cpp-abi]]: the C mixed side, and the reference for telling "no RTTI" apart
- [[re-triage]]: first-look fallback (identify a stripped build from signature strings)

## Pitfalls

- **GC version differences (refc/orc)**: symptom — no reference-count calls are found; cause — orc has no explicit inc/dec (ARC semantics) and GC symbols are inlined in a release build; fix — confirm the Nim version and GC mode before analysis; a debug/refc build has a fuller symbol set
- **NimString layout changes with GC and version**: symptom — a hand-written parser that expects `len/reserved/data` reads a 2.x build completely wrong; cause — the 2.x orc default is `NimStringV2{len, p}` (the payload carries cap), and the inline `len/reserved/data` form is refc's NimStringDesc (the 1.x default); fix — confirm the build's GC mode first (the decision table is in [[layout]]) and then pick the layout: a debug build shows GC symbols (refc has `nimGCunref`, orc has `nimIncRefCyclic`); a release build is judged from allocation-function names and whether a cap field appears
- **Exported symbols were stripped**: symptom — no NimMain / NimString symbols; cause — strip; fix — identify from signature strings and runtime behavior (the step 6 fallback)
- **C mixed compile**: symptom — Nim and C symbols are mixed together; cause — `{.compile:}` mixing; fix — group by symbol origin and send the Nim side down this skill
- **A string-compare site is misread**: symptom — a key check is treated as an ordinary compare; cause — the `eqStrings` wrapper; fix — follow Nim string-function call sites to the compare logic
- **The exception implementation generation is misread**: symptom — looking for nimSetjmp the old way finds nothing; cause — 2.2+ Linux amd64 defaults to goto-style exceptions (no setjmp); fix — when there is no nimSetjmp, follow `raiseExceptionEx` and the exception table to the catch, and do not treat that as "no exception handling"
- **Release inlining makes the symbol set sparse**: symptom — nimGC_* / eqStrings that are visible in a debug build disappear in release; cause — `-d:release` inlining; fix — analyze a release build from behavior (allocation / free boundaries, the string-function call pattern); the symbol table is a clue, not the basis
- **String contents are on the heap; the stack only has the handle**: symptom — searching the stack for string contents finds nothing; cause — in the v2 layout the character data is in a separate payload heap block, and the stack only has the two fields `len + p`; fix — in a dynamic or dump case, locate the payload block from the cap-prefix signature first, then walk back to the handle that references it (the memory-location example is in [[examples]])
- **A 32-bit build halves the structure sizes**: symptom — applying the 64-bit layout table to a 32-bit build makes every offset wrong; cause — NI is 4 bytes on a 32-bit platform (NimStringV2 is 8 bytes rather than 16, and the NimStrPayload cap is 4 bytes); fix — confirm the bitness before parsing, and pick structure sizes from a 4-byte or 8-byte NI
- **A non-PIE old build has a fixed entry address**: symptom — `readelf -h` shows e_entry as an absolute address (for example 0x401xxx) that lines up directly in memory; cause — a non-PIE build (the old default); fix — locate the entry chain from symbols (the NimMain trio) regardless of PIE, but convert addresses according to e_type
