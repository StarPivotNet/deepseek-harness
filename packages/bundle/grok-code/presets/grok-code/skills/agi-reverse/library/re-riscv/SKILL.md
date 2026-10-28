---
name: re-riscv
description: >
  RISC-V architecture reversing: RV32/RV64, compressed instructions (RVC), gp-relative addressing, the ABI and the ecall syscall convention, toolchain fingerprints.
  Triggers: RISC-V, riscv, RV32, RV64, RVC, `压缩指令`, ecall, ESP32-C3, GD32V.
capabilities: [arch-analysis]
---

# RISC-V architecture reversing (RV32/RV64, RVC, gp-relative addressing)

## When to use / when not to use

- Use: an RV32/RV64 binary — a Linux user-mode program, bare-metal firmware, a RISC-V MCU firmware (an ESP32-C3-class RV32IMC)
- Use: a code stream mixed with compressed instructions (RVC), recovering gp-relative addressing, identifying the RISC-V ABI, and the ecall syscall / environment-call boundary
- Use: toolchain and library-function fingerprints (the glibc/musl/newlib family, instruction-extension features)
- Do not use: another architecture such as ARM / x86 / MIPS (the general base is [[re-binary-core]]; this skill only adds RISC-V-specific semantics)
- Do not use: when the toolchain is extremely custom and there is no lead, go to [[re-fw-emulate]] emulation first (if it runs, watch the behavior, then come back to static)
- Do not use: only unpacking firmware to see the contents ([[re-fw-extract]]) / analyzing the filesystem and config ([[re-fw-rootfs]]) / booting the firmware as a whole ([[re-fw-emulate]])

## Tool setup

Verify every tool before use. Static analysis may skip the sandbox. qemu dynamic execution defaults to the sandbox plus network isolation (the top rule in [[re-analyze/platform-tips]]).

### A decompiler (Ghidra or IDA, either one)

- Ghidra (a built-in RISC-V processor module, RV32/RV64 + the I/M/A/F/D/C extensions, and it handles RVC compressed instructions automatically):
  - Linux: the official release package (needs a JDK). Some distro repos have `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`. Windows: the official zip
  - Check: `analyzeHeadless -help` (headless mode) or import a RISC-V ELF in the GUI
- IDA: the commercial edition includes a RISC-V module. The Freeware edition's architecture support follows the official page
- On import, confirm RV32/RV64 and the endianness — standard RISC-V is little-endian, and a big-endian variant is rare. The wrong choice misaligns everything

### readelf / file — confirm the architecture and byte order (binutils)

- Linux: shipped with binutils (`apt install binutils` and the rest). macOS: `brew install binutils` or the LLVM readelf. Windows: inside WSL
- Check: `readelf --version`

### The binutils cross toolchain — RISC-V disassembly / the symbol table (objdump)

- Debian/Ubuntu: `apt install binutils-riscv64-linux-gnu` (provides `riscv64-linux-gnu-objdump`; the compiler chain adds `gcc-riscv64-linux-gnu`, and the gcc dependency pulls in the binutils package)
- Fedora: `dnf install binutils-riscv64-linux-gnu gcc-riscv64-linux-gnu` (the cross-binutils / cross-gcc source packages, providing `riscv64-linux-gnu-objdump`. The official repos have no riscv64-unknown-elf bare-metal toolchain. Bare-metal disassembly uses riscv64-linux-gnu-objdump, and RVC support is the same)
- Arch: `pacman -S riscv64-elf-binutils riscv64-elf-gcc` (bare-metal, providing `riscv64-unknown-elf-objdump`) or `pacman -S riscv64-linux-gnu-binutils riscv64-linux-gnu-gcc` (user mode)
- macOS: `brew install riscv64-elf-binutils riscv64-elf-gcc` (homebrew-core, providing `riscv64-unknown-elf-objdump`). Windows/WSL: the Linux build inside WSL
- Check, one command per installed package: `binutils-riscv64-linux-gnu` → `riscv64-linux-gnu-objdump --version` (Debian/Ubuntu/Fedora). `binutils-riscv64-unknown-elf` → `riscv64-unknown-elf-objdump --version` (Arch/brew; Debian/Ubuntu lists that package separately when a bare-metal triplet is needed). objdump recognizes an RVC mixed stream automatically (2/4 bytes)

### qemu-riscv64 / qemu-riscv32 — RISC-V user-mode emulation (dynamic verification)

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu` (includes user mode). Windows/WSL: the Linux build inside WSL
- 64-bit is `qemu-riscv64`, 32-bit is `qemu-riscv32`. `-L <rootfs>` names the source of dynamic libraries and the linker. `-strace` traces syscalls
- Check: `qemu-riscv64 --version`, `qemu-riscv32 --version`
- Bare-metal RISC-V (no OS) cannot use qemu-user — use `qemu-system-riscv64/32` (from Debian trixie / Ubuntu 25.10 the separate package is `apt install qemu-system-riscv`; Ubuntu 24.04 and earlier, and Debian bookworm, have it inside `qemu-system-misc`; Fedora / Arch are `dnf install qemu-system-riscv` / `pacman -S qemu-system-riscv`) with `-machine virt` or a board model (`-s -S` attaches gdb), or [[re-emulation]] with Unicorn instruction by instruction

### gdb-multiarch — cross debugging

- Linux: Debian/Ubuntu `apt install gdb-multiarch` (riscv32/riscv64 targets are built in). Fedora `dnf install gdb` (the official gdb supports several targets). Arch `pacman -S gdb` (multiarch is built in)
- macOS: `brew install gdb` (needs a Developer Tools entitlement; see the macOS branch of [[re-analyze/platform-tips]]) or the Linux build inside WSL. Windows/WSL: the Linux build inside WSL
- Check: Debian/Ubuntu `gdb-multiarch --version`. Fedora/Arch `gdb --version`. After loading the firmware, `set architecture riscv:rv64` (or riscv:rv32) and then `info registers` to confirm

## Steps

Run in order and archive each result. Dynamic execution defaults to the sandbox.

1. **Confirm the architecture (RV32/RV64 + byte order)**:
   ```sh
   file target.bin                 # "RISC-V" + 32-bit/64-bit + little-endian 提示
   file target.elf
   readelf -h target.elf           # Machine=RISC-V (243)；Data=little-endian；Flags 含 RVC/浮点 ABI 位
   readelf -A target.elf | head    # Tag_RISCV_arch 属性，如 rv64imafdc
   ```
   - e_flags (the Flags field of readelf -h): `EF_RISCV_RVC` (0x1) = compressed instructions are present. The floating-point ABI bit mask is 0x6 (0 = soft float, 2 = single-precision F, 4 = double-precision D, 6 = quad-precision Q). `EF_RISCV_RVE` (0x8) = the RV32E reduced register set
   - Standard RISC-V is little-endian. A big-endian variant is rare. Trust the actual file/readelf output
   - A bare-metal .bin (no ELF header) is decided by the reset-vector context and the instruction shape in step 2 (RV32 fixed-width 4 bytes vs an RVC mix of 2/4 bytes)

2. **Locate the entry (reset / startup code)**:
   - **Linux user mode**: the entry is the ELF e_entry (the Entry point of `readelf -h`) = `_start`. A dynamically linked program goes through ld.so first (PT_INTERP). Breakpoints and analysis start at _start
   - **Bare metal**: RISC-V has no fixed vector table (contrast ARM Cortex-M). The entry is the SoC datasheet's reset vector. The QEMU virt machine's reset vector is in MROM at `0x1000` (the reset stub then jumps to start_addr, default DRAM `0x80000000`, and `0x20000000` for a pflash firmware case) — **do not treat the DRAM base as the reset entry**. Some MCU flash bases look like 0x08000000. The exception / interrupt vector base is the mtvec (M-mode) / stvec (S-mode) CSR, and trap-handler code is located from the CSR value
   - The startup flow is generally: set the stack (`la sp, ...`) → copy .data / zero .bss → jump to main (bare metal) or __libc_start_main (Linux)
   - After the entry is located, mark it in the decompiler and expand the main logic along the call chain

3. **Identify RVC compressed instructions (a 2/4-byte mix; do not cut at a fixed width)**:
   - RVC makes code 2-byte aligned (a halfword), and every address is even. A 32-bit instruction can land on an odd halfword at 2 mod 4 — it cannot be cut at a fixed 4-byte stride
   - A wrong start → the whole instruction stream is misaligned into garbage. The correct method: use a disassembler that supports RVC (Ghidra / riscv64-*-objdump recognize it automatically), align from the entry or a jump target, and a legal compressed instruction (c.addi/c.li/c.j/c.lw and the rest) means the alignment is correct
   - Identification signals: the e_flags RVC bit (0x1), objdump output that contains 2-byte instructions, a bare-metal firmware compiled with -Os
   - 16-bit and 32-bit instructions interleaved inside the same function is normal. There is no fixed stride

4. **Recover gp-relative addressing (a lui+addi pair, .sdata/.sbss)**:
   - gp (x3) = `__global_pointer$`. It generally lands inside the .sdata section, and a 12-bit signed offset (±2048) covers the .sdata/.sbss small-data area
   - The access shape: at startup, `lui gp, %hi(...)` + `addi gp, gp, %lo(...)` sets it once → later `lw/ld aN, off(gp)` is a small-offset data access (globals of 8 bytes or less under the default -msmall-data-limit go through gp)
   - After symbols are stripped: compute the real gp value from the lui+addi sequence in the _start/crt0 prologue → mark it in the decompiler → recover data references. When there is an ELF, `readelf -s` looks up the `__global_pointer$` symbol value
   - When gp is missing, these accesses parse as "an unknown global" and the data flow is scattered — fix gp before analyzing (see pitfall 2)

5. **Identify the ABI (the integer / floating-point ABI, the a0-a7 convention)**:
   - The integer convention: arguments a0-a7 (x10-x17; from the 9th onward, the stack), the return value a0, callee-saved s0-s11 (x8-x9, x18-x27). ra=x1, sp=x2, gp=x3, tp=x4, fp=s0(x8). At a call boundary sp is 16-byte aligned
   - ABI names: RV32 is ilp32/ilp32f/ilp32d, RV64 is lp64/lp64f/lp64d — an f/d suffix means floating-point arguments go through the floating-point registers (the F/D extension)
   - The floating-point convention: arguments fa0-fa7 (f10-f17), the return value fa0, callee-saved fs0-fs11 (f8-f9, f18-f27). A hard-float ABI puts floating-point arguments in fa0-fa7. A soft-float ABI puts them in a0-a7
   - The decision: trust **ELF `e_flags & EF_RISCV_FLOAT_ABI` (mask 0x6)** — it is the Float ABI field of **the whole object**. **Do not infer soft/hard-float from whether floating-point instructions appear**: `-march=rv64ifd -mabi=lp64` is a legal combination. The product still uses hardware floating-point instructions such as fld/fmul, but function arguments still go through the integer registers (measured: an lp64 product uses `fmv.d.x fa5, a1` to move a0/a1 into a floating-point register, and an lp64d product receives the floating-point register directly with `fsd fa0`). Floating-point instruction density can only support **an ISA that includes the F/D/Q extension**. It cannot support the argument ABI
   - **Objects with different Float ABIs cannot be linked together**: the linker reports `cannot link object files with different floating-point ABI` directly. Under the standard flow there is no "confirm per unit" mixed soft/hard product. If reversing sees a locally different calling convention, consider hand-written assembly, a non-standard ABI, `STO_RISCV_VARIANT_CC`, an FFI/thunk, or a function boundary that was identified wrong

6. **The syscall boundary (ecall + the number in a7)**:
   - **Linux user mode**: `ecall` triggers a syscall. The number is in a7 (x17), the arguments are a0-a5, and the return is a0. RISC-V uses asm-generic numbers (read=63, write=64, openat=56, exit=93, mmap=222) — they differ from x86/ARM numbers. Do not apply another architecture's numbers
   - Locate: objdump searches `ecall` (0x73), and look back for the immediate `li a7, imm`. Identify the syscall site in a Ghidra decompilation
   - **Bare metal (no OS)**: ecall is a custom meaning — an M-mode firmware / SBI call (a7 = the extension number, a6 = the function number) or a vendor monitor. It cannot be read as a Linux number. Look up the SBI / vendor SDK docs for the runtime environment and compare a7/a6
   - Behavior check: `qemu-riscv64 -strace` prints the syscall sequence directly (together with [[re-tracing]])

7. **Ecosystem fingerprints (toolchain / library-function features)**:
   - User mode: glibc (dynamic, PT_INTERP, __libc_start_main) / musl (often static, a small entry) / target-board distro features (busybox and the rest)
   - Bare metal: newlib/picolibc (crt0: _start → __libc_init_array → main). A vendor SDK startup chain (ROM → bootloader → app) and the partition-table structure
   - Instruction extensions: vector instructions (RVV, the v0-v31 register group) suggest a newer toolchain. A high density of compressed instructions is usually an -Os compile
   - Signature strings locate library-function versions (the same idea as [[re-imports]]), and cross-library fingerprints help the recovery

## Cross-domain handoff

- [[re-binary-core]]: the general first look / decompilation / debug base for a RISC-V ELF ([[re-ghidra]], [[re-ida]], [[re-gdb]], [[re-radare2]] are used as usual)
- [[re-firmware]]: the gateway path for a firmware-class sample (re-firmware → re-fw-extract → re-fw-rootfs → this skill)
- [[re-fw-extract]] / [[re-fw-rootfs]]: the prerequisite of unpacking firmware and analyzing the filesystem / config
- [[re-fw-emulate]]: booting firmware as a whole, or running a RISC-V program in user mode (the qemu family)
- [[re-emulation]]: when there is no qemu, Unicorn/Qiling emulates execution (bare-metal, instruction by instruction)
- [[re-rtos]]: after an RTOS task table / TCB inside MCU firmware is located, split the decompilation by task
- [[re-hardware-io]]: JTAG/SWD on-device debugging and flash reads (OpenOCD + gdb)
- [[re-cpp-abi]]: recovering RTTI / exceptions / vtables of a C++ product on RISC-V
- [[re-variant]]: multi-version firmware comparison and a patch diff
- [[re-tracing]]: qemu -strace / strace syscall tracing checks the ecall boundary
- [[re-sandbox]]: the required prerequisite of every dynamic execution (the default-sandbox principle in [[re-analyze/platform-tips]])
- Companions: [[re-patching]] (an RVC-aware byte patch), [[re-triage]] (the first look / architecture identification, first)

## Pitfalls

- **Cutting a compressed instruction stream at 4 bytes is entirely wrong**: symptom — disassembling at a fixed 4-byte stride makes every instruction garbage and every reference misaligned; cause — an RVC mixed stream is a 2/4-byte mix, 2-byte aligned, and a fixed-width cut starts in the middle of an instruction; fix — use a disassembler that supports RVC (Ghidra/objdump recognize it automatically), align the start from the entry or a jump target, and a legal compressed instruction (c.addi/c.j/c.lw) means the alignment is correct. When patching, an instruction length may change between 2 and 4 bytes
- **A missing gp global pointer scatters data accesses**: symptom — a large number of `lw/ld off(gp)` data accesses will not resolve to an address, globals are unrelated to each other, and the logic is fragmented; cause — `__global_pointer$` was lost after symbols were stripped, or the decompiler did not infer gp; fix — compute the real gp value from the `lui gp`+`addi gp` sequence in _start/crt0 and mark it in the decompiler. When there is an ELF, `readelf -s` looks up `__global_pointer$`
- **The la/li pseudo-instruction expands into several shapes**: symptom — the same logic has a different instruction sequence in different functions (a single addi / lui+addi / auipc+addi) and is misread as different logic; cause — the assembler picks the expansion from the immediate size and the relocation type, and after linker relax it may also shrink to a single instruction; fix — trust the machine-code meaning (the same target address is the same reference). Compare across tools, and check key logic back at instruction level
- **An ecall number is bound to the runtime environment, and with no OS it is a custom meaning**: symptom — an ecall in bare-metal firmware is read as a Linux syscall, and the meaning is entirely wrong; cause — ecall is only an "environment call" instruction. The number's meaning is defined by the runtime environment (Linux: a7 = the syscall number; bare metal: an SBI extension / a vendor monitor); fix — confirm the runtime environment first (whether there is an OS, dynamic libraries, the shape of _start). With no OS, look up the SBI extension number or the vendor SDK docs and compare a7/a6
- **Linker relax (R_RISCV_RELAX) moves disassembly boundaries**: symptom — the disassembly of an intermediate .o does not match the final binary's instruction stream, or an address looked up from the unrelaxed layout is misaligned; cause — linker relax shrinks auipc+addi into addi, and shortens jal into c.j, and the size of a sequence marked R_RISCV_RELAX gets smaller after linking; fix — analyze the final linked product (not the .o). Address references trust the final binary. Before changing bytes, confirm whether relax affects them (relink, or compare the disassembly)
