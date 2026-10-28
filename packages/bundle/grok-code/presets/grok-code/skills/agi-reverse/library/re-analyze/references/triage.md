# Task-identification decision table

The entry picks an orchestration path from "analysis goal + input file". When a goal hits several categories, chain them in dependency order.

**Prerequisite: identify which system the target belongs to** ([[system-fingerprints]]). If the target is not a common form (not PE/ELF, or it is ELF but OSABI / the note segment points at a non-mainstream system, or there is no container at all), run identification before this table. When **the family is settled and the system is not**, advance on the family-level branch. Do not guess a system and then orchestrate as if that guess were true.

**Route by capability** (capability layer, see [[capabilities]] and `capability-index.md`): from the goal / input features, decide the "required capability" first, then look up the capability index for the skill that provides it — the skill name is only an index result, not a domain name hard-coded in. After a skill's capability declaration changes, the index is regenerated and routing follows (`npm test` checks that routes and declarations match). The column heading literal is `需要能力`.

## Step 0: Authorization context (authorization_context)

Before routing, decide who the target belongs to and store it in the session variable `RE_AUTH` (it affects dynamic execution, patch / bypass, key extraction, and spread of unpack products):

| Value | Meaning |
|---|---|
| `owned` | software you own or wrote |
| `ctf` | CTF / research environment (challenge / sandbox sample) |
| `research` | authorized testing and audit |
| `unknown` | cannot confirm (ask the user by default; if the user is not explicit, stay unknown) |

**Effects**:
- Dynamic execution (run a sample / breakpoints / memory read-write): `unknown` and third-party commercial software → default sandbox ([[re-sandbox]]), only behavior inside the authorization
- Patch / bypass flow (re-cracking domain: license / patching / keygen / drm): only `owned` / `ctf` / `research` may enter; `unknown` → static license-logic analysis only, and ask ownership first (same authorization boundary as [[re-cracking]])
- Key extraction / decryption, and spread of unpack products: also constrained by `RE_AUTH`

## Goal → orchestration path

| Goal (user description) | Required capability | Orchestration path (in order) |
|---|---|---|
| Decide malicious behavior / whether it calls home | `malware-behavior`, `network-capture` | re-malware gateway → re-sandbox → re-behavior → re-protocol (re-netcap / re-proto-rev / re-crypto-*) → re-ioc |
| Phenomenon only, no sample (does not touch disk / memory-resident / parasitic in another process) | `sample-acquisition`, `malware-behavior` | re-sample-acquire → re-triage → re-fileless / re-malware → re-ioc |
| Ransom encryption / files encrypted / ransom note | `malware-behavior`, `crypto-identification`, `crypto-decryption` | re-malware → re-sandbox → re-ransomware → re-crypto-id / re-crypto-decrypt → re-ioc |
| Fileless sample / PowerShell chain / in-memory execution | `malware-behavior`, `deobfuscation` | re-malware → re-fileless → re-script-deob → re-behavior → re-ioc |
| Sample is packed / unpack | `unpack` | re-anti-analysis → re-packer-id → re-unpack-simple / re-unpack-advanced → verify |
| Crack / license bypass / registration code | `license-analysis`, `binary-patching` | re-cracking → (if packed) re-anti-analysis → re-license → re-patching / re-keygen |
| Vulnerability research / crash analysis | `fuzzing`, `debugging` | re-vuln → re-fuzzing → re-crash-triage → (locate) re-binary-core |
| Analyze firmware / IoT device | `firmware-extraction`, `emulation`, `hardware-interface` | re-firmware → re-fw-extract → re-fw-rootfs → re-fw-emulate → (UEFI/BIOS → re-uefi) → (RTOS → re-rtos) → (ARM → re-arm; MIPS → re-mips; RISC-V → re-riscv) → (TEE → re-tee) → (chip/PCB → re-hw-chip) → (JTAG/UART → re-hardware-io) → (if communications are seen) re-protocol |
| Analyze network traffic / unknown protocol | `network-capture`, `protocol-recovery`, `crypto-identification` | re-protocol → re-netcap → re-proto-rev → re-crypto-id / re-crypto-keys / re-crypto-decrypt |
| Encrypted traffic (TLS) analysis | `tls-analysis`, `crypto-identification` | re-protocol → re-tls → re-crypto-keys |
| RF / wireless signal | `rf-analysis`, `sdr-analysis`, `protocol-recovery` | re-protocol → re-sdr → (protocol recovery) re-proto-rev / re-iot-proto |
| Mobile app analysis | `dex-parser`, `jni-analysis`, `frida-instrumentation` | re-mobile → re-apk / re-ios → re-frida → (Flutter/RN → re-hybrid-app / re-flutter; HarmonyOS hap → re-harmonyos; script generation → re-frida-script-author) → (native library present → re-android-native) → (crypto-stack audit → re-android-crypto) |
| iOS jailbreak environment / tweak analysis | `jailbreak-analysis` | re-mobile → re-ios-jb → (dynamic instrumentation) re-frida |
| General software reverse engineering / read the logic | `decompilation`, `elf-parser` | re-binary-core → re-triage → re-format-pe / re-format-elf / re-format-macho → re-ghidra / re-ida / re-radare2 → dynamic as needed |
| Architecture-specific target (ARM/MIPS/RISC-V bare metal) | `arch-analysis` | re-binary-core → re-arm / re-mips / re-riscv → (if RTOS) re-rtos |
| Language product (Go/Rust/Swift/Zig/Nim/functional) | `lang-runtime-analysis` | re-binary-core → re-go / re-rust / re-swift / re-zig / re-nim / re-fp-runtime |
| Game reverse engineering / console and retro platforms | `game-analysis`, `console-analysis` | re-game (base re-binary-core) → (modern console / retro platform → re-console) |
| shellcode / position-independent payload | `shellcode-analysis`, `emulation` | re-binary-core → re-triage → re-shellcode → re-emulation |
| eBPF / kernel tracing program | `ebpf-analysis` | re-binary-core → re-ebpf → (kernel side) re-kernel |
| hypervisor / virtualization target | `hypervisor-analysis` | re-binary-core → re-hypervisor → (kernel base) re-kernel |
| Kernel driver / rootkit | `kernel-analysis` | re-binary-core → re-kernel → (debug) re-windbg / re-gdb |
| CTF challenge | `constraint-solving`, `symbolic-execution`, `exploit-development` | re-ctf → identify challenge type → re-angr / re-z3 / re-pwn / re-deobfuscate → (base) re-binary-core |
| .NET/Java/script sample | `bytecode-parser`, `deobfuscation` | re-managed → re-dotnet / re-java / re-script-deob → (Java Card/SIM → re-javacard) → (malicious scenario) re-malware |
| Electron desktop app | `electron-analysis` | re-managed → re-electron → (JS obfuscation inside asar) re-script-deob |
| Smart contract / EVM bytecode | `blockchain-analysis` | re-managed → re-blockchain → (exploit) re-vuln |
| AI model / weight extraction / model watermark | `ai-model-analysis` | re-managed → **re-ai-triage split**: model file (.onnx/.pt/.safetensors and so on) → re-ai-model; API only (behavior layer) → re-ai-attack; malicious behavior (poisoning / backdoor) → re-malware |
| macOS native app | `macho-parser` | re-binary-core → re-format-macho → re-macos |
| Memory forensics / threat intelligence | `memory-forensics`, `threat-intel` | re-forensics → re-mem-forensics → re-ti → (join) re-ioc |
| Disk / image forensics | `disk-forensics` | re-forensics → re-disk-forensics → (timeline / intel) re-ti |
| Mobile-device forensics | `mobile-forensics` | re-forensics → re-mobile-forensics → re-ti |
| Binary variant / patch compare | `binary-diffing` | re-binary-core → re-variant |

## Compound-task examples

- "unpack → static → dynamic → C2 protocol → report": re-anti-analysis → re-binary-core → re-malware(re-sandbox) → re-protocol → re-ioc
- ".NET sample → malice decision → memory forensics": re-managed(re-dotnet) → (malicious scenario) re-malware → re-forensics(re-mem-forensics → re-ti) → re-ioc
- "crash sample → vulnerability root cause": re-vuln (re-fuzzing reproduce → re-crash-triage locate) → (locate) re-binary-core
- After each stage, check whether new evidence changes the later path (for example dynamic analysis finds packing → fall back to re-anti-analysis). Mid-analysis reroute always follows the two tracks in [[rerouting]] (evidence trigger / required check when a gateway finishes).
