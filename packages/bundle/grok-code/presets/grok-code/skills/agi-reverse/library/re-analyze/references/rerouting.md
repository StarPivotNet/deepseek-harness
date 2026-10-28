# Mid-analysis reroute trigger table

The only source of truth for runtime evidence triggers (distinct from triage.md's entry "goal → path" decision table). Use the two tracks during analysis:

- **Track 1 (required check when a gateway finishes)**: after each gateway, check new evidence against tables A/B
- **Track 2 (check as soon as evidence appears)**: each new evidence type (string / section table / behavior / crypto feature) is checked against table A immediately
- **No hit** → act under table B constraints. Do not grind it out alone.

**Table A matches by capability**: map the evidence feature to "required capability" first, then reverse-lookup the skill that provides it in `capability-index.md` — the skill column is an index result, not a hard-coded domain name. `npm test` checks that "capability-column tags are in the registry" and that "a skill on this row actually declares that capability". The column heading literal is `需要能力`.

## Table A: evidence feature → required capability → trigger skill

| Evidence feature (seen during analysis) | Required capability | Trigger skill (index reverse lookup) |
|---|---|---|
| Abnormal section table (UPX0/.aspack), entropy >7.0 | `unpack` | [[re-packer-id]] → [[re-anti-analysis]] |
| Unknown crypto algorithm, S-box / constant fingerprint, encrypted traffic | `crypto-identification` | [[re-crypto-id]] |
| Hard-coded key / passphrase, key in memory | `key-extraction` | [[re-crypto-keys]] |
| Decrypt function located, ciphertext recoverable | `crypto-decryption` | [[re-crypto-decrypt]] |
| Anti-debug / anti-VM features (ptrace, CPUID, timing checks) | `evasion-analysis` | [[re-anti-analysis]] / [[re-evasion]] |
| Dynamically registered JNI, function-level encryption in an so | `jni-analysis` | [[re-android-native]] |
| Obfuscation (CFF / junk instructions / string encryption) | `deobfuscation` | [[re-deobfuscate]] |
| Network callback / beacon / C2 features | `network-capture` | [[re-netcap]] → [[re-behavior]] |
| Persistence / injection / abnormal process tree | `malware-behavior` | [[re-behavior]] |
| Crash / segfault / ASAN report | `debugging` | [[re-crash-triage]] |
| Python packing features (PyInstaller/PyArmor) | `bytecode-parser` | [[re-python]] |
| Packer-vendor features (Android protection packer) | `unpack` | [[re-mobile-pack]] |
| Dense RTTI / exception tables (.pdata/.xdata) | `decompilation` | [[re-cpp-abi]] |
| PDF / Office macro / phishing-document features | `document-malware` | [[re-doc-malware]] |
| Patch / N-day compare need (before and after a fix / variants) | `binary-diffing` | [[re-variant]] |
| Trailer appended to a file / abnormal image (stego suspicion) | `stego-detection` | [[re-stego]] |
| White-box crypto features (large lookup tables + encoding network) | `crypto-identification` | [[re-whitebox]] |
| Kernel driver / rootkit structure | `kernel-analysis` | [[re-kernel]] |
| A memory region was made executable (W→X / RWX); an unbacked region is executing | `sample-acquisition` | [[re-sample-acquire]] |
| A server-side dynamically registered component has no matching class file (memory-webshell feature) | `sample-acquisition` | [[re-sample-acquire]] → [[re-java]] |
| Whole-machine memory image (LiME / crash dump) | `memory-forensics` | [[re-mem-forensics]] |
| Disk image / unallocated space / abnormal partition table | `disk-forensics` | [[re-disk-forensics]] |
| Jailbreak detection / tweak (dylib injection) features | `jailbreak-analysis` | [[re-ios-jb]] |
| Flutter / RN engine features | `hybrid-app-analysis` | [[re-hybrid-app]] / [[re-flutter]] |
| Go buildinfo / pclntab features | `lang-runtime-analysis` | [[re-go]] |
| Rust / Swift / Zig / Nim product features | `lang-runtime-analysis` | [[re-rust]] / [[re-swift]] / [[re-zig]] / [[re-nim]] |
| MMIO peripheral region + Thumb features (embedded bare-metal firmware) | `arch-analysis` | [[re-arm]] |
| RISC-V compressed instructions / MIPS delay-slot features | `arch-analysis` | [[re-riscv]] / [[re-mips]] |
| VT-x / SVM instructions (VMXON/VMREAD) or a VMCS structure | `hypervisor-analysis` | [[re-hypervisor]] |
| BPF ELF sections (.maps/.BTF/.rel*, kprobe/tracepoint named sections) | `ebpf-analysis` | [[re-ebpf]] |
| VxWorks / QNX signature strings (task-table symbols / kernel-object names) | `rtos-analysis` | [[re-rtos]] |
| A process registered a pathname and loops receiving messages; no kernel module, yet it controls hardware | `rtos-analysis` | [[re-rtos]] (QNX resource-manager model) |
| A driver is neither a standalone process nor a kernel module (loaded inside the network-stack process) | `rtos-analysis` | [[re-rtos]] → [[re-rtos/qnx]] |
| init / device objects have no direct xref; a regularly arranged run of structs (link-time registration) | `rtos-analysis` | [[re-rtos/zephyr]] |
| An independent module has many unresolved symbols; behavior differs between systems of the same version | `rtos-analysis` | [[re-rtos/vxworks]] |
| dlopen semantics do not look like a Unix shared library; device dispatch shows no file_operations | `rtos-analysis` | [[re-rtos/rtems]] |
| A cross-stage data structure has no producer; runtime addresses do not match firmware addresses | `uefi-analysis` | [[re-uefi/pi-stages]] |
| Comparing handle values across processes is meaningless; the original value dies after transfer; co-resident drivers have IPC and no syscall | `kernel-analysis` | [[re-kernel/zircon-kernel]] |
| An init function has no caller; a pointer array lives in a section named set_* | `kernel-analysis` | [[re-kernel/freebsd-kernel]] |
| Driver entry is _init/_fini/_info plus a modlinkage/dev_ops/cb_ops skeleton | `kernel-analysis` | [[re-kernel/illumos-kernel]] |
| The same kernel version lays out differently on every boot; two binaries differ byte for byte | `kernel-analysis` | [[re-kernel/openbsd-kernel]] |
| A module appears or disappears with no loader; module load fails but the file is fine | `kernel-analysis` | [[re-kernel/netbsd-kernel]] |
| The same service name looks connected to different objects; a capability value is treated as a global ID; quota contradicts remaining system memory | `kernel-analysis` | [[re-kernel/genode]] |
| A driver process disappears and reappears; an integer in IPC looks like a grant; two identical instances appear during an update | `kernel-analysis` | [[re-kernel/minix3]] |
| The same path reaches different objects; directory contents look stacked in layers; a new filesystem appears that does not depend on a kernel module | `kernel-analysis` | [[re-kernel/plan9]] |
| A PV device has no register window; a grant ref / event-channel port is treated as an address and an IRQ | `hypervisor-analysis` | [[re-hypervisor/xen]] |
| A guest's MMIO/BAR does not match real hardware; a cross-VM shared region will not connect; after an out-of-rights access the program suddenly stops | `hypervisor-analysis` | [[re-hypervisor/qnx-hypervisor]] / [[re-hypervisor/jailhouse]] / [[re-hypervisor/acrn]] / [[re-hypervisor/bao]] |
| The same API looks completely different across samples (very short function + immediate trap); address permissions come and go | `rtos-analysis` | [[re-rtos/nuttx]] |
| An ISR mixes in the task-version API; access rights change with the run phase (MPU) | `rtos-analysis` | [[re-rtos/freertos-context]] |
| Many "fill a request ID → jump to a common dispatcher"; code addresses fall outside the module memory region | `rtos-analysis` | [[re-rtos/threadx-modules]] |
| An ISR only clears a status bit and returns; a function with no thread entry is called repeatedly | `rtos-analysis` | [[re-rtos/ecos]] |
| A high-priority thread does not run and there is no contention; sampling / queue semantics are confused; a fixed-address APEX service table | `rtos-analysis` | [[re-rtos/partitioned-rtos]] |
| A runnable with no caller; an implicit access reads a stale value; a service returns E_OS_ACCESS | `automotive-analysis` | [[re-automotive/autosar-classic]] |
| A binary is installed but the process does not exist; the process list does not match the model list | `automotive-analysis` | [[re-automotive/autosar-adaptive]] |
| Many "thread switches" appear inside one OS thread (kernel scheduling does not match) | `kernel-analysis` | [[re-kernel/helenos]] |
| What read/write land on is not a filesystem; handles on the two sides do not match | `kernel-analysis` | [[re-kernel/redox]] |
| A driver is absent at startup and appears only after some device is accessed | `kernel-analysis` | [[re-kernel/haiku]] |
| The execution address belongs to another address space; a routine with no caller still has behavior | `kernel-analysis` | [[re-kernel/zos]] / [[re-kernel/openvms]] |
| An object address does not look like a DRAM pointer; the storage abstraction does not match POSIX | `kernel-analysis` | [[re-kernel/ibmi]] |
| No user→syscall→kernel boundary can be found; a syscall has no privilege switch | `kernel-analysis` | [[re-kernel/unikraft-mirageos]] |
| A switch happens at the tail of an interrupt; a task becomes ready and does not switch; a call inside an ISR does not take effect immediately | `rtos-analysis` | [[re-rtos/ucos-sysbios]] / [[re-rtos/safertos-rtx5]] |
| The same address is accessible under one task and not another; a handle does not look like a pointer | `rtos-analysis` | [[re-rtos/safertos-rtx5]] |
| A service call is legal in a task and rejected in an interrupt | `rtos-analysis` | [[re-rtos/tkernel-toppers]] |
| The peer of a message / signal cannot be found (suspected cross-node) | `rtos-analysis` | [[re-rtos/ose-oseck]] |
| A small integer handle is treated as an address; network traffic disappears mid-way but the function still works | `hypervisor-analysis` | [[re-hypervisor/hyperv-vmbus]] |
| No reconfiguration code for resource allocation can be found; a plan switch does not take effect immediately | `hypervisor-analysis` | [[re-hypervisor/xtratum]] |
| VM-exits are rare but isolation is not missing; cross-domain timestamps do not match | `hypervisor-analysis` | [[re-hypervisor/questv]] |
| No dynamic reconfiguration / management entry can be found; the kernel has no driver or I/O stack | `hypervisor-analysis` | [[re-hypervisor/lynxsecure]] |
| The binary is there but the process is not; service discovery returns empty; restart with no crash; after an update data is kept or disappears | `automotive-analysis` | [[re-automotive/autosar-adaptive]] |
| Isolation still exists under linear addresses; the same address's rights change with the task; the word "partition" is ambiguous | `rtos-analysis` | [[re-rtos/nucleus]] |
| A blocking wait appears inside a software-timer callback; a task is woken but has no resource | `rtos-analysis` | [[re-rtos/ucos-sysbios]] |
| A small integer handle is treated as an address; deleting a handle blocks; a callback returns but the resource is not released | `hypervisor-analysis` | [[re-hypervisor/hyperv-vmbus]] |
| The ring advances with no notification; event unmask behaves oddly; after migration the port and domid change | `hypervisor-analysis` | [[re-hypervisor/xen]] |
| The same source has completely different I/O under different builds; every task stalls together | `kernel-analysis` | [[re-kernel/unikraft-mirageos]] |
| A module carries self-describing metadata (UUID / endpoints / resources / dependencies / signature); IPC looks like an entry page + bitmap + failure branch | `kernel-analysis` | [[re-kernel/hic]] |
| Program attributes make stack behavior reverse (stack direction / stack-pointer bias); AMODE/RMODE mismatch; control blocks in a dump do not line up | `kernel-analysis` | [[re-kernel/zos]] |
| Objects / pointers come in two sets (system pointer vs space pointer); static-data ownership is unclear; the product is in a compressed state | `kernel-analysis` | [[re-kernel/ibmi]] |
| Exceptions follow a "processor chain" rather than throw-catch; a shared image does not match expectations | `kernel-analysis` | [[re-kernel/openvms]] |
| A signal number is not unique and needs a secondary id; buffers land in another pool; behavior differs across DSPs | `rtos-analysis` | [[re-rtos/ose-oseck]] |
| The same source under different configs produces very different products; exception destination is not fixed; constructors are overwritten | `rtos-analysis` | [[re-rtos/ecos]] |
| .NSO/.NPDM container structure (Switch encrypted partitions) | `console-analysis` | [[re-console]] |
| asar structure (resources/app.asar + internal files tree) | `electron-analysis` | [[re-electron]] |
| CAP Header component magic (DE CA FF ED; the file as a whole is a ZIP; Java Card 12 components) | `bytecode-parser` | [[re-javacard]] |
| HarmonyOS hap/hsp package structure, ArkTS .abc bytecode | `bytecode-parser` | [[re-harmonyos]] |

## Table B: stall signal → change path

| Stall signal | Change path |
|---|---|
| Same parameters repeated ≥2 times with no new evidence | recheck table A / change tool angle ([[analysis-contract]] investigation budget) |
| A single command ≥3 times with no progress | stop and assess; rerun re-analyze step 2 (task identification) or change gateway |
| Across the target, more than 30 tool calls with no conclusion | fall back to the last stage that produced something, and deliver a partial conclusion in the [[analysis-contract]] review format |
| Target behavior contradicts the static conclusion | compare on the dynamic side with [[re-sandbox]] / [[re-tracing]] |
| The skill table A hit does not apply (for example the target form does not match) | look up other skills under the same capability in `capability-index.md` (same capability, different form) |

## Usage rules

1. Each new evidence type → check table A; on a hit, call the matching skill, then return to track 1
2. Each gateway finish → check tables A+B
3. No table row hit → act under table B constraints (change approach / fall back / deliver a partial conclusion)
4. When adding a table A row: set "required capability" first (a registry tag), then reverse-lookup the skill in `capability-index.md` and fill it in — **do not write only a domain-name skill** (`npm test` checks that the capability and the skill declaration match)
