# Capability index (machine-generated; do not hand-edit)

> Generate: `node bin/capindex.mjs` | Check: `npm test` (stale index fails)
> Use: routing and search reverse-lookup skills by capability — the capability layer's lookup table (declaration side is capabilities.md)

## Declared capabilities (tags 65/65 | skills 120/122)

| Capability | Description | Providing skills |
|---|---|---|
| `address-translation` | address-space conversion (PIE/ASLR base, RVA/VA, loader offset, cross-tool address alignment) | re-address-space |
| `ai-model-analysis` | AI model reverse engineering and attack | re-ai-attack, re-ai-model |
| `arch-analysis` | architecture-specific reverse engineering (ARM/MIPS/RISC-V: calling convention, ISA traits, bare-metal entry) | re-arm, re-mips, re-riscv |
| `automotive-analysis` | automotive bus (CAN/ECU) | re-automotive |
| `binary-diffing` | binary variant / patch compare | re-variant |
| `binary-patching` | binary patch (byte-level edit, instruction rewrite) | re-patching |
| `blockchain-analysis` | on-chain bytecode (EVM and similar) | re-blockchain |
| `browser-extension` | browser-extension reverse engineering | re-browser-ext |
| `bytecode-parser` | managed bytecode parse (Java/.NET/WASM/pyc/CAP, and so on) | re-dotnet, re-harmonyos, re-java, re-javacard, re-managed, re-python |
| `chip-analysis` | chip physical layer (decap / side channel) | re-hw-chip |
| `console-analysis` | console / retro platform containers and ROM | re-console |
| `constraint-solving` | constraint solving (Z3) | re-ctf, re-vuln, re-z3 |
| `crypto-decryption` | recover encrypted data (locate the decrypt function / write a decrypt script) | re-crypto-decrypt, re-protocol |
| `crypto-identification` | crypto algorithm identification (constant tables / fingerprints) | re-android-crypto, re-crypto-id, re-protocol, re-ransomware, re-tls, re-whitebox |
| `debugging` | interactive debug (breakpoints / single-step / memory read-write) | re-binary-core, re-crash-triage, re-gdb, re-ghidra, re-ida, re-lldb, re-windbg, re-x64dbg |
| `decompilation` | decompile (Ghidra/IDA/Binary Ninja, and so on) | re-binary-core, re-binaryninja, re-cpp-abi, re-ghidra, re-ida, re-radare2 |
| `deobfuscation` | deobfuscate (junk instructions / flattening / script obfuscation) | re-anti-analysis, re-deobfuscate, re-managed, re-script-deob |
| `dex-parser` | DEX parse (opcode / structure / obfuscation) | re-apk, re-mobile |
| `disk-forensics` | disk / filesystem forensics (deleted recovery, timeline, unallocated space) | re-disk-forensics |
| `document-malware` | malicious-document analysis (PDF/Office) | re-doc-malware, re-malware |
| `drm-analysis` | DRM implementation analysis | re-drm |
| `ebpf-analysis` | eBPF program reverse engineering (ISA, progs/maps correlation, tracing and countermeasures) | re-ebpf |
| `electron-analysis` | Electron desktop-app reverse engineering (asar / main and renderer / CDP) | re-electron |
| `elf-parser` | ELF format parse (header / sections / dynamic linking / symbols) | re-address-space, re-binary-core, re-format-elf, re-imports |
| `emulation` | emulated execution (Unicorn/Qiling/QEMU) | re-emulation, re-firmware, re-fw-emulate |
| `evasion-analysis` | detection-evasion analysis (AMSI/ETW) | re-anti-analysis, re-evasion, re-malware |
| `exploit-development` | exploit development (ROP / heap exploitation / payload construction) | re-exploit, re-pwn |
| `firmware-extraction` | firmware extract and unpack | re-firmware, re-fw-extract, re-fw-rootfs |
| `frida-instrumentation` | Frida instrumentation (hook / script generation) | re-frida, re-frida-script-author, re-mobile |
| `fuzzing` | coverage-guided fuzzing | re-fuzzing, re-vuln |
| `game-analysis` | game reverse engineering (Unity/Unreal/script engines) | re-game |
| `hardware-interface` | hardware interface (JTAG/UART/flash/card read) | re-firmware, re-hardware-io |
| `hybrid-app-analysis` | cross-platform framework product reverse engineering (Flutter/Dart AOT, Hermes/RN) | re-flutter, re-hybrid-app |
| `hypervisor-analysis` | virtualization reverse engineering (VT-x/SVM, VMCS/VMCB, nesting and detection) | re-hypervisor |
| `jailbreak-analysis` | iOS jailbreak environment and tweak analysis (detection bypass, Theos/remote LLDB) | re-ios-jb |
| `jni-analysis` | JNI registration and native-method recovery | re-android-native, re-mobile |
| `kernel-analysis` | kernel module / driver reverse engineering | re-anti-cheat, re-kernel |
| `key-extraction` | extract keys and passphrases (hard-coded / memory / resources) | re-android-crypto, re-crypto-keys, re-malware, re-protocol, re-whitebox |
| `lang-runtime-analysis` | language-runtime product reverse engineering (Go/Rust/Swift/Zig/Nim/Haskell: symbols, ABI, runtime structures) | re-fp-runtime, re-go, re-nim, re-rust, re-swift, re-zig |
| `license-analysis` | license-check logic analysis (locate check points / recover the algorithm) | re-cracking, re-keygen, re-license |
| `macho-parser` | Mach-O parse (LC_*/segment/dyld) | re-binary-core, re-format-macho, re-ios, re-macos |
| `malware-behavior` | malicious-behavior analysis (persistence / injection / ATT&CK) | re-behavior, re-fileless, re-loader, re-malware, re-ransomware |
| `memory-dump` | process memory dump and targeted extraction | re-binary-core, re-memdump |
| `memory-forensics` | whole-machine memory forensics (Volatility) | re-forensics, re-mem-forensics |
| `mobile-forensics` | mobile-device forensics (backup / app data) | re-forensics, re-mobile, re-mobile-forensics |
| `network-capture` | traffic capture and filter (tcpdump/tshark) | re-netcap, re-protocol |
| `pe-parser` | PE format parse (DOS/NT headers / section table / imports and exports) | re-binary-core, re-format-pe, re-imports |
| `plugin-development` | reverse-engineering toolchain extension (Ghidra/IDA plugin engineering) | re-plugin-dev |
| `protocol-recovery` | rebuild a protocol state machine | re-ics, re-iot-proto, re-proto-rev, re-protocol |
| `rf-analysis` | RF signal capture and demodulation | re-sdr |
| `rtos-analysis` | RTOS task table / kernel-object recovery | re-firmware, re-rtos |
| `sample-acquisition` | live sample acquisition (locate anomalous executable memory, runtime capture and extract, cross-OS observation models) | re-sample-acquire |
| `sandbox-setup` | sandbox and isolation environment setup (prerequisite for dynamic analysis) | re-sandbox |
| `sdr-analysis` | software-radio protocol recovery | re-sdr |
| `shellcode-analysis` | shellcode extract and decode | re-ctf, re-shellcode |
| `stego-detection` | steganography detection and extraction | re-ctf, re-stego |
| `symbolic-execution` | symbolic execution | re-angr, re-vuln |
| `tee-analysis` | TEE/TrustZone trusted application | re-tee |
| `threat-intel` | threat-intelligence correlation and attribution | re-attribution, re-forensics, re-hunting, re-ioc, re-malware, re-ti |
| `tls-analysis` | TLS / encrypted-traffic analysis (fingerprint / key export) | re-protocol, re-tls |
| `tracing` | syscall / function trace | re-tracing |
| `triage` | file first look (file / hash / entropy / strings / architecture identification) | re-ai-triage, re-triage |
| `uefi-analysis` | UEFI/BIOS firmware | re-firmware, re-uefi |
| `unpack` | unpack (compression packer / strong packer / packed DEX) | re-anti-analysis, re-mobile-pack, re-packer-id, re-unpack-advanced, re-unpack-simple |
| `web-assembly` | WASM reverse engineering | re-wasm |

## Not yet declared (0)

(None — every registry tag has a skill declaration)
