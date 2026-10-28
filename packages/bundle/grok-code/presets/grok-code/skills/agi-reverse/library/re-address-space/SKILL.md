---
name: re-address-space
type: atomic
description: >
  Unified address-space conversion: determining the PIE/ASLR base, RVA/VA conversion, loader offset (firmware load address vs link address),
  and cross-tool address alignment (Ghidra/angr/frida/gdb).
  Triggers: PIE, ASLR, `基址`, RVA, VA, loader offset, `地址换算`, `重定位地址`, `gdb算地址`, `angr地址`.
capabilities: [address-translation, elf-parser]
---

# Address-space conversion (PIE / ASLR / base / RVA-VA)

## Entry decision (Decision Gate)

```
Address-related question
├── Static file (no runtime): VA/RVA/file-offset conversion ──→ this skill (steps 1-2)
├── Runtime (process/memory): determine base (PIE/ASLR) ──→ this skill (step 3) + /proc/pid/maps
├── Cross-tool alignment (Ghidra display vs runtime vs angr) ──→ this skill (step 4)
└── Firmware load address vs link address delta ──→ this skill (step 5)
```

## When to use / when not to use

- Use: any "these addresses do not match" problem — decompiler display address ≠ runtime address ≠ address from find
- Use: PIE/ASLR binaries that need a runtime base (frida `Process.getModuleByName(...).base` / gdb `info proc mappings` / maps file)
- Use: RVA/VA conversion, file offset ↔ virtual address, firmware load address vs link address delta
- Do not use: only reading the ELF header/section table (go to [[re-format-elf]])
- Do not use: a detailed runtime memory layout (go to [[re-memdump]] / [[re-gdb]])

## Tool preparation

Verify every tool before use. All are static/lightweight commands and can skip the sandbox.

### readelf / objdump (binutils) — file-side base and segment info

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils` (usually preinstalled)
- Verify: `readelf --version`; `objdump --version`

### gdb — runtime base (cross-OS, see [[re-gdb]])

- Install and verify: see [[re-gdb]] tool preparation

### python3 — conversion scripts

- Install and verify: see [[re-python]] tool preparation

## Procedure

1. **Determine the file-side base (static)**:
   ```sh
   readelf -l target | grep LOAD        # p_vaddr of the first LOAD segment is the link base (fixed for ET_EXEC; relative from 0 for ET_DYN/PIE)
   readelf -h target | grep Type        # EXEC (fixed base) / DYN (PIE; the base is fixed only at runtime)
   ```
   - Link-time base: take the **lowest PT_LOAD p_vaddr** (page-aligned) — do not assume a PIE/ET_DYN p_vaddr is 0; the format does not require that. Under PIE it is often 0, but it can be non-zero (for example a layout starting at 0x1000). load_bias = runtime mapping start − lowest p_vaddr (see step 3)
   - File offset ↔ VA: `VA = p_vaddr + (file_offset - p_offset)` (match by segment; do not convert the whole file linearly)

2. **RVA / VA conversion**:
   ```
   RVA = VA - ImageBase (PE context)
   VA  = RVA + ImageBase
   ```
   - ELF has no single ImageBase concept — use "link base + segment offset"; PE uses the section table (RVA → file offset by section)
   - 32/64-bit width affects how addresses are written, not the conversion logic

3. **Runtime base (PIE / ASLR)**:
   ```sh
   cat /proc/<pid>/maps | head -5        # load base = start of the first mapping (r--p, file offset 0x0) (Linux)
   gdb -p <pid> -ex 'info proc mappings' -ex detach   # or the gdb side (cross-platform)
   ```
   - **Layout difference (separate-code)**: under gcc's default PIE the first LOAD is an R-- segment (p_vaddr=0) and the code segment follows (p_vaddr starting at 0x1000); in the older layout (no separate-code) the first LOAD is already R E (p_vaddr=0) — take the load base as the **start of the first mapping (r--p)**; if you use the first r-xp start you must subtract that segment's own p_vaddr, otherwise the two layouts disagree
   - frida: `Process.getModuleByName("libtarget.so").base` (Frida 17+: static `Module.findBaseAddress` / `Module.getBaseAddress` were removed; older syntax is in [[re-frida-script-author]])
   - **Runtime address = link address + load bias** — bias = runtime base − link base; under PIE the bias changes every run (ASLR), so scripts must read it dynamically
   - Conversion: `runtime_addr = link_addr + bias` (for example a symbol linked at 0x1000 is `0x1000 + 0x7f0000000000` at runtime)

4. **Cross-tool alignment**:
   - Ghidra: imports at the link base by default (PIE Image Base is often 0); the delta from the runtime address is the load bias — `Ghidra address + bias = runtime address`
   - angr: `proj.loader.main_object.mapped_base` (base after rebase); rebase with the backend object's `obj.rebase(new_base)` (for example `proj.loader.main_object.rebase(...)`, cle Backend.rebase)
   - gdb/frida: treat the runtime base as ground truth (step 3); decompiler addresses need bias added before they line up
   - Breakpoint alignment: `gdb b *<link address> + <bias>` or frida `Process.getModuleByName("libfoo.so").findExportByName("func")` plus an offset

5. **Firmware loader offset**:
   - The delta between the firmware image link address and the actual load address (after flash mapping/decompression) is the loader offset — first read the firmware header/startup code to confirm the load address (work with [[re-fw-extract]] / [[re-arm]])
   - Conversion: `actual address = link address + loader_offset`; when unsure, reverse it from a self-address reference in the startup code

## Cross-domain joins

- [[re-binary-core]]: this skill is one of its sub-skills — the shared binary-analysis base (address conversion is consumed across domains)
- [[re-format-elf]] / [[re-format-pe]]: source of the segment/section table (inputs to steps 1-2)
- [[re-frida]] / [[re-gdb]] / [[re-memdump]]: source of the runtime base (step 3)
- [[re-ghidra]] / [[re-angr]]: cross-tool address alignment (step 4)
- [[re-fw-extract]] / [[re-arm]]: firmware load address (step 5)
- [[re-analyze/analysis-contract]]: address-conversion conclusions go into the **file-domain field** base_addr of the data contract (see [[re-analyze/analysis-contract]] §3.2)

## Common pitfalls

- **Misusing the PIE static base**: symptom — treating the PIE link base (0 or the ELF header value) as the runtime address, so breakpoints and lookups all miss; cause — an ET_DYN runtime base is decided by ASLR; fix — take bias dynamically in step 3, do not guess it statically
- **Treating a file offset as a virtual address**: symptom — after `find 0x1234` (a file offset) there is no match in Ghidra/at runtime; cause — mixing the offset and VA coordinate systems; fix — convert with the segment map in step 1, and first confirm which system you are reading
- **Firmware link address ≠ load address**: symptom — the entry `file` reports differs from the actual runtime entry by a constant; cause — the linker used the flash/ROM address, and runtime decompresses/remaps into RAM; fix — reverse the loader offset in step 5, do not force a match
- **Each tool speaks its own address**: symptom — Ghidra says 0x401000, angr says 0x400000, frida says 0x7f... — three numbers for one symbol; cause — each tool's default base differs (link/map/rebase); fix — unify to one coordinate system in step 4 (anchor on the runtime base) before comparing
