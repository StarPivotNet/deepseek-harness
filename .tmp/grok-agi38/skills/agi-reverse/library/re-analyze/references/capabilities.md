# Capability registry (Capability Layer)

The capability layer stops skill-boundary drift: a skill declares **capabilities** (analysis actions it can perform). A domain skill is a combination of capabilities. A new skill declares capabilities first. Routing matches on capabilities, not on domain names.

## Tag list (validate.mjs accepts only values in this list)

- `triage` — file first look (file / hash / entropy / strings / architecture identification)
- `address-translation` — address-space conversion (PIE/ASLR base, RVA/VA, loader offset, cross-tool address alignment)
- `elf-parser` — ELF format parse (header / sections / dynamic linking / symbols)
- `pe-parser` — PE format parse (DOS/NT headers / section table / imports and exports)
- `macho-parser` — Mach-O parse (LC_* / segment / dyld)
- `dex-parser` — DEX parse (opcode / structure / obfuscation)
- `bytecode-parser` — managed bytecode parse (Java / .NET / WASM / pyc / CAP, and so on)
- `binary-diffing` — binary variant / patch compare
- `decompilation` — decompile (Ghidra / IDA / Binary Ninja, and so on)
- `debugging` — interactive debug (breakpoints / single-step / memory read-write)
- `tracing` — syscall / function trace
- `memory-dump` — process memory dump and targeted extraction
- `memory-forensics` — whole-machine memory forensics (Volatility)
- `emulation` — emulated execution (Unicorn / Qiling / QEMU)
- `symbolic-execution` — symbolic execution
- `constraint-solving` — constraint solving (Z3)
- `unpack` — unpack (compression packer / strong packer / packed DEX)
- `deobfuscation` — deobfuscate (junk instructions / flattening / script obfuscation)
- `crypto-identification` — crypto algorithm identification (constant tables / fingerprints)
- `crypto-decryption` — recover encrypted data (locate the decrypt function / write a decrypt script)
- `key-extraction` — extract keys and passphrases (hard-coded / memory / resources)
- `protocol-recovery` — rebuild a protocol state machine
- `network-capture` — traffic capture and filter (tcpdump / tshark)
- `tls-analysis` — TLS / encrypted-traffic analysis (fingerprint / key export)
- `jni-analysis` — JNI registration and native-method recovery
- `frida-instrumentation` — Frida instrumentation (hook / script generation)
- `firmware-extraction` — firmware extract and unpack
- `rtos-analysis` — RTOS task table / kernel-object recovery
- `hardware-interface` — hardware interface (JTAG / UART / flash / card read)
- `rf-analysis` — RF signal capture and demodulation
- `malware-behavior` — malicious-behavior analysis (persistence / injection / ATT&CK)
- `threat-intel` — threat-intelligence correlation and attribution
- `license-analysis` — license-check logic analysis (locate check points / recover the algorithm)
- `fuzzing` — coverage-guided fuzzing
- `shellcode-analysis` — shellcode extract and decode
- `kernel-analysis` — kernel module / driver reverse engineering
- `stego-detection` — steganography detection and extraction
- `document-malware` — malicious-document analysis (PDF / Office)
- `evasion-analysis` — detection-evasion analysis (AMSI / ETW)
- `game-analysis` — game reverse engineering (Unity / Unreal / script engines)
- `console-analysis` — console / retro platform containers and ROM
- `drm-analysis` — DRM implementation analysis
- `automotive-analysis` — automotive bus (CAN / ECU)
- `ai-model-analysis` — AI model reverse engineering and attack
- `blockchain-analysis` — on-chain bytecode (EVM and similar)
- `web-assembly` — WASM reverse engineering
- `browser-extension` — browser-extension reverse engineering
- `sdr-analysis` — software-radio protocol recovery
- `chip-analysis` — chip physical layer (decap / side channel)
- `tee-analysis` — TEE / TrustZone trusted application
- `uefi-analysis` — UEFI / BIOS firmware
- `mobile-forensics` — mobile-device forensics (backup / app data)
- `arch-analysis` — architecture-specific reverse engineering (ARM / MIPS / RISC-V: calling convention, ISA traits, bare-metal entry)
- `lang-runtime-analysis` — language-runtime product reverse engineering (Go / Rust / Swift / Zig / Nim / Haskell: symbols, ABI, runtime structures)
- `disk-forensics` — disk / filesystem forensics (deleted recovery, timeline, unallocated space)
- `ebpf-analysis` — eBPF program reverse engineering (ISA, progs/maps correlation, tracing and countermeasures)
- `electron-analysis` — Electron desktop-app reverse engineering (asar / main and renderer / CDP)
- `hypervisor-analysis` — virtualization reverse engineering (VT-x / SVM, VMCS / VMCB, nesting and detection)
- `jailbreak-analysis` — iOS jailbreak environment and tweak analysis (detection bypass, Theos / remote LLDB)
- `hybrid-app-analysis` — cross-platform framework product reverse engineering (Flutter / Dart AOT, Hermes / RN)
- `exploit-development` — exploit development (ROP / heap exploitation / payload construction)
- `binary-patching` — binary patch (byte-level edit, instruction rewrite)
- `plugin-development` — reverse-engineering toolchain extension (Ghidra / IDA plugin engineering)
- `sandbox-setup` — sandbox and isolation environment setup (prerequisite for dynamic analysis)
- `sample-acquisition` — live sample acquisition (locate anomalous executable memory, runtime capture and extract, cross-OS observation models)

## Annotation rules

- Frontmatter declares `capabilities: [tag1, tag2]` (YAML list; a single value may be written `capabilities: [tag]`)
- Meaning: this skill **provides** these capabilities (one skill may have several)
- Gateway / entry: declare the capabilities it aggregates; a meta-skill that provides no analysis capability (for example re-feedback) may omit the field
- Unknown tag, or a non-list form → validate.mjs errors
- **Tags must not dangle**: every tag in the registry must be declared by at least one skill (validate.mjs checks) — submit a new tag in the same batch as the skill that declares it
- **Atomic skills must declare**: missing declaration fails `npm test`; the entry (re-analyze) and a meta-gateway that provides no analysis capability (re-feedback) may omit it

## Capability index (declaration → consumer lookup)

- `capability-index.md`: capability → skill reverse lookup, **machine-generated** (`node bin/capindex.mjs`), including the "not yet declared" list and coverage counts
- After any `capabilities` declaration change, regenerate and commit, or `npm test` reports a stale index
- Routing and search reverse-lookup the index (do not guess by domain name). The index is also a readable coverage board (tag coverage and skill coverage, two measures)

## Route by capability

- The goal table in `triage.md` and table A in `rerouting.md` both have a "required capability" column. The skill column is a reverse lookup from `capability-index.md` — when adding or editing a route row, set the capability tag first. Do not hard-code a domain name. The column heading literal is `需要能力`.
- CI check (`npm test`): tags in the route capability column must be in the registry; a capability named on a route row must be declared by a skill on that row

## Capability annotations on a gateway selection tree

- **Format**: `[[re-<skill-name>]]（能力：`tag1`、`tag2`）` — must carry the explicit prefix `能力：`. Parentheses without that prefix are ordinary notes (for example `[[re-x64dbg]]（`minidump` 命令）`). Do not mix the two.
  - When writing a placeholder, use `[[re-<skill-name>]]` / `[[<file-name>]]` — the angle-bracket form is not parsed as a real link, so a documentation example does not trip a broken-link error (validate checks only real links)
- **Scope**: inside the section `## 何时用哪个原子技能（选择树）`, **every skill link must be annotated**. The full-workflow section uses the same format (not mandatory)
- **CI check** (`npm test`): a skill link inside the selection tree that lacks the annotation → fail; the annotated capability must be in the registry and must actually be declared by the annotated skill; non-skill links (reference docs such as [[platform-tips]]) are exempt
