# Mach-O minimal parse examples

The examples use a real x86_64 Mach-O executable built on this machine (Linux + clang 22 + ld64.lld) as the specimen. otool/llvm-objdump output and the Python/byte samples can be compared field by field. Build command (reproducible without a macOS environment; only clang + lld darwin support is required):

```sh
# hello.c: 定义 _start 入口（Mach-O 中 C 符号加下划线，链接器 -e 用 __start）
clang -target x86_64-apple-darwin -c hello.c -o hello.o
ld64.lld -arch x86_64 -platform_version macos 10.13 10.13 \
  -e __start -undefined dynamic_lookup hello.o -o hello_macho
```

## 1. Tool-output comparison

### `llvm-otool -h hello_macho` (mach_header, every field)

```
Mach header
      magic cputype cpusubtype  caps    filetype ncmds sizeofcmds      flags
 0xfeedfacf 16777223          3  0x80           2    13       1288 0x00200085
```

Comparison points: magic=0xfeedfacf (64-bit LE); cputype=16777223=0x01000007=x86_64; cpusubtype=3, caps=0x80 (the x86_64h capability bit); filetype=2=MH_EXECUTE; ncmds=13, sizeofcmds=1288 (the product relationship can cross-check the walk); flags=0x00200085 = NOUNDEFS(1)+DYLDLINK(2)+TWOLEVEL(4)+PIE(0x200000).

### `llvm-otool -l hello_macho` (load commands, excerpt)

```
Load command 0
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __PAGEZERO
   vmaddr 0x0000000000000000
   vmsize 0x0000000100000000      ← 4GB 空洞（空指针保护）
  maxprot 0x00000000  initprot 0x00000000  nsects 0
Load command 1
      cmd LC_SEGMENT_64
  cmdsize 552
  segname __TEXT
   vmaddr 0x0000000100000000
  fileoff 0  filesize 8192
  maxprot 0x00000005  initprot 0x00000005  nsects 6   ← RX
Section
  sectname __text   addr 0x100000550  size 0x1e  offset 1360  align 2^4
  sectname __stubs  addr 0x100000570  size 0x6   offset 1392  reserved1 1 (index into indirect symbol table)
  sectname __cstring addr 0x100000592 size 0xf  offset 1426  flags 0x00000002 (CSTRING_LITERALS)
Load command 2
      cmd LC_SEGMENT_64
  segname __DATA  vmaddr 0x100002000  fileoff 8192  initprot 0x3  nsects 3
Section
  sectname __got           addr 0x100002000 size 8 offset 8192 flags 0x6 (POINTERS) reserved1 0
  sectname __la_symbol_ptr addr 0x100002008 size 8 offset 8200 flags 0x7 (LAZY_POINTERS) reserved1 2
Load command 3
      cmd LC_SEGMENT_64  segname __LINKEDIT  vmaddr 0x100003000  fileoff 12288  nsects 0
Load command 4
            cmd LC_DYLD_INFO_ONLY
        cmdsize 48
     rebase_off 12288    rebase_size 8
       bind_off 12296    bind_size 24
  lazy_bind_off 12320    lazy_bind_size 16
     export_off 12336    export_size 48
Load command 5
     cmd LC_SYMTAB
  symoff 12392  nsyms 5  stroff 12488  strsize 72
Load command 7
          cmd LC_LOAD_DYLINKER  cmdsize 32  name /usr/lib/dyld (offset 12)
Load command 8
     cmd LC_UUID  cmdsize 24  uuid ...
Load command 9
      cmd LC_VERSION_MIN_MACOSX  cmdsize 16  version 10.13  sdk 10.13
Load command 10
       cmd LC_MAIN
  cmdsize 24
  entryoff 1360              ← 入口文件偏移 = __text 的 offset（0x550）
  stacksize 0
Load command 11
          cmd LC_LOAD_DYLIB
      cmdsize 40
         name libstub.dylib (offset 24)   ← 依赖库（本示例用 -L. -lstub 链接出的）
```

Comparison points: LC_SEGMENT_64's cmdsize=72+80×nsects (552=72+80×6, self-consistent); __text's addr matches LC_MAIN.entryoff (0x100000550 and 1360); __got/__la_symbol_ptr's reserved1 points at an LC_DYSYMTAB indirect-symbol-table index; LC_LOAD_DYLIB's name starts at offset 24 (16+8=24). Entry VA = 0x100000000 + 0x550 = 0x100000550.

### `llvm-nm -m hello_macho` (symbol table, including segment ownership)

```
0000000100002010 (__DATA,__data) non-external __dyld_private
0000000100000000 (__TEXT,__text) [referenced dynamically] external __mh_execute_header
0000000100000550 (__TEXT,__text) external __start
                 (undefined) external _puts (dynamically looked up)
                 (undefined) external dyld_stub_binder (dynamically looked up)
```

Comparison points: an externally defined symbol carries (segment, section) ownership; an undefined entry = an import (depends on dyld binding); `__mh_execute_header` is a Mach-O-specific "the file header is a symbol" (the address of macho_header). nlist_64's n_sect value points at a section index.

## 2. Python struct parse of mach_header (minimal runnable)

```python
import struct

def parse_macho_header(path):
    d = open(path, 'rb').read(32)
    magic = struct.unpack_from('<I', d, 0)[0]
    if magic == 0xFEEDFACF:        # MH_MAGIC_64（LE 文件字节 cffaedfe）
        f = struct.unpack_from('<IIIIIIII', d, 0)   # 8 个 u32 = 32 字节
        return dict(magic=hex(f[0]), cputype=f[1], cpusubtype=f[2],
                    filetype=f[3], ncmds=f[4], sizeofcmds=f[5],
                    flags=hex(f[6]), reserved=f[7])
    if magic == 0xFEEDFACE:        # 32 位，28 字节
        f = struct.unpack_from('<IIIIIII', d, 0)
        return dict(magic=hex(f[0]), cputype=f[1], cpusubtype=f[2],
                    filetype=f[3], ncmds=f[4], sizeofcmds=f[5], flags=hex(f[6]))
    raise ValueError('not a Mach-O (magic %x)' % magic)

print(parse_macho_header('hello_macho'))
# {'magic': '0xfeedfacf', 'cputype': 16777223, 'cpusubtype': 3, 'filetype': 2,
#  'ncmds': 13, 'sizeofcmds': 1288, 'flags': '0x200085', 'reserved': 0}
# —— 与 llvm-otool -h 逐字段一致
```

The LCs can be walked further from mach_header's ncmds/cmdsize: the first 8 bytes are `I I` (cmd, cmdsize); cmdsize=0 or exceeding the sizeofcmds total is a walk anomaly. LC_SEGMENT_64 is expanded with `'<I I 16s QQQQQ II II'` (72 bytes), then each 80-byte section_64 is parsed by nsects.

## 3. Byte sample (first 32 bytes of hello_macho, annotated field by field)

```
00000000: cffa edfe 0700 0001 0300 0080 0200 0000  ................
         magic──┘ └cputype(0x01000007=x86_64)┘ └cpusubtype(0x80000003)┘
         filetype=02(MH_EXECUTE)───────────┘
00000010: 0d00 0000 0805 0000 8500 2000 0000 0000  .......... .....
         ncmds=13(0x0d)──┘ └sizeofcmds=1288(0x508)  └flags=0x00200085
         reserved=0────────────────────────┘
```

Comparison flow: compare `xxd -l 32 hello_macho` with `llvm-otool -h` output; if the magic does not match, first check whether it is fat (cafebabe), then decide whether to `lipo -thin` a slice (see the pitfall in SKILL.md).

## 4. Export trie and bind table (LC_DYLD_INFO_ONLY parse)

```python
import struct

d = open('hello_macho', 'rb').read()
# 读 LC_DYLD_INFO_ONLY（第 5 条 LC，前 8 字节 cmd/cmdsize）
off = 32
for _ in range(5):
    cmd, size = struct.unpack_from('<II', d, off)
    assert size >= 8
    off += size
    if cmd == 0x80000022:          # LC_DYLD_INFO_ONLY
        (r_off, r_sz, b_off, b_sz, w_off, w_sz, l_off, l_sz, e_off, e_sz) = \
            struct.unpack_from('<10Q', d, off)
        print('export trie: off=%d size=%d' % (e_off, e_sz))
        print('export trie 原始字节:', d[e_off:e_off+e_sz].hex())
        break
```

This example's raw trie bytes (starting at export_off=12336, 48 bytes):

```
00003030: 0001 5f5f 0006 0002 7374 6172 7400 226d  ..__....start."m
00003040: 685f 6578 6563 7574 655f 6865 6164 6572  h_execute_header
00003050: 0027 0300 d00a 0002 0000 0000 0000 0000  .'..............
```

Decode (dyld export-trie format: an edge is a `\0`-terminated string, and a child-node offset is a uleb128 relative to the trie start — Apple dyld (MachOAnalyzer.cpp), lld (ExportTrie.cpp), and the LLVM parser agree; there is no second edge format):

```
0x00: 00                root node terminalSize=0 (not a terminal)
      01                child count=1
      5f 5f 00          edge string "__" (a Mach-O symbol name has an underscore prefix)
      06                child absolute offset 6 → 0x3036
0x06: 00 02             terminalSize=0; child count=2
      73..74 00         edge "start"
      22                child offset 34 → 0x3052
      6d..72 00         edge "mh_execute_header"
      27                child offset 39 → 0x3057
0x22: 03 00 d0 0a 00    terminalSize=3; flags=0; address=uleb128(d0 0a)=0x550
                        → __start @ 0x100000000+0x550=0x100000550 (matches otool ✓)
0x27: 02 00 00 00 00    terminalSize=2; flags=0; address=0
                        → __mh_execute_header @ 0x100000000 (the file header is the symbol)
```

Note that `d0 0a` is a two-byte uleb128 (the high bit of 0xd0 = 1, so read continues): 0x50 | (0x0a<<7) = 0x550. Decoding it by hand once is enough to own the dyld export-table format: every producer (Apple ld64/lld) uses the same `\0`-terminated edge + a uleb128 offset relative to the trie start, and a decode script only has to handle that one form.

## Lessons internalized

- Every parse looks at magic first to split 64/32-bit (the field counts differ); fat is sliced first
- A load-command walk trusts only cmdsize, not information outside ncmds; each LC is at least 8 bytes (the `load_command` header); ncmds×8 > sizeofcmds is an anomaly, and the sum of each cmdsize must equal sizeofcmds
- Segments and sections are a tree (segment → section), not a flat array; a section address = a relative offset inside the segment vmaddr
- otool output and file bytes must corroborate each other: a mismatch means the header was modified or the tool parse is ambiguous; check by hand before concluding

## Usage notes

- On Linux, parse Mach-O with llvm-otool/llvm-objdump/llvm-lipo (they ship with the llvm package); output matches macOS; only disassembly needs a cross environment
- The samples come from a minimal binary built on this machine; when analyzing a real sample, trust that sample's own load commands; do not force a template
