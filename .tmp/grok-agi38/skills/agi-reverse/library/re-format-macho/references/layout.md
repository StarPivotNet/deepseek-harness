# Mach-O layout: mach_header / load commands / segments, sections, and dyld information

A Mach-O file = mach_header + the load-commands region + segment data (__TEXT/__DATA/__LINKEDIT). Load commands carry the section table, imports and exports, the entry, and signature information at the same time; that is the biggest structural difference between Mach-O and ELF (ELF's section-header table is an independent array; Mach-O's "sections" are nested inside LC_SEGMENT_64). This file is mainly 64-bit; 32-bit differences are marked separately.

## mach_header (file header)

64-bit is 32 bytes total (32-bit is 28 bytes, with no reserved):

| Offset | Field | Size | Meaning |
|---|---|---|---|
| 0x00 | magic | u32 | 0xFEEDFACF=MH_MAGIC_64 (bytes in an LE file are cffaedfe); 0xFEEDFACE=32-bit; 0xCAFEBABE=fat |
| 0x04 | cputype | u32 | 0x01000007=x86_64 (7\|CPU_ARCH_ABI64) **0x0100000C=arm64** (12\|CPU_ARCH_ABI64) 7=i386 12=arm; **arm64e's cputype is the same as arm64 (both 0x0100000C); distinguish them by cpusubtype** — do not judge arm64e by cputype |
| 0x08 | cpusubtype | u32 | **x86_64: 3=`X86_64_ALL`, 8=`X86_64_H` (x86_64h, the Haswell feature subset)**; **arm64: 0=`ARM64_ALL`, 1=`ARM64_V8`, 2=`ARM64E`** (arm64e is distinguished here, not by cputype); the high bits are a **capability bit**: `CPU_SUBTYPE_LIB64=0x80000000`, and it **does not change the meaning of the base subtype** (`0x80000003` is still X86_64_ALL with a 64-bit library mark, not x86_64h); arm64e also uses `0x80000000` as a versioned-ptrauth-ABI mask |
| 0x0C | filetype | u32 | 1=MH_OBJECT 2=MH_EXECUTE 4=MH_CORE 6=MH_DYLIB 8=MH_BUNDLE 9=MH_DYLIB_STUB |
| 0x10 | ncmds | u32 | load-command count |
| 0x14 | sizeofcmds | u32 | total byte count of the load-commands region (the sum of each cmdsize) |
| 0x18 | flags | u32 | read them as the **bit values** in Apple `loader.h`; do not hand-number them consecutively: `0x1`=NOUNDEFS, `0x2`=INCRLINK, `0x4`=DYLDLINK, `0x8`=BINDATLOAD, `0x10`=PREBOUND, `0x20`=SPLIT_SEGS, **`0x40`=LAZY_INIT (deprecated)**, **`0x80`=TWOLEVEL**, `0x100`=FORCE_FLAT, `0x200`=NOMULTIDEFS, **`0x200000`=PIE**, **`0x800000`=HAS_TLV_DESCRIPTORS (TLS descriptors, common in modern products)** |
| 0x1C | reserved | u32 | 64-bit only, always 0 |

## load commands (LC) common header

The first 8 bytes of each LC are fixed: `cmd: u32 + cmdsize: u32`; cmdsize is the whole command's length (including those 8 bytes), and the walk follows that order. The lower bound is only those 8 bytes (the `load_command` header itself); there is no 16-byte claim; on 64-bit cmdsize must be a multiple of 8, on 32-bit a multiple of 4, and the structure's minimum size plus trailing sections/strings are checked against the specific cmd.

### Common LC type values

| Value | Name | Meaning |
|---|---|---|
| 0x01 | LC_SEGMENT | segment (32-bit) |
| 0x02 | LC_SYMTAB | symbol table (symoff/nsyms/stroff/strsize) |
| 0x05 | LC_UNIXTHREAD | old entry (the register state contains rip) |
| 0x0B | LC_DYSYMTAB | symbol-table classification (local/external/undefined range indexes) |
| 0x0C | LC_LOAD_DYLIB | dependent dynamic library |
| 0x0D | LC_ID_DYLIB | the dylib's own install name |
| 0x0E | LC_LOAD_DYLINKER | loader path (/usr/lib/dyld) |
| 0x19 | LC_SEGMENT_64 | segment (64-bit) |
| 0x1B | LC_UUID | 24-byte UUID |
| 0x1D | LC_CODE_SIGNATURE | signature region (dataoff/datasize) |
| 0x22 / 0x80000022 | LC_DYLD_INFO / _ONLY | dyld information table (new) |
| 0x24 | LC_VERSION_MIN_MACOSX | minimum macOS version (old style) |
| 0x26 | LC_FUNCTION_STARTS | compressed function-start address table |
| 0x80000028 | LC_MAIN | new entry (entryoff/stacksize) |
| 0x29 | LC_DATA_IN_CODE | in-code data-region table |
| 0x32 | LC_BUILD_VERSION | build version (platform+version, new style, replaces LC_VERSION_MIN_*) |
| 0x80000033 | LC_DYLD_EXPORTS_TRIE | standalone export trie (new) |
| 0x80000034 | LC_DYLD_CHAINED_FIXUPS | chained relocations (iOS 13+/macOS 10.15+) |

## LC_SEGMENT_64 (segment, 72 bytes; 32-bit LC_SEGMENT is 56 bytes)

| Offset | Field | Size | Meaning |
|---|---|---|---|
| 0x00 | cmd / cmdsize | u32×2 | 0x19 / 72+80×nsects |
| 0x08 | segname | 16 | segment name (__TEXT/__DATA/__LINKEDIT...) |
| 0x18 | vmaddr | u64 | segment load virtual address (__TEXT is usually 0x100000000) |
| 0x20 | vmsize | u64 | size in memory |
| 0x28 | fileoff | u64 | file offset |
| 0x30 | filesize | u64 | size in the file |
| 0x38 | maxprot | u32 | maximum memory permission (7=RWX) |
| 0x3C | initprot | u32 | initial permission (5=RX 3=RW 1=R) |
| 0x40 | nsects | u32 | section count |
| 0x44 | flags | u32 | 0 |

## section_64 (section, 80 bytes, nested inside a segment)

| Offset | Field | Size | Meaning |
|---|---|---|---|
| 0x00 | sectname | 16 | section name (__text/__data/__got...) |
| 0x10 | segname | 16 | owning segment name |
| 0x20 | addr | u64 | section start VA |
| 0x28 | size | u64 | section size |
| 0x30 | offset | u32 | file offset |
| 0x34 | align | u32 | power of 2 (4=16-byte alignment) |
| 0x38 | reloff / nreloc | u32×2 | relocation region (common in .o) |
| 0x40 | flags | u32 | low bits=section type (0x1=REGULAR 0x2=CSTRING_LITERALS 0x6=POINTERS 0x7=LAZY_POINTERS); high-bit attributes |
| 0x44 | reserved1 | u32 | indirect-symbol-table index (used by __got/__la_symbol_ptr) |
| 0x48 | reserved2 | u32 | stub size and similar |
| 0x4C | reserved3 | u32 | 0 |

## Typical segment/section layout (64-bit executable)

```
__PAGEZERO    vmaddr 0x0000000000000000  vmsize 4GB  (inaccessible; null-pointer crash guard)
__TEXT        vmaddr 0x0000000100000000  RX
  __text code / __stubs / __stub_helper / __cstring strings
  __unwind_info / __eh_frame
  __swift5_* (Swift metadata; see [[re-swift]])
__DATA        vmaddr 0x100002000         RW
  __got GOT (new products put it in __DATA_CONST) / __la_symbol_ptr / __data / __bss
__DATA_CONST  read-only constants (__got, __const; common in Swift products)
__LINKEDIT    trailing segment           R     (mapped read-only; link metadata; shared-cache storage differs)
  LC_SYMTAB symbol table / LC_DYSYMTAB classification / relocations / code signature / export trie
```

- The load range = the vmaddr interval covered by __TEXT..__LINKEDIT; __PAGEZERO is not mapped
- Entry VA = __TEXT.vmaddr + LC_MAIN.entryoff (a measured example is in [[examples]])
- GOT slots are initialized by dyld relocation (the bind table); after load the __DATA_CONST segment is made read-only

## dyld information

### LC_DYLD_INFO_ONLY (48 bytes; LC_DYLD_INFO has the same structure)

| Field | Meaning |
|---|---|
| rebase_off / rebase_size | base-fixup table (the low bits of a 64-bit address are written) |
| bind_off / bind_size | external-symbol bind table (non-lazy, such as a __got slot) |
| weak_bind_off / weak_bind_size | weak-symbol binding |
| lazy_bind_off / lazy_bind_size | lazy binding (__la_symbol_ptr, bound on first call) |
| export_off / export_size | export-symbol trie (a prefix tree: a byte is a key fork; a node stores the symbol offset + flags) |

### Dynamic-resolution chain

```
LC_LOAD_DYLIB → dependent-library list (otool -L)
LC_SYMTAB     → symbol table (nlist_64×nsyms + string table)
LC_DYLD_INFO_ONLY → five tables: rebase/bind/weak_bind/lazy_bind/export (weak_bind semantics are independent of bind and must not be merged in)
Export-symbol location: the export trie matches a prefix byte by byte → a leaf stores the symbol offset (relative to the trie region)
Bind-information location: the bind table's opcode stream (ADDR/SYMBOL/TYPE and similar) → GOT slot ← symbol
```

### nlist_64 (symbol entry, 16 bytes; 32-bit is 12 bytes)

| Offset | Field | Size | Meaning |
|---|---|---|---|
| 0x00 | n_strx | u32 | offset of the symbol name inside the string table |
| 0x04 | n_type | u8 | **read it in two layers**: base type = `n_type & N_TYPE(0x0e)`, values `0x0=N_UNDF`, `0x2=N_ABS`, **`0xE=N_SECT`**, `0xA=N_INDR`; attribute bits are judged separately — `N_EXT(0x01)` external, `N_PEXT(0x10)` private external. **Do not treat a combined value as a base type**: `0x0f` = `N_SECT\|N_EXT` (an external section-defined symbol), not undefined |
| 0x05 | n_sect | u8 | section index (starting at 1) |
| 0x06 | n_desc | u16 | reference count / library ordinal (two-level namespace) |
| 0x08 | n_value | u64 | address or value |

## fat (universal binary) header

| Field | Size | Meaning |
|---|---|---|
| magic | u32 | **a fat structure is always big-endian on disk** (independent of host endianness): a normal FAT file starts with **the bytes `CA FE BA BE`** (a big-endian read yields `FAT_MAGIC=0xcafebabe`); a little-endian read of those 4 bytes yields `0xbebafeca`, which is `FAT_CIGAM` — **that is the same bytes interpreted little-endian, not a "little-endian file"**. 64-bit fat: `FAT_MAGIC_64=0xcafebabf`. **Do not guess file endianness from the host's endianness** |
| nfat_arch | u32 | architecture-slice count |
| each fat_arch: cputype/cpusubtype/offset/size/align | each u32 (**also big-endian**) | offset is the absolute file offset of that slice; **`align` is "the power of 2 of the alignment"** — the slice must satisfy `2^align` alignment, not a fixed 4-byte alignment (a 64-bit fat in particular uses `fat_arch_64`, which also has a reserved field) |

## Version-difference points

- Entry: old binaries LC_UNIXTHREAD (0x05), new binaries LC_MAIN (0x80000028)
- Version command: LC_VERSION_MIN_MACOSX (0x24) → LC_BUILD_VERSION (0x32, extra platform field)
- dyld relocation: LC_DYLD_INFO_ONLY five tables (macOS 10.8+) → LC_DYLD_CHAINED_FIXUPS chained (iOS 13+/macOS 10.15+, lower startup cost)
- GOT location: __DATA,__got → __DATA_CONST,__got (iOS 13+/macOS 10.14+)
- The export trie can stand alone as LC_DYLD_EXPORTS_TRIE (LC_DYLD_INFO's export field is 0)

## Usage notes

- Static parsing needs no sandbox; a cross-architecture Mach-O (an arm64 slice) can be parsed directly on x86 Linux with llvm-objdump/llvm-otool; disassembly needs a cross tool
- Use together with [[re-imports]] (dylib dependencies/hijack surface), [[re-triage]] (triage), and [[re-lldb]] (dynamic)
