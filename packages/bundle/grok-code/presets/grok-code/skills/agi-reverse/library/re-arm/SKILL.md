---
name: re-arm
description: >
  ARM architecture reversing (non-Android): Cortex-M/A vector table, Thumb/ARM switching, AAPCS calling convention, position-dependent code relocation, MMIO peripheral-register cross-references.
  Triggers: ARM, arm32, Cortex-M, Cortex-A, Thumb, AAPCS, `嵌入式逆向`, `裸机固件`, stm32, `向量表`.
capabilities: [arch-analysis]
---

# ARM architecture reversing (Cortex-M/A, Thumb, AAPCS)

## When to use / when not to use

- Use: ARM outside Android — bare-metal embedded / firmware (Cortex-M0/M3/M4/M7, Cortex-A)
- Use: Thumb/ARM instruction-set switching, AAPCS calling-convention identification, locating the M-series vector-table entry, relocating position-dependent code
- Use: MMIO peripheral-register cross-reference analysis (the 0x4000xxxx peripheral region, LDR literal pools)
- Do not use: an Android `.so` (go to [[re-android-native]])
- Do not use: a generic AArch64 Linux user-mode program (go to the [[re-binary-core]] generic base; this skill only adds ARM-specific semantics)
- Do not use: you only need to unpack firmware and look at contents ([[re-fw-extract]]) / analyze filesystem configuration ([[re-fw-rootfs]]) / boot the firmware as a whole ([[re-fw-emulate]])
- Do not use: other architectures such as RISC-V / x86 (go to [[re-binary-core]])

## Tool preparation

Verify every tool before use. Static analysis can skip the sandbox; qemu dynamic execution defaults to the sandbox + network isolation ([[re-analyze/platform-tips]] supreme rule).

### Decompiler (pick either Ghidra or IDA)

- Ghidra (built-in ARM processor module; for Cortex-M0/M0+/M3/M4/M7 pick the Cortex variant (v8-m is only M23/M33/M55), for Cortex-A pick v7, all little-endian LE):
  - Linux: the official release package (needs a JDK); some distro repos have `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`; Windows: the official zip
  - Verify: `analyzeHeadless -help` (headless mode) or import an ARM ELF in the GUI
  - Ghidra switches Thumb/ARM disassembly automatically from Thumb function bit 0 (TMode); on import, check the processor variant and endianness
- IDA: the commercial edition includes ARM32/ARM64 + Thumb modules; the Freeware edition's architecture support follows the official page
- On import, confirm the architecture (ARM vs AArch64) and the variant — Cortex-M0/M0+ implement Armv6-M: mostly 16-bit Thumb encodings, but with a few legal 32-bit encodings (BL, DMB/DSB/ISB, MRS/MSR); you must pick the v6-M variant, and only encodings outside Armv6-M (MOVW/MOVT, CLZ, hardware divide/modulo) mean the variant was chosen wrong

### readelf / file — confirm architecture and endianness (binutils)

- Linux: ships with binutils (`apt install binutils` and similar); macOS: `brew install binutils` or LLVM-family readelf; Windows: inside WSL
- Verify: `readelf --version`

### binwalk — scan firmware and embedded files

- Install channels and version distinction (v3 mainline / v2 legacy) are in the binwalk/unblob install matrix of [[re-fw-extract]]
- Verify: `binwalk --version`, `unblob --version`

### qemu-arm / qemu-aarch64 — ARM user-mode emulation (dynamic verification)

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu` (includes user mode); Windows/WSL: the Linux build inside WSL
- 32-bit is `qemu-arm`, 64-bit is `qemu-aarch64`; `-L <rootfs>` names the dynamic-library/linker source, `-strace` traces syscalls
- Verify: `qemu-arm --version`, `qemu-aarch64 --version`
- Bare-metal Cortex-M (no OS boot, vector table starting at 0x0) is not a fit for qemu-user — use a board model such as `qemu-system-arm -machine mps2-an385` (Cortex-M3) (`-s -S` attaches gdb), or [[re-emulation]] with Unicorn instruction by instruction

### gdb-multiarch — cross debugging

- Linux: Debian/Ubuntu `apt install gdb-multiarch` (that package is in the official repos of Debian/Ubuntu and their derivatives); Fedora `dnf install gdb` (official gdb supports multiple targets and can debug bare-metal ARM; arm-none-eabi-gdb is not in the Fedora official repos; if you need an embedded-specific toolchain, use the official prebuilt ARM toolchain); Arch `pacman -S gdb` (official gdb already has multiarch built in)
- macOS: `brew install gdb` (needs a Developer Tools entitlement; see the macOS branch of [[re-analyze/platform-tips]]) or the Linux build inside WSL; Windows/WSL: the Linux build inside WSL
- Verify: Debian/Ubuntu `gdb-multiarch --version`; Fedora/Arch `gdb --version`; after loading bare-metal firmware, `set architecture armv7-m` then `file` to load, and confirm with `info registers`
- Real-device SWD/JTAG debugging goes through OpenOCD + gdb ([[re-hardware-io]]); emulation targets use `qemu-system-arm -s -S` or `qemu-arm -g <port>`

## Procedure

Run in order and archive each step; dynamic execution defaults to the sandbox.

1. **Confirm architecture and endianness**:
   ```sh
   file target.bin                 # "ARM"=32-bit (includes Thumb), "AArch64"=64-bit; MSB/LSB endianness hint
   file target.elf
   readelf -h target.elf           # Machine=ARM / AArch64; Data=little-endian / big-endian
   readelf -A target.elf | head    # Tag_ABI_VFP_args: 1=hard float (HFABI), 0=soft float; EABI version
   ```
   - The high bits of e_flags identify the float ABI directly: `EF_ARM_ABI_FLOAT_HARD`(0x400) hard float / `EF_ARM_ABI_FLOAT_SOFT`(0x200) soft float (matches pitfall 5)
   - A bare-metal .bin (no ELF header) has its architecture, endianness, and Cortex-M variant decided by the vector table / reset vector in step 2

2. **Locate the entry**:
   - **Cortex-M vector table** (starts at 0x0 by default, 4 bytes per entry, address = exception number × 4):
     - Entry 1 (offset 0x0): the initial MSP value — points into RAM (near 0x20000000) and can corroborate the load base in reverse
     - Entry 2 (offset 0x4): the Reset handler (the first instruction executed after reset)
     - Then NMI (0x8), HardFault (0xC)…… every entry address must have LSB 1 (Thumb); LSB=0 triggers INVSTATE into HardFault
     - VTOR (0xE000ED08) can relocate the vector table; firmware may put the table in RAM or at another flash address; try 0x0 first, and if that fails search for the MSP/Reset combination
   - **Cortex-A startup code — first distinguish AArch32 / AArch64; the two exception models differ**:
     - **AArch32 (the classic Armv7-A model)**: reset vector 0x00000000 (or the high vectors at 0xFFFF0000, depending on a control bit of the architecture version); an 8-entry exception vector table (Reset/Undef/SWI/Prefetch Abort/Data Abort/Reserved/IRQ/FIQ)
     - **AArch64 (Armv8-A) does not have that fixed 8-entry table**: the exception-vector base comes from each EL's **VBAR_EL1/EL2/EL3**, and each table has **16 slots at a 0x80 stride** (covering +0x000..+0x780), classified by current EL / lower EL × SP_EL0 / SP_ELx × AArch64 / AArch32 source × Synchronous/IRQ/FIQ/SError; VBAR_ELx is undefined after reset and must be configured explicitly by startup code — **do not use the 0x00000000 / 0xFFFF0000 low/high vectors rule to find an AArch64 exception table**
     - When reversing bare-metal Armv8-A firmware, the reliable clue for the exception table is `msr vbar_el1/el2/el3, Xt` and the address-construction sequence around it; **the reset entry itself is decided by the implementation/SoC boot configuration** (the platform may provide a core reset vector base configuration) and cannot be assumed to be fixed at 0
     - The startup flow is generally set the stack pointer → copy .data → zero .bss → configure MMU/clocks → jump to main; a boot chain (boot ROM → BL1/BL2 → u-boot/EL3 firmware) is joined stage by stage with [[re-fw-rootfs]]
   - After locating the reset vector, mark the entry in the decompiler and expand the main logic along the call chain

3. **AArch32 Thumb/T32 function boundaries (Thumb/ARM switching)**:
   - A Thumb function address has LSB=1: ELF symbols (Thumb functions are odd addresses in `nm` / `readelf -s`), BL targets, vector-table entries, and vtable function-pointer entries all carry the Thumb bit
   - `bx rN` / `blx rN`: switch state by bit 0 of the target register (1=Thumb); the immediate form of `blx` switches directly to an ARM-state target
   - **BL immediate distance limit**: ARM state ±32MB, Thumb state ±16MB (BL is a 32-bit encoding; Armv6-M supports BL even without full Thumb-2; the reachable range is judged by the concrete encoding/relocation such as `R_ARM_THM_CALL`, and over-range is handled by a linker veneer); when the limit is exceeded the linker inserts a veneer trampoline (forms such as `ldr pc, =addr`, `movw+movt+bx`); do not treat a patch of trampoline sequences as business logic; veneers are also used for ARM↔Thumb state switches
   - A stripped binary: binutils decides disassembly state from mapping symbols `$a`/`$t`/`$d`; after the mapping symbols are lost it disassembles in the wrong state — force Thumb with `arm-none-eabi-objdump -d -M force-thumb`, or let Ghidra switch by the TMode heuristic
   - Cross-check function boundaries with the literal pools and string references from step 6

4. **Base / relocation (load address vs link address)**:
   - The firmware link base often does not match where the extract actually loads (example: flash firmware linked at 0x08000000 was extracted from an external-storage address; the RAM range pointed at by vector-table entry 1, the MSP, can corroborate it)
   - Determine the link base (inferred from the reset vector / string references inside literal pools / jump-table cross-references) → compute the offset → correct the whole image with Ghidra "Memory Map → Set Image Base" or IDA "Edit → Segments → Rebase program" → after the correction, strings, literal pools, and jump tables all line up
   - When there is an ELF, compare LMA/VMA (`readelf -l`): VMA is the link address; the load address is LMA / p_paddr
   - Correct first, then decompile; otherwise a large number of references are misaligned and the decompile is unrecognizable

5. **Identify the AAPCS calling convention**:
   - **32-bit (AAPCS32)**: r0-r3 pass the first 4 arguments (extra arguments go on the stack), the return is r0, a 64-bit argument occupies an even pair such as r0:r1; r4-r8/r10-r11 are callee-saved, r9 is platform-specific; r12(IP) is an intra-call temporary, r13(SP), r14(LR) is the return address, r15(PC); public interfaces are 8-byte stack-aligned
   - Function-prologue features: `push {r4-r11, lr}`, and at the tail `pop {..., pc}` (restore PC from LR at the same time); a leaf function (no nested call) often does not push LR and just does `bx lr`
   - **HFABI (hard float)**: floating-point arguments go through VFP registers s0-s15 / d0-d7 (double precision), and the result is s0/d0; the soft-float ABI passes floating-point arguments in r0-r3; `readelf -A` Tag_ABI_VFP_args distinguishes them (mixing them is the easiest mistake; see pitfall 5)
   - **64-bit (AAPCS64, AArch64)**: x0-x7 pass arguments, x8 is the indirect-result register, x19-x28 are callee-saved, x29 is the frame pointer, x30(LR), SP is 16-byte aligned; the prologue feature is `stp x29, x30, [sp, #-16]!`
   - Recovering C++ artifacts on ARM (RTTI/vtable/exceptions) cross-references [[re-cpp-abi]]; on AArch32, a vtable function-pointer entry that points at a Thumb/T32 function also carries the Thumb state bit (bit0=1; clear bit0 when resolving the real address); AArch64 uses A64, has no Thumb state, and this rule does not apply

6. **Peripheral-register cross-references (MMIO xref)**:
   - The Cortex-M peripheral region is 0x40000000-0x5FFFFFFF (a concrete peripheral base such as 0x4000xxxx or 0x48000000 varies by device), and PPB (NVIC/SCB/SysTick) starts at 0xE0000000; check the SoC datasheet memory map
   - A typical access form: `ldr rN, [pc, #imm]` takes an address from the literal pool at the end of the function → `str`/`ldr` accesses the peripheral; when computing the pool address by hand, note that Thumb-state PC=current+4, ARM-state +8, and it is 4-byte aligned
   - In the decompiler, mark the peripheral region as a register region (not a data section) — to avoid a misjudgment (see pitfall 3); infer hardware behavior from register semantics such as UART/GPIO/timer; a loop that polls a status/flag bit is the handshake/wait logic that talks to the peripheral
   - Cross-check: peripheral-address constants + the init sequence (clock enable, GPIO configuration) against the vendor's reference-code patterns

## Cross-domain joins

- [[re-binary-core]]: the generic ARM ELF survey / decompile / debug base ([[re-ghidra]], [[re-ida]], [[re-gdb]], [[re-radare2]] are used as usual)
- [[re-firmware]]: the gateway path for firmware-class samples (re-firmware → re-fw-extract → re-fw-rootfs → this skill)
- [[re-fw-extract]] / [[re-fw-rootfs]]: firmware unpack and filesystem/configuration analysis come first
- [[re-fw-emulate]]: boot the firmware as a whole, or run an ARM program in user mode (the qemu family)
- [[re-rtos]]: after locating an RTOS task table/TCB inside MCU firmware (FreeRTOS and similar), split the decompile by task
- [[re-hardware-io]]: real-device JTAG/SWD debugging and flash reads (OpenOCD + gdb-multiarch)
- [[re-emulation]]: when there is no qemu, emulate with Unicorn (instruction-by-instruction verification of bare-metal Cortex-M)
- [[re-cpp-abi]]: recover RTTI/exceptions/vtables of C++ artifacts on ARM
- [[re-variant]]: multi-version firmware comparison and patch diff
- [[re-sandbox]]: a forced precondition for every dynamic execution ([[re-analyze/platform-tips]] default-sandbox rule)
- Companions: [[re-patching]] (Thumb byte patches), [[re-android-native]] (the Android .so case)

## Common pitfalls

- **Misjudging a Thumb odd address (the function start is offset by 1 byte)**: symptom — locating a function by a symbol or a BL target starts in the middle of an instruction, and the disassembly is garbage; cause — LSB=1 of a Thumb function address is a mode bit, not a code byte, and using it directly as an absolute address misaligns everything; fix — clear bit 0 of the address (&~1) before entering a function / resolving a jump target; use that as the basis when computing addresses by hand (Ghidra/IDA already do this automatically)
- **Veneers beyond the BL/BLX distance limit look like logic**: symptom — the call chain contains patches of `movw/movt + bx` and `ldr pc` trampolines that get analyzed as business logic; cause — a BL immediate covers only ARM ±32MB / Thumb ±16MB, and past that the linker inserts a veneer; fix — recognize the short-trampoline form (it ends in bx/ldr pc and the target is a far address), skip it, and keep following the final target; a cross-state call (Thumb↔ARM) also goes through a veneer
- **Treating the M-series peripheral map as a data section**: symptom — the 0x4000xxxx region is treated as "data" with random contents, and peripheral reads/writes are analyzed as ordinary memory accesses with no semantics; cause — an MMIO region is registers, not storage; a read can change state and a write has side effects; fix — mark it as a register region in the decompiler, recover semantics bit by bit from the datasheet memory map + the register table, and recognize handshake/wait loops by status-bit polling
- **R14(LR) dual use distorts the decompile**: symptom — some function "did not save a return address" but calls a child, and the call graph breaks; cause — LR is a register, not a dedicated return stack; a leaf function can use it as an ordinary temporary, and on a Cortex-M exception entry LR may also be the special EXC_RETURN value; fix — rebuild call relationships from `push {..., lr}` and the points where LR is assigned around `bl`; the exception-entry context-restore sequence (8 words pushed: r0-r3/r12/LR/PC/xPSR, PC at [sp,#0x18]) confirms the exception handler
- **Mixing HFABI and soft float misreads arguments**: symptom — a function's first argument is a float, but the decompiler takes it from r0 and the value is completely wrong; cause — the ABI was judged wrong (softfp treated as hard, or the reverse); fix — decide the ABI from `readelf -A` Tag_ABI_VFP_args and the 0x400/0x200 bits of e_flags, **then look at which register group the argument actually lands in**: a first argument received in s0-s15/d0-d7 = hard float, received in r0-r3 = soft float. **The key point: `-mfloat-abi=softfp` is "the soft-float calling convention + VFP instructions allowed"** — it still emits floating-point instructions such as `vmov/vadd/vcmp`, but arguments still go through integer registers (measured: `vmov s0, r1` moves r1 into s0), so **how often floating-point instructions appear cannot corroborate the float ABI**; it only corroborates "the code used VFP"
- **The wrong Cortex-M0 variant (misjudged by instruction width)**: symptom — M0 firmware disassembled as v7/v8-M shows a large number of 32-bit instructions outside Armv6-M; cause — ARMv6-M (M0/M0+) is mostly 16-bit Thumb encodings, but it is not "16-bit only": BL, DMB/DSB/ISB, and MRS/MSR are legal 32-bit encodings; judging only by instruction width treats legal encodings as hallucinations and also misses real out-of-range instructions; fix — confirm the variant on import (v6M vs v7/v8M) and judge by whether the concrete opcode belongs to Armv6-M — only encodings outside Armv6-M, such as MOVW/MOVT, CLZ, and hardware divide/modulo, mean the variant was chosen wrong
