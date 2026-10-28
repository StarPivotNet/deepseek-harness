# ELF minimal parse examples

The examples use this machine's `/bin/ls` (x86-64 PIE) as the specimen. readelf output and the Python/byte samples can be compared field by field (build parameters differ across distros; trust the sample's own output). Structure definitions are in [[layout]].

## 1. readelf output comparison

### `readelf -h /bin/ls` (ELF header)

```
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  Type:                              DYN (Position-Independent Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Entry point address:               0x5540
  Start of program headers:          64 (bytes into file)
  Start of section headers:          164784 (bytes into file)
  Size of this header:               64 (bytes)
  Size of program headers:           56 (bytes)
  Number of program headers:         15
  Size of section headers:           64 (bytes)
  Number of section headers:         29
  Section header string table index: 28
```

Comparison points: magic byte 5 `02` = ELF64, byte 6 `01` = little-endian; e_type=DYN means it is PIE (every Address is an offset relative to the base); e_phoff=64, e_phentsize=56, e_phnum=15 → the program-header table occupies file `64..64+15*56`.

### `readelf -l /bin/ls` (program headers, excerpt)

```
Program Headers:
  Type           Offset             VirtAddr           PhysAddr
                 FileSiz            MemSiz              Flags  Align
  PHDR           0x0000000000000040 0x0000000000000040 ...
                 0x0000000000000348 0x0000000000000348  R      0x8
  INTERP         0x00000000000003ac 0x00000000000003ac ...
                 0x000000000000001c 0x000000000000001c  R      0x1
      [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]
  LOAD           0x0000000000000000 0x0000000000000000 ...
                 0x00000000000024a0 0x00000000000024a0  R      0x1000
  LOAD           0x0000000000003000 0x0000000000003000 ...
                 0x0000000000019ba1 0x0000000000019ba1  R E    0x1000
  LOAD           0x000000000001d000 0x000000000001d000 ...
                 0x0000000000008e00 0x0000000000008e00  R      0x1000
  LOAD           0x0000000000026d10 0x0000000000026d10 ...
                 0x0000000000001550 0x0000000000002868  RW     0x1000
  DYNAMIC        0x0000000000027a58 0x0000000000027a58 ...
                 0x00000000000001f0 0x00000000000001f0  RW     0x8
  GNU_STACK      0x0000000000000000 0x0000000000000000 ...
                 0x0000000000000000 0x0000000000000000  RW     0x10
  GNU_RELRO      0x0000000000026d10 0x0000000000026d10 ...
                 0x00000000000012f0 0x00000000000012f0  R      0x1
```

Comparison points: 4 PT_LOAD segments split by R / R E / R / RW permission (page-aligned 0x1000); the last LOAD has `FileSiz 0x1550 < MemSiz 0x2868` — the difference is the .bss zero-fill region; GNU_STACK with no X = NX; GNU_RELRO present + BIND_NOW from a later `readelf -d` = full RELRO (GOT read-only).

### `readelf -S /bin/ls` (section headers, excerpt)

```
  [ 2] .interp           PROGBITS         00000000000003ac  000003ac
  [ 3] .gnu.hash         GNU_HASH         00000000000003c8  000003c8
  [ 4] .dynsym           DYNSYM           0000000000000468  00000468
  [ 5] .dynstr           STRTAB           00000000000010c8  000010c8
  [ 8] .rela.dyn         RELA             00000000000018d8  000018d8
  [11] .text             PROGBITS         0000000000003040  00003040
  [13] .rodata           PROGBITS         000000000001d000  0001d000
  [19] .init_array       INIT_ARRAY       0000000000026d10  00026d10
  [20] .fini_array       FINI_ARRAY       0000000000026d18  00026d18
  [22] .dynamic          DYNAMIC          0000000000027a58  00027a58
  [23] .got              PROGBITS         0000000000027c48  00027c48
  [24] .data             PROGBITS         0000000000028000  00028000
  [25] .bss              NOBITS           0000000000028260  00028260
```

Comparison points: the sh_link relationship of `.dynsym` (section 4) and `.dynstr` (section 5) is visible in the Link column of the full `readelf -S` output; this machine's build is BIND_NOW, and the section table has no .plt/.rela.plt (only a lazy-binding binary has them; see [[layout]]); .init_array and .fini_array are both in the data segment (RW), constructor pointer arrays.

### `readelf -d /bin/ls` (dynamic section, excerpt)

```
Dynamic section at offset 0x27a58 contains 26 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libcap.so.2]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000000c (INIT)               0x3000
 0x0000000000000019 (INIT_ARRAY)         0x26d10
 0x000000000000001b (INIT_ARRAYSZ)       8 (bytes)
 0x000000006ffffef5 (GNU_HASH)           0x3c8
 0x0000000000000005 (STRTAB)             0x10c8
 0x0000000000000006 (SYMTAB)             0x468
 0x000000000000000b (SYMENT)             24 (bytes)
 0x0000000000000007 (RELA)               0x18d8
 0x000000000000001e (FLAGS)              BIND_NOW
```

Comparison points: NEEDED gives the dependency chain (libc.so.6 and similar); STRTAB/SYMTAB/SYMENT(24) locate the dynamic symbol table; GNU_HASH is the new-style symbol lookup; FLAGS=BIND_NOW means there is no lazy binding.

## 2. Python struct parse of ehdr (minimal runnable)

```python
import struct

def parse_ehdr(path):
    data = open(path, 'rb').read(64)
    if data[:4] != b'\x7fELF':
        raise ValueError('not an ELF')
    cls = data[4]                      # 1=ELF32 2=ELF64
    endian = '<' if data[5] == 1 else '>'   # 1=LE 2=BE
    if cls == 2:                       # ELF64: 16sHHIQQQIHHHHHH
        fmt = endian + '16sHHIQQQIHHHHHH'
        f = struct.unpack_from(fmt, data, 0)
        return dict(e_type=f[1], e_machine=f[2], e_entry=f[4],
                    e_phoff=f[5], e_shoff=f[6], e_ehsize=f[8],
                    e_phentsize=f[9], e_phnum=f[10],
                    e_shentsize=f[11], e_shnum=f[12], e_shstrndx=f[13])
    else:                              # ELF32: 16sHHIIIIIHHHHHH
        fmt = endian + '16sHHIIIIIHHHHHH'
        f = struct.unpack_from(fmt, data, 0)
        return dict(e_type=f[1], e_machine=f[2], e_entry=f[4],
                    e_phoff=f[5], e_shoff=f[6], e_ehsize=f[8],
                    e_phentsize=f[9], e_phnum=f[10],
                    e_shentsize=f[11], e_shnum=f[12], e_shstrndx=f[13])

print(parse_ehdr('/bin/ls'))
# {'e_type': 3, 'e_machine': 62, 'e_entry': 21824(0x5540), 'e_phoff': 64,
#  'e_shoff': 164784, 'e_ehsize': 64, 'e_phentsize': 56, 'e_phnum': 15,
#  'e_shentsize': 64, 'e_shnum': 29, 'e_shstrndx': 28}  —— 与 readelf -h 逐字段一致
```

phdr can be parsed the same way from e_phoff/e_phentsize/e_phnum given by the ehdr: `struct.unpack_from('<IIQQQQQQ', data, e_phoff + i*56)`; shdr is the same with `'<IIQQQQIIQQ'`. Judge class and endianness from e_ident first, then pick the format (the field table in [[layout]]).

## 3. Byte sample (first 64 bytes of /bin/ls, annotated field by field)

```
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
         magic──┘ ┆┆┆  └┬┘  └┬┘  └── e_ident 填充 7 字节
         class=02(ELF64) data=01(LE) ver=01 osabi=00(SystemV)
00000010: 0300 3e00 0100 0000 4055 0000 0000 0000  ..>.....@U......
         e_type=03(DYN)─┘  └e_machine=003e(62)   e_version=1
                                     e_entry=0x5540──────────┘
00000020: 4000 0000 0000 0000 b083 0200 0000 0000  @...............
         e_phoff=0x40───────────────────┘ e_shoff=0x283b0──────┘
00000030: 0000 0000 4000 3800 0f00 4000 1d00 1c00  ....@.8...@.....
         e_flags=0 e_ehsize=64(0x40) e_phentsize=56(0x38)
                   e_phnum=15(0x0f) e_shentsize=64(0x40)
                   e_shnum=29(0x1d) e_shstrndx=28(0x1c)
```

Manual check flow: compare `xxd -l 64 /bin/ls` with readelf -h output; if the magic does not match, first check whether it is a gzexe wrap / self-extracting packer (see the pitfall in SKILL.md); when header fields were forged, correct them to the real values and parse again (see the pitfall in SKILL.md).

## Lessons internalized

- Every parse reads e_ident[4] (class) and e_ident[5] (endianness) first, then picks the struct format — mixing 32/64 and LE/BE is the most common parser mistake
- A dynamic-link target uses SYMTAB/STRTAB/SYMENT from `readelf -d` as the index anchor; do not hardcode section offsets
- readelf output and file bytes must corroborate each other: a mismatch means the header was modified or the tool parse is ambiguous; check by hand before concluding

## Usage notes

- Static analysis needs no sandbox (see [[re-analyze/platform-tips]]); a cross-architecture ELF's `readelf -h/-l/-S` can run directly on this machine; only disassembly needs a cross tool
- The samples are taken from a system binary only for comparison; when analyzing a real sample, trust that sample's own three tables; do not force a template
