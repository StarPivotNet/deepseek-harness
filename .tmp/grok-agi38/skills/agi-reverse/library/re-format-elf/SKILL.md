---
name: re-format-elf
description: >
  ELF format parsing: ehdr/phdr/shdr, GOT/PLT, init_array, symbol recovery.
  Triggers: ELF, `解析so`, dynamic section
capabilities: [elf-parser]
---

# ELF format parsing

## When to use / when not to use

- Use: the target is a Linux ELF executable or a .so shared library, and you need to understand the structure, look at .init_array, GOT/PLT and symbols, and assess security properties
- Do not use: PE (go to [[re-format-pe]]), Mach-O (go to [[re-format-macho]]); raw-binary firmware (non-standard ELF, go to the [[re-firmware]] domain)
- Do not use: you only need function logic (go straight to a decompiler skill)

## Tool setup

See [[re-analyze/platform-tips]] — ELF targets are mostly local Linux analysis; cross-architecture (ARM/MIPS firmware ELF) can use QEMU user-mode emulation; static analysis needs no sandbox.

### readelf (binutils)

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils` (`greadelf`)
- WSL: the Linux build
- Verify: `readelf --version`

### objdump (binutils)

- Same as above (macOS is `gobjdump`)
- Verify: `objdump -V`

### elfutils (eu-* tool family)

- Linux: `apt install elfutils` / `dnf install elfutils` / `pacman -S elfutils`
- macOS: `brew install elfutils` (`eu-readelf` and similar)
- Verify: `eu-readelf -h /bin/ls`

### patchelf (modify the ELF header/loader)

- Linux: `apt install patchelf` / `dnf install patchelf` / `pacman -S patchelf`
- macOS: `brew install patchelf`
- Verify: `patchelf --version`
- Use: analysis aid (change RPATH/interpreter) and repair; stay read-only during analysis

## Procedure

1. **readelf three tables (ehdr/phdr/shdr)**:
    ```sh
    readelf -h sample        # ELF 头: Class/Machine/Entry/Type
    readelf -l sample        # program headers（段→装载偏移，动态加载与 GNU_STACK 在这里）
    readelf -S sample        # section headers（节→地址/大小/标志）
    ```
   Compare the three tables: `-h` gives the entry point, `-l` gives the runtime memory layout, `-S` gives the static section view.

2. **Structure overview (ehdr/phdr/shdr layout)**: an ELF file = header + program-header table + sections + section-header table; on 64-bit, ehdr is 64 bytes, phdr is 56 bytes each, shdr is 64 bytes each. Key ehdr fields and offsets:
    ```
    0x00  e_ident[16]  magic(7F 45 4C 46)+class(0x04:1=32-bit/2=64-bit)+data(0x05)+OSABI(0x07)
    0x10  e_type        1=REL 2=EXEC 3=DYN(PIE/so) 4=CORE
    0x12  e_machine     62=x86-64 3=i386 183=AArch64 243=RISC-V 8=MIPS
    0x18  e_entry       entry point
    0x20  e_phoff       program-header table offset
    0x28  e_shoff       section-header table offset
    0x34  e_ehsize      64 (52 on 32-bit)
    0x38  e_phnum | 0x3A e_shentsize | 0x3C e_shnum | 0x3E e_shstrndx
    ```
   Relationship of the three tables: every field in `readelf -h` output can be checked by hand in the first 64 bytes of the file (`xxd -l 64`); a program header describes "which file ranges map into memory with what permission/alignment", and a section header describes "named ranges in the file such as symbols/strings/code". The full field table and layout diagram are in [[layout]].

3. **Init and fini callbacks (.init_array / .fini_array)**:
    ```sh
    readelf -S sample | grep -iE 'init_array|fini_array'
    readelf -a sample | grep -A5 -i 'init_array'
    objdump -s -j .init_array sample     # .init_array 是函数指针数组（数据节），用 -s 打印内容；-d 只反汇编代码节，实际不输出
    # 取到指针后逐个 `objdump -d --start-address=<ptr> --stop-address=<ptr+len> sample` 看回调函数
    ```
   The two run at different times; do not conflate them: function pointers in `.init_array` run in array order during startup init (before main) — init/anti-debug/decrypt often hide here, so check it first; pointers in `.fini_array` run in reverse array order during exit/dlclose cleanup, and do not follow main immediately (see the pitfall).

4. **GOT/PLT and dynamic symbols**:
    ```sh
    objdump -d -j .plt sample            # PLT 桩（外部函数调用入口）
    readelf -r sample | head -40         # 重定位表（含 GOT 条目）
    readelf -s sample | grep FUNC        # 符号表（动态符号在 .dynsym）
    objdump -T sample | grep UND         # 未定义符号 = 导入
    ```

5. **Dynamic-link structure parse points** (required for a .so and a dynamic executable):
    ```sh
    readelf -d sample                    # dynamic section: DT_* 标签
    readelf -s sample | head -20         # .dynsym 动态符号（导入/导出）
    readelf -r sample | grep -E 'JUMP_SLOT|GLOB_DAT|RELATIVE'
    ```
   Correlation chain: `DT_STRTAB`/`DT_SYMTAB` tags point at dynstr/dynsym; the symbol table is walked at the fixed entry size given by `DT_SYMENT` (a standard ELF32 `Elf32_Sym` is 16 bytes, ELF64 is 24 bytes; read `DT_SYMENT` and walk by that stride; do not hardcode 24); `DT_GNU_HASH` (new) replaces `DT_HASH` (old) for symbol lookup; the relocation type decides GOT-slot behavior — `R_X86_64_JUMP_SLOT` (PLT jump), `GLOB_DAT` (global variable), `RELATIVE` (base-relative). `DT_BIND_NOW` (or `DF_BIND_NOW` in FLAGS) present = all binding finishes at startup, no lazy binding (modern distro default); **but RELRO is an independent condition** — full RELRO = a `PT_GNU_RELRO` segment + BIND_NOW together (GOT becomes read-only); only `PT_GNU_RELRO` is Partial RELRO, and BIND_NOW alone does not imply RELRO. Dynamic-area parse details are in [[layout]].

6. **Symbol-recovery approach for a stripped binary**:
    ```sh
    readelf -s sample | wc -l            # 如果只剩 .dynsym（几十个），说明被 strip
    strings -n 6 sample | grep -iE 'error|usage|\.so'   # 错误消息泄露内部函数名
    ```
   Recovery flow: string cross-references (`strings -t x` takes the offset → locate the reference in Ghidra/radare2) → signature-match common library functions (Ghidra FLIRT / rizin `z` signatures) → walk call relationships backward from the main entry.

7. **Security-property check**:
    ```sh
    readelf -l sample | grep -E 'GNU_STACK|GNU_RELRO'
    # GNU_STACK 无 E 标志 = 不可执行栈（NX）
    # GNU_RELRO 存在 + BIND_NOW = 全 RELRO；GOT 只读
    readelf -s sample | grep -c __stack_chk_fail   # >0 仅为 SSP 线索（静态链接会因 libc 自带 SSP 误报；SSP 按函数施加，不代表全部函数受保护）
    ```
   RELRO/Canary/NX decide later dynamic analysis (for example whether GOT is writable) and the hijack-surface judgment in [[re-imports]].

8. **Manual parse and verification**: when readelf output is abnormal / header fields were forged, parse ehdr/phdr/shdr directly by offset with `xxd` + Python `struct` (a minimal runnable example and byte samples are in [[examples]]); do not discard a parse failure as a "corrupt file".

## Cross-domain joins

- [[re-binary-core]]: workflow step 3, ELF target format parsing
- [[re-mobile]]: Android native .so libraries (walk this skill before analyzing an app)
- [[re-firmware]]: ELF components inside embedded Linux firmware
- [[re-ctf]]: pwn/reversing challenges commonly target ELF
- When a packer/obfuscation is found, hand off to [[re-anti-analysis]]

## Common pitfalls

- **init_array hides init/anti-debug**: it runs earlier than main; looking only at main misses preset logic
- **After strip, symbols are only dynsym**: the `readelf -s` list shrinks sharply; recovery depends on string cross-references + signature matching; do not expect complete symbols
- **GOT overwrite is a common attack point**: when RELRO is not full, GOT is writable — both reversing and exploit analysis must confirm `GNU_RELRO` and `BIND_NOW`
- Checking a cross-architecture ELF (ARM/MIPS), host objdump reports "unknown format" → use the matching cross tool or QEMU emulation (see the [[re-analyze/platform-tips]] Linux branch)
- **The early init chain is more than init_array**: Symptom — `.init_array` was checked and earlier logic was still missed (for example `strcmp@GOT` was hooked but it does not reproduce at the main breakpoint); cause — early in dynamic-linker init, `.preinit_array` runs first (earlier than .init_array), and a malicious constructor can overwrite GOT / install a hook before main; fix — disassemble both `.preinit_array` and `.init_array`, break where `__libc_start_main` calls init, and check whether GOT entries were already rewritten before main
- **A forged section header makes readelf error**: Symptom — `readelf -S`/`-l` errors or output breaks (abnormal e_shentsize, absurd program-header count, missing dynamic section); cause — an obfuscated/adversarial sample forged header fields so the tool fails to parse; fix — check key ehdr fields by hand with `xxd` (e_shoff/e_shnum/e_shentsize/e_phnum), correct them to the real values and parse again; do not discard it as a "corrupt file"
- **fini does not run immediately after main**: Symptom — a breakpoint at the main return cannot find "cleanup" logic; cause — `fini`/`.fini_array` runs in the exit-cleanup stage (together with rtld_fini, atexit, and destructors), and does not follow main; fix — break cleanup logic on the exit path (exit_group / rtld_fini); do not look at the tail of main

- **An R_X86_64_RELATIVE addend must be consistent with the vaddr system**: `*slot = B + addend` (B = load bias). If the product's vaddr = ImageBase + RVA (a PE-conversion scene), the stored value in the file slot is the target vaddr → **addend = stored value**; only a "vaddr = pure RVA" system uses `stored value − ImageBase` — mixing the two formulas is a final-review bug (the error is a constant one base, and "it can dlopen" does not expose it)
- **An SHF_ALLOC section must be covered by a PT_LOAD**: the dynamic area (.dynsym/.dynstr/.hash) is marked SHF_ALLOC but is in no segment → the loader does not map it, and symbol resolution fails — when hand-writing an ELF generator, give the dynamic area its own PT_LOAD (p_offset and p_vaddr may be decoupled)
- **A DSO requires an executable stack and the process did not enable it → dlopen fails**: Symptom — `dlopen` reports `cannot enable executable stack as shared object requires: Invalid argument` (glibc refuses the dlopen path directly; this is not kernel behavior); cause — that DSO requires an executable stack and the process did not enable an executable stack at start, and "whether a missing `PT_GNU_STACK` counts as a requirement" depends on the target ABI's default stack permission (x86/x86-64/arm32 and similar default to executable; aarch64/riscv and similar default to non-executable); fix — the correct fix is to add a non-X `PT_GNU_STACK` to the target (PF_R|PF_W, no X, align 16); only when compatibility is truly required, temporarily set `glibc.rtld.execstack=2` (`=1` was measured ineffective; that value relaxes the limit and lowers security)
- **The relocation target segment must be writable**: if the segment containing r_offset of GLOB_DAT/RELATIVE is read-only (PF_R), an ld.so write is an immediate SIGSEGV — force PF_W on a section that contains a relocation target (v1 may give up RELRO; add PT_GNU_RELRO later)
- **Do not take shstrtab length with strlen**: a string table starts with `\0`, and strlen truncates to 1 at the first byte — use an explicit length/sizeof; the same trap hits .dynstr indexes
- **filesz > memsz is a readelf error**: `p_memsz = max(vsize, raw_size)` guarantees filesz≤memsz; BSS zero-fill semantics are handled by the loader
- **An ELF wrapped by gzexe (disguised as .sh)**: Symptom — dragging the target file into IDA reports "not an ELF format", but the file really is an executable program; cause — gzexe gzip-compresses the ELF and wraps it in a shell script (a common Linux compression method); fix — hexdump the header to confirm (script header + compressed data at the tail), `gzexe -d` to decompress and recover the real ELF, then analyze
- **An OLLVM-obfuscated + string-encrypted ELF: intercept at the GOT exit**: Symptom — a static patch is not workable (a critical string of the `51642` class is decrypted only at runtime and cannot be found in the binary); cause — OLLVM string encryption makes the string appear in memory only at runtime; fix — do not act at the data source; intercept at the data exit: the program's final send must call `sendto`/`send`/`write`/`SSL_write` through the GOT → hook the GOT slot, search for the needle in `buf`, replace it, and call the real function unchanged; first use debug mode to confirm the target string really appears in the send buffer, then patch; **OLLVM may obfuscate the GOT value itself** (a 64-bit constant `got_addend` assembled by `MOVZ+MOVK×3`) — when installing the hook, stay consistent with the obfuscation (change the `MOVZ+MOVK` immediates rather than writing the address directly)
- **code-cave injection + sentinel placeholders (no recompile)**: Symptom — the shellcode address to inject depends on the target's concrete layout, and every target is rewritten once; cause — a directly hardcoded address is not reusable; fix — every address inside the shellcode is a sentinel placeholder (for example starting with `0xCAFEBABE`); the patcher scans sentinels at inject time and replaces them with real addresses (cave address/offset/original init pointer can all be detected automatically); the inject point uses `.init_array` (called automatically at program start, earlier than main)
