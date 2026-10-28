---
name: re-mips
description: >
  MIPS architecture reversing and router-firmware analysis methodology: delay slots, the $gp calling convention, endianness, locating httpd.
  Triggers: MIPS, mipsel, `路由器固件`, `嵌入式`, `延迟槽`, big-endian, `大端`, `小端`, httpd, busybox
capabilities: [arch-analysis]
---

# MIPS architecture reversing (router firmware)

## When to use / when not to use

- Use: a MIPS ELF sample / malware (an executable extracted from router or embedded-device firmware)
- Use: logic analysis of programs inside router firmware (web backends, services, utility binaries)
- Use: a MIPS binary of either endianness, big-endian (mips) or little-endian (mipsel)
- Do not use: ARM / x86 and other architectures (the general base is [[re-binary-core]]; this skill only adds MIPS-specific semantics)
- Do not use: you only need to unpack firmware and look at the contents (go to [[re-fw-extract]])
- Do not use: you only need to analyze the filesystem/config (go to [[re-fw-rootfs]])
- Do not use: you need to run the firmware as a whole (go to [[re-fw-emulate]])

## Tool setup

Verify every tool before use. Static analysis may skip the sandbox; qemu-user dynamic execution defaults to a sandbox + network isolation (top principle in [[re-analyze/platform-tips]]).

### Decompiler (Ghidra or IDA, either one)

- Ghidra (built-in MIPS processor module; mips / mipsel / mips64 / mips64el variants are complete):
  - Linux: official release package (needs a JDK); some distro repos have `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`; Windows: official zip
  - Verify: `analyzeHeadless -help` (headless mode) or import a MIPS ELF in the GUI
- IDA: the commercial build includes the MIPS module; the Freeware architecture-support range follows the official page
- On import, confirm the processor variant and endianness are correct (mips big-endian / mipsel little-endian). A wrong choice shifts everything

### binwalk / unblob — firmware and embedded-file scan

- Install channels and how to tell versions apart (v3 mainline / v2 legacy) are in the binwalk/unblob install matrix in [[re-fw-extract]]
- Verify: `binwalk --version`, `unblob --version`

### readelf / file — confirm architecture and byte order (binutils)

- Linux: bundled with binutils (`apt install binutils` and similar); macOS: `brew install binutils` or LLVM-family readelf; Windows: inside WSL
- Verify: `readelf --version`

### qemu-user — MIPS user-mode emulation (dynamic verification)

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu` (includes user mode); Windows/WSL: the Linux build inside WSL
- Endianness is a separate binary: `qemu-mips` (big-endian) / `qemu-mipsel` (little-endian); 64-bit is `qemu-mips64` / `qemu-mips64el`
- Verify: `qemu-mips --version`, `qemu-mipsel --version`

### python3

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: bundled; Windows: official installer
- Verify: `python3 --version`

## Procedure

Run in order and archive each step's result. Step 5 (dynamic execution) defaults to a sandbox.

1. **Prerequisite: firmware extraction and architecture confirmation**:
   - A whole firmware file → unpack with [[re-fw-extract]]; the extracted filesystem → [[re-fw-rootfs]]; an extracted ELF continues in this step
   - Architecture confirmation:
     ```sh
     file target.elf               # whether it is MIPS + an endianness hint
     readelf -h target.elf         # Machine=MIPS; Data=big-endian/little-endian
     readelf -A target.elf | head  # sub-version / ABI extra info
     ```
   - Enter this skill's flow only if `file` output contains "MIPS"; if it is not MIPS, go to the general base [[re-binary-core]]

2. **Judge byte order (big-endian / little-endian)**:
   - `file` output MSB → big-endian (processor variant mips); LSB → little-endian (mipsel)
   - The Data field of `readelf -h` gives endianness directly; e_flags contains ABI info (o32 / n32 / n64)
   - strings readability check: big-endian data viewed little-endian has reversed bytes (for example the magic `hsqs` appears reversed)
   - After confirmation, import into the decompiler with the right variant. Later $gp, jump targets, and string offsets all follow that endianness — a wrong endianness shifts data, instructions, and addresses entirely

3. **Decompilation notes (MIPS-specific semantics)**:
   - **Delay slot (a hardware property)**: on pre-R6, the instruction immediately after an ordinary branch/jump (`beq` / `bne` / `j` / `jal`) executes on both the taken and not-taken paths (it executes, then control transfers); **Branch Likely** (`beql` / `bnel` / `blezl` / `bgtzl` / `bltzl` / `bgezl` and the FP likely class) is different — the delay slot executes only when taken, and on not-taken the delay slot is **annulled** (skipped); after `beq` / `bne` / `j` / `jal` a nop or a useful instruction filled by the assembler is common; when patching, the delay slot after a branch must be handled (fill a nop or an equivalent instruction); MIPS32r6 removed branch-likely and added compact branch forms with no delay slot (`beqc` / `bnec` / `bc` / `balc` / `jic` / `jialc`), but `beq` / `bne` / `jalr` / `jr` still have a delay slot — classify by ISA revision + opcode. Do not say flatly that R6 removed delay slots
   - **Calling convention**: $a0-$a3 pass the first 4 arguments (extra arguments go on the stack), $v0 is the return value, $ra is the return address (`jal` writes it automatically), $s0-$s7 are callee-saved, $t0-$t9 are caller-saved; the PIC indirect-call pattern is `jalr $t9` ($t9 is loaded with the callee address, and the function prologue often reloads $gp)
   - **$gp and .got**: $gp (r28) generally points at the middle of .got (commonly .got+0x7FF0, and a ±32KB offset covers the whole GOT); data access looks like `lw $t0, off($gp)` / `addiu $t0, $gp, off`; a function prologue commonly resets $gp with `lui gp, %hi(...)` + `addiu gp, gp, %lo(...)`
   - **-mlong-calls trampolines**: an immediate `j` / `jal` covers only the same 256MB segment (a 26-bit address shifted left 2), and a cross-segment call is a stub trampoline generated at compile time (load the address, then `jalr`); a run of the three-instruction sequence `lui + addiu + jalr` is usually a trampoline. Do not treat it as business logic
   - A decompiler (for example Ghidra) handles delay slots and GOT references by default, but when symbols/static linking are stripped the $gp value must be confirmed by hand (see pitfall 3)

4. **Router-firmware specialty**:
   - **Locating the web-backend httpd**: in the rootfs, find httpd-family programs (httpd / mini_httpd / boa / lighttpd and vendor-renamed versions) and the web directory (www / htdocs / cgi-bin); a string search for "GET " / "HTTP/1" / response-header strings locates the main request loop
   - **Auth-bypass / command-injection patterns**: search `system(` / `popen(` / `exec` call sites → walk the argument source back and see whether it is a URL parameter or a CGI field; a common auth defect is that the backend trusts a client-controlled field (cookie, Referer, a fixed password) or compares against a hardcoded password
   - **Identifying busybox integrated commands**: busybox is many-in-one — several applets share one main and dispatch on argv[0]; how to locate them: at runtime `busybox --list`, statically the applet table in the symbol table (`applet_names`); many applet logics live in one binary. Avoid misreading it as "one function does everything"
   - **Extracting config and password hashes**: /etc/passwd, /etc/shadow, the /etc/config config directory (common on open-source router systems), and web backup configs; password hashes are commonly `$1$` (MD5-crypt), `$5$` / `$6$` (SHA-crypt), and custom formats; backup configs are often base64 / gzip / a custom pack (hands off to [[re-fw-rootfs]] and [[re-crypto-id]])

5. **Dynamic verification (sandbox)**:
   - Default-sandbox principle: before qemu-user runs a MIPS program, enter [[re-sandbox]] (network isolation + snapshot)
   - ```sh
     qemu-mips -L <rootfs path> ./target           # big-endian; little-endian uses qemu-mipsel
     qemu-mips -L <rootfs path> -strace ./target   # syscall trace
     qemu-mips -L <rootfs path> -E <ENV=val> ./target
     ```
   - `-L` names the rootfs as the source of the dynamic loader/libraries (a MIPS program often depends on the firmware's libc and config)
   - Dynamic work only verifies behavior (file/network/config reads). The main logic stays static

## Cross-domain

- [[re-firmware]]: the gateway path for firmware-class samples (re-firmware → re-fw-extract → re-fw-rootfs → this skill)
- [[re-fw-extract]] / [[re-fw-rootfs]]: prerequisites for firmware unpack and filesystem/config analysis
- [[re-binary-core]]: the general survey/decompile/debug base for a MIPS ELF (child skills such as [[re-ghidra]] and [[re-gdb]] are used as usual)
- [[re-vuln]]: confirming and exploit-verifying web auth bypass / command injection
- [[re-sandbox]]: a mandatory prerequisite for every dynamic execution (default-sandbox principle in [[re-analyze/platform-tips]])
- Companions: [[re-emulation]] (when there is no qemu, emulate MIPS instructions with Unicorn), [[re-fw-emulate]] (when the firmware must boot as a whole), [[re-crypto-keys]] (hardcoded keys in config/firmware), [[re-patching]] (delay-slot-aware byte patches)

## Common pitfalls

- **Delay-slot control flow is shifted (including the annul semantics of branch-likely)**: symptom — logic read by hand at a branch does not line up; the instruction right after the branch "looks like it should not execute" but changes state (or the reverse: on a likely branch that is not taken, the slot instruction did not execute); cause — a MIPS hardware property: on pre-R6, the instruction immediately after an ordinary branch/jump (beq/bne/j/jal) executes on both paths and only then does control transfer, while Branch Likely (beql/bnel/blezl/bgtzl/bltzl/bgezl and the FP likely class) executes the delay slot only when taken and annuls it when not taken; fix — distinguish non-likely from likely: the former counts the delay-slot instruction on both paths, the latter only on the taken path; after patching a branch, fill a nop/equivalent instruction; when relying on decompiler output, check where the delay-slot instruction was restored
- **Wrong endianness → everything is garbage**: symptom — strings, immediates, and addresses are all scrambled, and the decompilation is unrecognizable; cause — MIPS has both endiannesses (router firmware is often big-endian, but little-endian exists), and reading the wrong endianness shifts every 4-byte word; fix — triple-check with `file` (MSB/LSB) + the Data field of `readelf -h` + strings readability, and import the tool with the right mips / mipsel variant
- **With no relocation info, the $gp base can only be guessed**: symptom — `lw $t0, off($gp)` points at something unknown, and GOT references will not resolve; cause — after symbols/static linking are stripped, relocations are gone, and the $gp value (commonly .got+0x7FF0) must be confirmed yourself; fix — compute the real gp at the `lui gp` + `addiu gp` in the `_start` / crt0 prologue and annotate it in the decompiler; with no symbols, estimate from the .got section base
- **Router firmware has a nonstandard header / multi-layer compression**: symptom — binwalk will not unpack, or what it unpacks is not a filesystem, and the web backend cannot be found; cause — a vendor-custom header + multi-layer compression / nested packing (the same common pitfall as [[re-fw-extract]]); fix — hexdump and look up the magic by hand, skip the header offset and dd a slice, confirm layer by layer with file, then analyze
- **Decompilers differ on pseudo-instructions**: symptom — the same function differs a lot across decompilers, and the expansion of li / la / move is inconsistent; cause — MIPS assemblers expand pseudo-instructions in many ways (li splits into lui+ori and similar), and tools restore by their own rules; fix — trust machine-code semantics, cross-check tools, and verify critical logic (delay slot / trampoline / GP reference) back at instruction level
- **Misreading busybox, one binary with many applets**: symptom — logic inside one binary "does everything", and the entry cannot be found; cause — busybox dispatches applets on argv[0], and all the logic shares one main; fix — `busybox --list` or the symbol-table applet table (`applet_names`) locates the specific applet, and analysis starts at that subcommand's entry
