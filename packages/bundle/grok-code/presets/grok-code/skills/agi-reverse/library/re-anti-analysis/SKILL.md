---
name: re-anti-analysis
type: gateway
description: >
  Anti-analysis gateway. Orchestration: packer identification → simple unpack → strong unpack → deobfuscation.
  Sub-skills: [[re-packer-id]] [[re-unpack-simple]] [[re-unpack-advanced]] [[re-deobfuscate]] [[re-evasion]].
  Triggers: `脱壳`, `查壳`, `加壳识别`, `壳`, UPX, VMProtect, Themida, `反调试`, `反混淆`, `花指令`, unpack, anti-analysis.
capabilities: [unpack, deobfuscation, evasion-analysis]
---

# Anti-analysis (packer identification / unpack / deobfuscation)

## Full workflow

1. **Packer identification: [[re-packer-id]] (capability: `unpack`)** — identify before you act. DIE/PEiD signature-library scan, abnormal section names (UPX0/.aspack/custom), whether the entry point points outside the first section, entropy >7, a tiny import table. **Record OEP clues first** (packer-entry features near the EP such as pushad); the identified packer name decides the path
2. **Dispatch**: a simple compression packer (UPX/ASPack/FSG) → [[re-unpack-simple]] (capability: `unpack`); a strong/virtualizing packer (VMProtect/Themida) → [[re-unpack-advanced]] (capability: `unpack`); **unidentified → manual flow** (find the OEP by hand with the ESP law + a memory breakpoint from [[re-unpack-simple]] (capability: `unpack`), or treat it as a strong packer); do not guess a packer name
3. **Simple unpack: [[re-unpack-simple]] (capability: `unpack`)** — prefer an official/automatic unpack (`upx -d`) → ESP law / memory breakpoint to find the OEP → **time the dump by plaintext/code materialization** (a single-layer packer is often near the real OEP; the OEP is not a universal criterion; timing is in [[re-analyze/platform-tips]] key experience; dump-by-default) → IAT repair (Scylla/ImpREC, Windows)
4. **Strong unpack: [[re-unpack-advanced]] (capability: `unpack`)** — anti-debug countermeasures (scyllaHide approach: NtQueryInformationProcess/timing delta) → stack backtrace / memory-breakpoint combination to find the OEP → dump (dump-by-default) → IAT repair (including redirects) → mark virtualized code regions (mark and bypass rather than recover)
5. **Deobfuscation: [[re-deobfuscate]] (capability: `deobfuscation`)** — if junk instructions / control-flow flattening / string encryption remain after unpack: clear junk instructions, recover flattening (D-810/manual), locate and emulate the string-decrypt loop, batch it into a script, and compare before and after recovery
6. **Verify**: archive the unpack artifact by sha256 → rerun inside the sandbox ([[re-sandbox]] (capability: `sandbox-setup`) decides whether it is fully unpacked, [[re-analyze/platform-tips]] supreme rule) → import into [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) and confirm the OEP decompiles normally; it is done only when the import table resolves. Hand the artifact back to the calling domain (a malware sample returns to [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`) for behavior analysis; a cracking target goes to [[re-cracking]] (capability: `license-analysis`) for license location)

Archive each step (evidence path + sha256; see [[re-triage]] (capability: `triage`)); packer fingerprints / unpack artifacts are YARA feature sources for [[re-ioc]] (capability: `threat-intel`).

## Anti-debug methodology (library-wide; see the [[re-analyze/analysis-contract]] index)

Anti-debug analysis methodology that applies to this gateway (from user practice). Skill pitfalls cite this section.

### Basic detection

- **AD1 Exit on startup: check debug detection first**: EP/TLS/init functions
- **AD2 IsDebuggerPresent is not a complete anti-debug**: combined checks; do not patch only one point
- **AD3 PEB BeingDebugged is a fast user-mode check**: find PEB access / BeingDebugged / NtGlobalFlag
- **AD4 Abnormal NtGlobalFlag → check heap debug flags**
- **AD5 CheckRemoteDebuggerPresent is unreliable**: it may be hooked / replaced / underneath
- **AD6 NtQueryInformationProcess is the focus**: ProcessDebugPort/ProcessDebugObjectHandle/ProcessDebugFlags
- **AD24 A breakpoint on a WinAPI misses → it may call a Native API directly**: the program does not necessarily call a high-level API such as IsDebuggerPresent; it may call NtQueryInformationProcess, NtSetInformationThread, or the Zw family directly. Follow it downward.

### Exception mechanisms

- **AD7 An exception that does not crash → possible anti-debug**: INT3/INT 2D/single-step exception
- **AD32 INT3 has more than one form**: CC vs the long breakpoint CD 03; exception behavior differs
- **AD33 INT 2D is a Windows-specific anti-debug point**: behavior differs under a debugger vs a normal run
- **AD34 ICE instruction detects single-step**: F1 ICEBP
- **AD26 Abnormal exception-breakpoint behavior → check VEH**: AddVectoredExceptionHandler — INT3 is handled on purpose / a single-step exception is swallowed / execution continues after the exception
- **AD27 An abnormal SEH chain → possible anti-debug control flow**: control transfer / hidden flow / debugger detection

### Timing detection

- **AD8 Behavior changes after a breakpoint → check the Trap Flag**: EFLAGS / exception count
- **AD9 Time suddenly slows → check timing anti-debug**: QPC/GetTickCount/timeGetTime/RDTSC
- **AD10 Do not look at only one RDTSC read**: start-end delta, comparison threshold, branch location
- **AD11 Sleep detection → check time acceleration**: Sleep(5000) + check the time actually elapsed — debug environment / sandbox acceleration / time jump
- **AD35 Timing detection is not only RDTSC**: RDTSCP/QPC/GetTickCount64/APIC timer

### Environment and tool fingerprints

- **AD12 Window/mouse detection → environment authenticity**: automated sandbox
- **AD16 Debugger-window detection is crude but common**: OllyDbg/x64dbg/WinDbg/IDA window class or process name
- **AD17 Process-list detection → check tool fingerprints**: debugger/monitor/sandbox; easy to false-positive
- **AD38 Window detection is only a low-end technique**: advanced samples prefer API behavior / memory features / exception behavior
- **AD39 Parent-process detection**: explorer→app vs debugger→app launch chain
- **AD40 Command-line detection**: debugger/sandbox/analysis-environment arguments
- **AD31 The program crashes only in x64dbg → check debugger fingerprints**: x64dbg module / window class / DLL name / memory features
- **AD36 CPU-feature detection may be used for anti-debug**: the program may read CPUID, MSRs, and TSC features to distinguish a real machine, a VM, and a debug environment.

### Hardware traces

- **AD29 Hardware breakpoints also fail → it may check DR registers**: DR0-DR3/DR7 or exception behavior
- **AD43 Debug registers are not the only hardware trace**: DR/LBR/performance-counter state
- **AD15 Hardware-breakpoint detection → check DR registers**: DR0-DR3/DR6/DR7

### Threads and the debug object

- **AD25 A thread suddenly disappears → check NtSetInformationThread**: ThreadHideFromDebugger — the main thread looks normal / logic breakpoints do nothing / the debugger cannot see exceptions
- **AD30 Logic changes after the debugger pauses → check the Debug Object**: ProcessDebugObjectHandle
- **AD37 A debugger changes thread scheduling**: thread execution order / lock contention / APC scheduling

### Self-modification and breakpoints

- **AD13 A breakpoint is cleared → check hardware breakpoints / self-check**: 0xCC detection — check the code section / compare a hash / scan for 0xCC
- **AD14 Code restores itself after execution → possible self-modification**: static contents ≠ what actually executes; needs a memory dump / an execution trace
- **AD28 Code changes after a breakpoint → check self-modifying code**: 55 8B EC→CC 8B EC — check code / restore bytes / actively detect breakpoints

### Deeper detection

- **AD41 PEB detection is not only BeingDebugged**: NtGlobalFlag/ProcessHeap flags/HeapForceFlags
- **AD42 Kernel-debug detection**: KdDebuggerEnabled/KdDebuggerNotPresent
- **AD44 Anti-debug may deliberately create fake logic**: return wrong data / alter an algorithm result / delay execution / skip key logic — more common than exiting
- **AD21 Kernel-level anti-debug → a user-mode patch does nothing**: a driver / kernel callback / kernel-object check needs the kernel path analyzed
- **AD22 Anti-VM ≠ anti-debug**: different targets — an observer vs an analysis environment; do not conflate them

### Methodology

- **AD18 A TLS callback runs earlier than the entry point**: an entry breakpoint never fires the anti-debug → check TLS
- **AD23 An entry breakpoint that never fires → it may still have run; a TLS callback may have gone first**: a Windows PE TLS callback can run code before the entry point. When the program exits on startup or the entry breakpoint does nothing, check the TLS Directory first. Typical cases: anti-debug init, packer init, environment checks.
- **AD19 Do not rush to patch anti-debug logic**: first confirm how the detection result affects control flow — exit / reduced function / fake data / delay
- **AD20 Multi-point anti-debug → find the convergence point**: several checks converge on one flag / state variable / error-handling function
- **AD45 Patching an anti-debug point may trip an integrity check**: JNZ→JMP / CALL→NOP trips CRC/hash/self-check; find the detection chain first

## Anti-VM methodology (library-wide; see the [[re-analyze/analysis-contract]] index)

Anti-VM analysis methodology that applies to this gateway (from user practice). Skill pitfalls cite this section.

### Instruction-level and firmware-information detection

- **AV-001 CPUID hypervisor-bit detection**
  - **Trigger**: the program executes CPUID leaf 1 and checks ECX bit 31 (hypervisor present bit)
  - **Observation**: ECX bit 31 is set, which means it is currently running under a hypervisor
  - **Inference**: the sample is probing a virtualized environment — the most common starting point of anti-VM detection
  - **Action**: continue with the CPUID vendor leaf (0x40000000) to confirm the hypervisor type (Microsoft Hv / VMwareVMware / KVMKVMKVM and others)
  - **Constraint**: hypervisor_present ≠ necessarily a malicious analysis environment — cloud hosts and normal user systems also have a hypervisor; that bit alone cannot decide it is an analysis environment
- **AV-002 Registry BIOS/System information**
  - **Trigger**: the program reads registry BIOS/System information (Manufacturer / ProductName / BIOS Version)
  - **Observation**: the values read are correlated with VMware / VirtualBox / Hyper-V feature strings
  - **Inference**: registry firmware information is a common source of VM fingerprinting
  - **Action**: locate the read site and the feature-string match logic, and collect every VM feature item that hits
  - **Constraint**: a single string hit is not a basis for a VM decision — several features must be judged together

### Timing and hardware features

- **AV-003 Time delta around Sleep**
  - **Trigger**: the measured time delta around Sleep is clearly shorter than expected
  - **Observation**: after Sleep(N) the sample checks the time actually elapsed and it is clearly less than N — time was accelerated/compressed
  - **Inference**: the sample may be detecting sandbox time acceleration / virtualized time (a timing API was hooked or the clock was sped up)
  - **Action**: follow the RDTSC / QPC / GetTickCount source — locate the time-read site and the delta logic, and confirm which clock source the sample uses
  - **Constraint**: timing checks are often combined (RDTSC paired with CPUID to force a VM exit, GetTickCount / QPC cross-checks); do not handle only one site
- **AV-004 Hardware-device enumeration**
  - **Trigger**: the program enumerates hardware devices (PCI / Disk model / GPU name)
  - **Observation**: the enumeration result is compared with virtual-machine hardware-model features
  - **Inference**: VM fingerprinting — hardware device models are a common VM fingerprint source
  - **Action**: build a hardware-feature set rather than a single-point judgment — list every hardware item that is checked and assess the set as a whole
  - **Constraint**: one hardware feature (for example one disk model) is not enough to decide VM; the feature set must be assessed together

### Environment scoring and interaction detection

- **AV-005 Detection results converge on one variable**
  - **Trigger**: detection results from several VM-check functions are written to one variable (is_vm / sandbox_score / env_flag)
  - **Observation**: several detection sites converge on the same variable/state
  - **Inference**: the sample uses an environment-scoring mechanism — several detection items are counted/weighted into an environment score
  - **Action**: trace the convergence variable — break on its reads and writes or follow xrefs statically; avoid analyzing detection points one by one
  - **Constraint**: looking at a single detection point misses the overall scoring logic — the score threshold and how items combine are what matter
- **AV-006 User-interaction detection**
  - **Trigger**: the program detects user interaction (mouse / keyboard / uptime / window activity)
  - **Observation**: the sample checks interaction traces such as mouse movement, keyboard input, system uptime, and window activity
  - **Inference**: the sample is trying to distinguish a real user from an automated sandbox — interaction traces are a behavior-level environment fingerprint
  - **Action**: move to behavior-level analysis rather than a hardware fingerprint — interaction-related branches need dynamic cooperation (simulated interaction or observation in a real environment)
  - **Constraint**: interaction detection is mostly behavior-level and hard to recover fully from static analysis alone — combine it with dynamic observation

### Virtualization channels and execution paths

- **AV-007 VMware-specific channel calls**
  - **Trigger**: the program calls the VMware backdoor / Guest Additions / vmtools
  - **Observation**: the sample touches VM-only channels (the VMware I/O port backdoor, the vmtools service/process, the Guest Additions module)
  - **Inference**: high-probability virtualization detection — these channels exist for real only inside a virtual machine
  - **Action**: confirm how the call result affects control flow — locate the backdoor call site and where the return value is used, then decide a patch strategy
  - **Constraint**: detecting a VM channel does not necessarily mean it exits — see where the detection result flows before you act
- **AV-008 The detection result affects the execution path**
  - **Trigger**: the detection result affects the execution path — a VM environment takes a different branch
  - **Observation**: "is a VM" and "is not a VM" take different code branches
  - **Inference**: anti-VM is not only for exiting — it may change sample behavior (fake logic / reduced function / a different payload)
  - **Action**: analyze the difference between the two branches — compare code and data on the VM / non-VM paths; do not only patch the detection point
  - **Constraint**: same idea as anti-debug fake logic (see anti-debug methodology AD44) — do not trust the output immediately after a patch

## Which atomic skill to use (selection tree)

**Identify first, then pick an unpack path; if identification fails, use the manual flow.**

- **The input is an unknown sample / you suspect a packer** → [[re-packer-id]] (capability: `unpack`) identifies it → branch on the result (do not skip steps)
  - A simple compression packer is identified (UPX / ASPack / FSG and similar) → [[re-unpack-simple]] (capability: `unpack`)
  - A strong / virtualizing packer is identified (VMProtect / Themida and similar) → [[re-unpack-advanced]] (capability: `unpack`)
  - **No packer name is identified** (no signature match) → manual flow: first try the ESP law + a memory breakpoint from [[re-unpack-simple]] (capability: `unpack`); on failure, or when anti-debug/virtualization features appear → manual unpack with [[re-unpack-advanced]] (capability: `unpack`)
- **The goal is only to confirm the packer** ("what packer is this") → [[re-packer-id]] (capability: `unpack`) is enough; do not enter unpack
- **Code obfuscation remains after unpack** (junk instructions / flattening / string encryption) → [[re-deobfuscate]] (capability: `deobfuscation`)
- **The target is confirmed unpacker-free** → this gateway is not needed; go to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`; [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`)) and analyze directly
- **Detection evasion / EDR countermeasures (AMSI/ETW bypass, fileless, a lolbin chain, "why was the sample detected")** → [[re-evasion]] (capability: `evasion-analysis`; dynamic first, with [[re-sandbox]] (capability: `sandbox-setup`) / [[re-memdump]] (capability: `memory-dump`))
- Reading process memory throughout an unpack → [[re-memdump]] (capability: `memory-dump`; dump by default, time it by materialization); Windows debugging → [[re-x64dbg]] (capability: `debugging`); Linux/Wine debugging → [[re-gdb]] (capability: `debugging`)

## Cross-domain joins

- A packed malware sample: [[re-malware]] → this gateway (packer-id → unpack-*), then the unpack artifact is rerun in the sandbox before behavior analysis
- Cracking precondition: [[re-cracking]] → this gateway (unpack first if packed, then locate the license logic); the license-location artifact feeds a patch/keygen
- Mobile packing: [[re-mobile]] / [[re-apk]] → this gateway (Android packer unpack)
- A packer found statically: [[re-binary-core]] / [[re-format-pe]] / [[re-format-elf]] / [[re-imports]] (a tiny import table / imports hidden by the packer) → enter this gateway
- Dynamic assistance: [[re-gdb]] (break on the OEP, unpack under Wine), [[re-x64dbg]] (Windows OEP + Scylla), [[re-memdump]] (dump by default, time it by materialization), [[re-tracing]] (cooperate when an anti-debug sample detects the trace environment)
- Unpack-artifact verification must use the sandbox: [[re-sandbox]] ([[re-analyze/platform-tips]] supreme rule)
- Packer-layer constants pollute fingerprints: [[re-crypto-id]] unpacks a packed sample before a constant-table fingerprint
- Detection-evasion countermeasures: [[re-evasion]] — a packer/obfuscation is "static anti-analysis", and AMSI/ETW/fileless/lolbin is "detection countermeasure"; both belong to this gateway (dynamic analysis forces [[re-sandbox]])
- This gateway is called by the [[re-analyze]] triage path "sample is packed / unpack" (re-anti-analysis → packer-id → unpack-* → verify)

## Common pitfalls

- **Unpacking without identifying first**: symptom — you put the sample on a debugger/OEP flow immediately, hit strong-packer anti-debug, or waste time; cause — the packer class was not judged first; fix — identify with [[re-packer-id]] first; a simple packer is unpacked automatically in seconds, and only a strong packer is worth the manual flow
- **Dumping too early**: symptom — the dump is still the packer's initial state (compressed/encrypted data), and the unpack did nothing; cause — plaintext/code had not materialized yet; fix — a single-layer packer is usually appropriate near the real OEP, but the OEP is not a universal criterion; for multi-stage / on-demand decrypt / virtualization / reflective loading, set the dump point by "write → execution transfer + memory-protection change + payload header/import recovery" ([[re-analyze/platform-tips]] key experience; dump-by-default)
- **Treating an unrepaired IAT as a finished product**: symptom — after unpack the import table is garbage and Ghidra/IDA decompilation is chaos; cause — the import table is rebuilt dynamically inside the packer and the dump was not repaired; fix — repair with Scylla/ImpREC on Windows, then decompile again to verify
- **Packer inside a packer**: symptom — after one layer you find another (Themida inside UPX, and similar); cause — multi-layer packing is a common anti-analysis technique; fix — verify each layer as you unpack it (sha256 + import table + sandbox rerun); when there is another layer, go back to step 1 and identify again
- **Anti-debug interferes with the whole flow**: symptom — debugger breakpoints do not take effect, the process exits, timing is scrambled; cause — the sample detects a debugger (NtQueryInformationProcess, a timing delta, the debug port); fix — do the [[re-unpack-advanced]] anti-debug countermeasure first (scyllaHide approach), and attack the outermost check first
- **OutputDebugString timing trap**: symptom — behavior differs after the sample calls `OutputDebugStringA/W`, or a stretch of code is clearly slower under a debugger and trips a timing check; cause — the debugger has a fixed slow path for ODS messages (receive-format-refresh), and the sample uses the timing difference of a long-string ODS call as a debugger probe (still used by malware samples in 2024-2025); fix — break on / bypass the ODS call site (return a fake value or skip it), or hide ODS handling with scyllaHide, and investigate it together with timing-delta detection (AD9)

- **High entropy ≠ encryption**: symptom — a section such as `.of2`, 4KB at entropy 7.9, is judged "encrypted as a whole" and static analysis is abandoned; cause — it may be compression (deflate with no standard header), VMProtect mutated code, or pure data; fix — **sample by region** (the entry region's 64B entropy may be only 5.6 and is real code); rule out compression and mutation before calling it encryption; mutated-code features: an `ror/xor chain + a cross-region jmp`, sequential decode showing junk such as `fcom/int 88h/ret far`, while the first 24 bytes of the entry are a call/syscall structure
- **The full debug-system chain (anti-debug points)**: symptom — you do not understand "why attaching pauses the program" and do not know where anti-debug should be changed; cause — missing the full Windows debug-system chain; fix — the chain: `DebugActiveProcess`→`DbgUiConnectToDbg` (create a DEBUG_OBJECT and attach the debugger first; the handle is stored in `TEB->DbgSsReserved[1]` (offset 0x16A8))→`NtDebugActiveProcess`→`DbgkpSetProcessDebugObject` (hang it on the debuggee) + `DbgkpPostFake*Messages` (the fake "thread created / dll loaded" messages that flood the screen on attach); debug-event flow: the debuggee detects that it is being debugged → creates a DEBUG_EVENT and links it into the EventList doubly linked list → sets the EventsPresent semaphore to wake the debugger → waits forever on ContinueEvent; **anti-debug points**: `DbgUiRemoteBreakIn` creates a remote thread that executes int3 so the program breaks (remove that int3 and attach no longer breaks); TEB+0x16A8 is the debug-object handle (detecting/tampering with it interferes with the debugger); exceptions are sent to the debugger first (`DbgkSendApiMessage`→`DbgkpQueueMessage`, flag=0 must wait vs a NOWAIT fake message)
- **Function-level encryption in an so (dlsym decrypts at runtime)**: symptom — one function in the so (for example `mymyadd`) decompiles as garbage/undefined instructions while the rest is normal; cause — so packing encrypts the target function by symbol name: the function's code section is ciphertext statically, and at runtime it is decrypted and overwritten before `dlopen`+`dlsym`, then encrypted again after the call; fix — recovery idea: the dlsym symbol-resolution chain (`__loader_dlsym`→`dlsym_impl`→`do_dlsym`→`dlsym_handle_lookup`→`find_symbol_by_name`, GNU hash / ELF hash, pick one: GNU hash needs a `gnu_hash` computation + a Bloom filter + finding the symbol table from PT_DYNAMIC), and from the ELF header → program header table → PT_DYNAMIC locate the symbol table and hash table to compute the function's location and size; dynamic side: after `dlopen`/`dlsym` returns, dump the decrypted function memory (dump timing is the key experience); variant: per-section XOR of the section-header type (MODE_DUPLEX) needs a custom linker load before it can run; there is also encrypting `.text` as a whole and then self-decrypting — first confirm whether it is function-level or section-level, then pick a plan
