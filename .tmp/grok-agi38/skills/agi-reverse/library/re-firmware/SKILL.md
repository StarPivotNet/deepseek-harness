---
name: re-firmware
type: gateway
description: >
  Firmware / embedded / hardware analysis gateway. Orchestration: extract → rootfs → emulate → hardware interface.
  Child skills: [[re-fw-extract]] [[re-fw-rootfs]] [[re-fw-emulate]] [[re-hardware-io]] [[re-automotive]] [[re-uefi]] [[re-rtos]] [[re-tee]].
  Triggers: `固件分析`, `固件`, IoT, `解包固件`, rootfs, `仿真固件`, firmware analysis.
capabilities: [firmware-extraction, emulation, rtos-analysis, hardware-interface, uefi-analysis]
---

# Firmware / embedded / hardware analysis

## Full workflow

1. Triage: [[re-triage]] (capability: `triage`) — file/hash/entropy to confirm firmware type, architecture, and endianness (if you did not enter through [[re-analyze]], do that first and read the `RE_*` session variables)
2. Extract: [[re-fw-extract]] (capability: `firmware-extraction`) — binwalk/unblob automatic unpack, manual magic scan, endianness check
3. rootfs: [[re-fw-rootfs]] (capability: `firmware-extraction`) — mount/unpack the filesystem, locate the entry from startup scripts, mine config / keys / hardcoded passwords
4. Emulate: [[re-fw-emulate]] (capability: `emulation`) — when you need runtime, prefer QEMU user-mode (the lightest option; see [[re-analyze/platform-tips]]); full-system only as needed
5. Hardware interface: [[re-hardware-io]] (capability: `hardware-interface`) — when you need a physical board (JTAG/UART/flash read); if you have a firmware file, do steps 2-4 first; hardware is the last resort
6. Communications: if extraction/runtime shows firmware traffic, callbacks, or a custom protocol → [[re-protocol]] (capabilities: `network-capture`, `protocol-recovery`, `crypto-identification`, `crypto-decryption`, `key-extraction`, `tls-analysis`; netcap / proto-rev / crypto-*)
7. Output: conclusions / report (per `RE_REPORT`); archive hashes and evidence (see [[re-triage]] (capability: `triage`))

Archive each step (evidence path + sha256; see [[re-triage]] (capability: `triage`)) for the report. If you find a malicious sample or backdoor at any point, hand off to [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`).

## Which atomic skill (selection tree)

- Have a firmware file (.bin / .img / update package) → [[re-fw-extract]] (capability: `firmware-extraction`) unpack
- Already have a rootfs / unpack product → [[re-fw-rootfs]] (capability: `firmware-extraction`) analyze the filesystem
- Need to run the firmware and observe behavior → [[re-fw-emulate]] (capability: `emulation`; confirm the architecture first; see [[re-triage]] (capability: `triage`))
- Have a physical board / need hardware extraction → [[re-hardware-io]] (capability: `hardware-interface`)
- Automotive ECU / CAN bus / OBD-UDS diagnostics → [[re-automotive]] (capability: `automotive-analysis`)
- See communications (firmware callback / custom protocol / encrypted traffic) → [[re-protocol]] (capabilities: `network-capture`, `protocol-recovery`, `crypto-identification`, `crypto-decryption`, `key-extraction`, `tls-analysis`)
- Target is UEFI firmware (BIOS update package / DXE driver / bootkit) → [[re-uefi]] (capability: `uefi-analysis`; UEFITool parse + OVMF emulation)

## Cross-domain joins

- Firmware communication protocols: [[re-firmware]] → [[re-protocol]] (netcap / proto-rev / crypto-* identify and reconstruct firmware traffic)
- Malicious samples / backdoors inside firmware: [[re-firmware]] → [[re-malware]] (sandbox behavior analysis; see [[re-sandbox]])
- Deep static analysis of ELFs inside firmware: → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]])
- Emulated dynamic analysis defaults to a sandbox plus network isolation ([[re-analyze/platform-tips]] highest principle)
- This gateway is called by the [[re-analyze]] triage.md path "analyze firmware / IoT device" (re-firmware → re-fw-extract → re-fw-rootfs → re-fw-emulate → re-protocol if communications are seen)

## Common pitfalls

- Jumping straight to binwalk without triage → architecture/endianness unknown, unpacked programs cannot be emulated — confirm with [[re-triage]] first (big-endian ARM/MIPS is common)
- Giving up when automatic unpack fails → vendor-custom headers / encryption layers are the most common case — switch to [[re-fw-extract]] manual magic scan + dd split by offset
- Demanding a physical board up front → high cost and damage risk — if you have a firmware file, go extract → rootfs → emulate first; [[re-hardware-io]] is the last resort
- Running firmware emulation without network isolation → the firmware really calls out — default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle); hand communications analysis to [[re-protocol]]
- Analyzing rootfs without reading startup scripts → dozens of binaries and no place to start — read rcS / inittab / init.d in [[re-fw-rootfs]] first to locate the program entry
- **Layer-by-layer boot-chain checks (BootROM→FDL→SPL→U-Boot→system)**: Symptom — patching out one check still fails the flash, and a later stage is stuck on another verification; cause — mobile SoC flash chains (Unisoc and similar) verify each layer independently: BootROM→FDL1→FDL2→SPL Loader→U-Boot/LK→system; SPL does RSA-2048 checks on sml/trustos/uboot (DHTB+SIMGHDR format) and a failure enters a dead loop; fix — walk the whole chain layer by layer: (1) **turn a format signature into a constant**: take the file-header ASCII (for example `DHTB`), interpret it as a 32-bit little-endian integer (`1112819780`), and search that constant in the previous layer's decompilation to locate the check entry; (2) the failure trap is a dead loop (the check-failure branch goes to a loop) — patch the failure branch to NOP / retarget the branch so execution continues; (3) take the FDL2 load base from the second FDL address on the spd_dump command line (use that as the IDA/Ghidra load base, or xrefs will not line up); (4) string-search for the entry that dispatches flash-write logic by partition name; (5) a hardware-fixed approach (RP2350 as USB host, automatically replaying the handshake and injecting) only automates the process — the real work is reversing and modifying the load chain
