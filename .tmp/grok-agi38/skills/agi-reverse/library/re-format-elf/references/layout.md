# ELF layout: ehdr / phdr / shdr field tables and a typical layout

An ELF file = ELF header (ehdr) + program-header table (phdr, for the loader) + sections + section-header table (shdr, for tools/the linker). The offsets and counts of the three tables are all given in the ehdr (e_phoff/e_phnum, e_shoff/e_shnum), and the file can be walked linearly by index. 32-bit and 64-bit fields are the same and sizes differ (this file is mainly 64-bit; 32-bit differences are marked separately).

## ELF header (ehdr)

### First 16 bytes of e_ident (0x00-0x0F)

| Offset | Name | Length | Typical value |
|---|---|---|---|
| 0x00 | EI_MAG | 4 | `7F 45 4C 46` (`\x7fELF`); if the first 4 bytes do not match, it is not ELF |
| 0x04 | EI_CLASS | 1 | 1=ELFCLASS32, 2=ELFCLASS64 |
| 0x05 | EI_DATA | 1 | 1=little-endian, 2=big-endian |
| 0x06 | EI_VERSION | 1 | always 1 |
| 0x07 | EI_OSABI | 1 | 0=System V, 3=Linux, 9=FreeBSD; firmware commonly 0 (bare metal) |
| 0x08 | EI_ABIVERSION | 1 | 0 |
| 0x09-0x0F | padding | 7 | 0 |

### Field table (64-bit, 64 bytes total; 32-bit is 52 bytes total)

| Offset (64) | Name | Type | Meaning |
|---|---|---|---|
| 0x10 | e_type | u16 | 1=REL (relocatable .o) 2=EXEC (fixed base) 3=DYN (PIE/shared library) 4=CORE |
| 0x12 | e_machine | u16 | 62=x86-64 3=i386 40=ARM 183=AArch64 8=MIPS 20=PPC 243=RISC-V |
| 0x14 | e_version | u32 | 1 |
| 0x18 | e_entry | u64 | entry point (under DYN, an offset relative to the base) |
| 0x20 | e_phoff | u64 | program-header table file offset |
| 0x28 | e_shoff | u64 | section-header table file offset |
| 0x30 | e_flags | u32 | architecture-specific (such as MIPS ABI/ISA/PIC/NaN bits; see EF_MIPS_*; **does not include endianness** — endianness is always e_ident[EI_DATA]) |
| 0x34 | e_ehsize | u16 | 64 (52 on 32-bit) |
| 0x36 | e_phentsize | u16 | 56 (32 on 32-bit) |
| 0x38 | e_phnum | u16 | program-header count (when =PN_XNUM 0xffff, the real value is in shdr[0].sh_info) |
| 0x3A | e_shentsize | u16 | 64 (40 on 32-bit) |
| 0x3C | e_shnum | u16 | section-header count (when =0, the real value is in shdr[0].sh_size — not the same rule as e_phnum) |
| 0x3E | e_shstrndx | u16 | index of the section-name table (.shstrtab) in the section-header table (when =SHN_XINDEX 0xffff, the real index is in shdr[0].sh_link) |

32-bit offset changes: e_entry=0x18 (4B), e_phoff=0x1C, e_shoff=0x20, e_flags=0x24, e_ehsize=0x28, e_phentsize=0x2A, e_phnum=0x2C, e_shentsize=0x2E, e_shnum=0x30, e_shstrndx=0x32.

## Program header (phdr) — load view

64-bit is 56 bytes each; 32-bit is 32 bytes.

| Offset (64) | Name | Type | Meaning |
|---|---|---|---|
| 0x00 | p_type | u32 | 1=PT_LOAD 2=PT_DYNAMIC 3=PT_INTERP 4=PT_NOTE 6=PT_PHDR 7=PT_TLS; GNU private: 0x6474e550=GNU_EH_FRAME 0x6474e551=GNU_STACK 0x6474e552=GNU_RELRO |
| 0x04 | p_flags | u32 | 1=PF_X 2=PF_W 4=PF_R |
| 0x08 | p_offset | u64 | segment offset in the file |
| 0x10 | p_vaddr | u64 | segment load virtual address (under DYN, an offset relative to the base) |
| 0x18 | p_paddr | u64 | physical address (ignored on most platforms) |
| 0x20 | p_filesz | u64 | size in the file (readelf requires ≤ memsz) |
| 0x28 | p_memsz | u64 | size in memory (the part > filesz is zero-filled, such as .bss) |
| 0x30 | p_align | u64 | alignment (page 0x1000; p_vaddr≡p_offset mod align) |

32-bit order differs: p_type, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_flags, p_align (p_flags is the 7th field, not the 2nd).

- PT_LOAD: defines a loadable segment that must be loaded into the process memory image (a normal file→memory mapping is built from p_filesz/p_memsz); an executable has at least 1, usually 2-4 (R, R X, R W). **Do not phrase it as "the only segment type that is mapped"** — when PT_PHDR exists it also describes the program-header table's position in the file and the memory image, and PT_TLS and similar also have runtime memory semantics
- PT_DYNAMIC: points at the .dynamic segment (a DT_* tag array), the dynamic-link entry
- PT_INTERP: interpreter path string (`/lib64/ld-linux-x86-64.so.2`)
- PT_GNU_STACK: **when present**, PF_X decides whether an executable stack is requested (the kernel controls user-stack permission from that header's p_flags). **When missing, do not infer uniformly**, and there are two layers: when the kernel loads the main program it decides by the target ABI/implementation (on x86-64 a missing header is treated as non-executable; on ia32 a missing PT_GNU_STACK takes READ_IMPLIES_EXEC and the mapping is actually executable); glibc's `dlopen` criterion differs — when the header is missing it follows that ABI's default stack permission (x86/x86-64/arm32 and similar are treated as requiring an executable stack; aarch64/riscv and similar do not), and "requires an executable stack while the process did not enable it" reports `cannot enable executable stack` (see the pitfall in SKILL.md)
- PT_GNU_RELRO: that range is mapped read-only (together with BIND_NOW this is full RELRO)

## Section header (shdr) — static view

64-bit is 64 bytes each; 32-bit is 40 bytes.

| Offset (64) | Name | Type | Meaning |
|---|---|---|---|
| 0x00 | sh_name | u32 | offset of the section name inside .shstrtab (0=unnamed) |
| 0x04 | sh_type | u32 | 1=PROGBITS 2=SYMTAB 3=STRTAB 4=RELA 5=HASH 6=DYNAMIC 8=NOBITS (.bss) 9=REL 11=DYNSYM 14=INIT_ARRAY 15=FINI_ARRAY; 0x6ffffff6=GNU_HASH |
| 0x08 | sh_flags | u64 | 1=SHF_WRITE 2=SHF_ALLOC 4=SHF_EXECINSTR (the A flag = must be loaded into memory) |
| 0x10 | sh_addr | u64 | virtual address after load (0 for a non-ALLOC section) |
| 0x18 | sh_offset | u64 | file offset (a NOBITS section has no contents) |
| 0x20 | sh_size | u64 | section size |
| 0x28 | sh_link | u32 | associated section index (symbol section → string section; RELA → symbol table) |
| 0x2C | sh_info | u32 | extra information (RELA: the relocated section's index) |
| 0x30 | sh_addralign | u64 | alignment |
| 0x38 | sh_entsize | u64 | fixed entry size (symbol 24, relocation 24, DT_ 16); 0=variable length |

## Common section layout

A typical non-PIE x86-64 executable (addresses increase left to right):

```
File offset    Section                 Memory (vaddr)   Attr
0x000000      ELF header (64B)
0x000040      Program headers (e_phnum×56B)
0x0001a8      .interp              0x4001a8      R   (interpreter path)
              .note.gnu.property   .note.ABI-tag
              .gnu.hash            symbol hash (new-style lookup)
              .dynsym              dynamic symbol table (24 bytes each)  A
              .dynstr              dynamic symbol string table           A
              .rela.dyn            relocations (DATA/RELATIVE)           A
              .rela.plt            relocations (JUMP_SLOT)               A
              .text                code                                  AX
              .rodata              read-only data                        A
              .eh_frame_hdr/.eh_frame
              .init_array/.fini_array  ctor/dtor pointer arrays          AW
              .dynamic             DT_* tag array                        AW
              .got/.got.plt        GOT                                   AW
              .data                initialized data                      AW
              .bss                 zero-initialized (NOBITS)             AW
File tail     .symtab/.strtab (debug symbols; can be stripped)
              .shstrtab            section-name table
              Section headers (pointed at by e_shoff)
```

Layout points:

- The program headers (load view) and section headers (static view) are two parallel views: a section may be in no segment (.comment, .shstrtab), and a segment may not cover the section-header table (most binaries are like this)
- The dynamic area (.dynsym/.dynstr/.gnu.hash/.rela.*/.dynamic/.got) all carry SHF_ALLOC, because they are needed at runtime; .symtab/.strtab do not — after strip only the dynamic area remains
- A lazy-binding binary has .plt/.plt.got + .rela.plt; a `-z now` (full RELRO) binary fills the GOT at load and it is read-only
- Modern distros default to `-z now` + PIE (e_type=DYN); some builds have no .plt (GOT direct call)

## Dynamic-link object chain (symbol-resolution path)

```
.dynamic (DT_* tags)
  ├─ DT_SYMTAB → .dynsym (one Elf64_Sym every 24 bytes: st_name→dynstr offset, st_value, st_size, st_info(bind+type), st_shndx)
  ├─ DT_STRTAB/DT_STRSZ → .dynstr (symbol-name string pool)
  ├─ DT_GNU_HASH / DT_HASH → symbol lookup table (GNU_HASH new format: bloom filter + buckets + chain; DT_HASH old format is only a bucket chain)
  ├─ DT_JMPREL + DT_PLTRELSZ → .rela.plt (R_X86_64_JUMP_SLOT: GOT slot → real function address)
  ├─ DT_RELA + DT_RELASZ → .rela.dyn (GLOB_DAT/RELATIVE/64)
  └─ DT_INIT_ARRAY/DT_INIT_ARRAYSZ → constructor pointer array (runs before main)
```

- R_X86_64_GLOB_DAT(6): GOT slot = symbol address; R_X86_64_JUMP_SLOT(7): PLT/GOT jump slot; R_X86_64_RELATIVE(8): slot = base + addend
- DT_BIND_NOW (or DT_FLAGS contains BIND_NOW): all relocations finish at load; GOT is read-only (the precondition of full RELRO)

## Lessons internalized

- Dispatch every offset by e_ident[4] (class): 32/64-bit structure sizes differ; a parser reads class first, then picks the format
- **Extended numbering is three independent rules**; a hand-written parser must implement them separately and cannot share one piece of logic: `e_phnum==PN_XNUM(0xffff)` → the real program-header count is in `shdr[0].sh_info`; `e_shnum==0` → the real section-header count is in `shdr[0].sh_size`; `e_shstrndx==SHN_XINDEX(0xffff)` → the real index is in `shdr[0].sh_link`. All three assume "section 0 exists" — pair them with a parser fixture to verify these three paths (tools generally already handle them)
- A big-endian target (common in MIPS firmware) swaps byte order by EI_DATA before parsing; do not default to little-endian
- readelf parsing normally ≠ the structure is "correct": the tool parser is tolerant; cross-check key conclusions (GOT writability, load range) against the phdr by hand

## Usage notes

- Static analysis needs no sandbox; a cross-architecture target (ARM/MIPS/RISC-V) uses `readelf -h -l` and does not depend on the host architecture; disassembly is what needs a cross tool
- Use together with [[re-imports]] (imports/exports/hijack surface) and [[re-triage]] (triage)
