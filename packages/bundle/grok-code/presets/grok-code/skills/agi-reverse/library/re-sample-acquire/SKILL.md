---
name: re-sample-acquire
description: >
  Live sample acquisition (from a phenomenon to a usable sample): when the target has no independent process and the sample does not touch disk, locate the carrier by "anomalous executable memory + the execution context that reached that memory" and extract it at runtime.
  Covers four observation models: Windows (VAD/threads/ETW), Linux (VMA/BPF LSM), macOS (Mach VM/Endpoint Security), seL4 (capability provenance).
  Triggers: `样本获取`, `现场采集`, `没有样本`, `只有现象`, `不落盘`, `无文件`, `注入`, `内存马`, `运行时捕获`, `内存提取样本`.
  English triggers: sample acquisition, live acquisition, no sample, fileless, injected code, memory-resident, runtime capture.
capabilities: [sample-acquisition]
---

# Live sample acquisition (from a phenomenon to a usable sample)

<CORE RULE>
**Do not guess a process name, and do not make "find the process" the first goal** — find "anomalous executable memory" + "the execution context that reached that memory".
Detection is based on the **final memory artifact**. It does not depend on "which injection API the sample used" (an unknown injection method can still be caught by the artifact; hooking one API does not cover every injection method).
**Ask provenance first: who created this executable memory, by what path it arrived, and who holds the mapping right** — then talk about which process it belongs to.
</CORE RULE>

## Task classifier (intent → path)

| User purpose | Path |
|---|---|
| Phenomenon description only (`某程序不落盘` / `行为异常`), no sample file | → step 1 (scan anomalous executable regions) → 2 (execution-context attribution) → 4 (dump the whole region) |
| Process known, but no sample file on disk (injection / memory-resident) | → step 2 → 4 |
| Server-resident payload (web middleware / Java and similar, triggered by a request) | → the platform branch's "server" section (memory webshell; the search literal is `内存马`) |
| Payload suspected to be a driver / kernel mode (memory read-write cheat / rootkit) | → [[platform-windows]] kernel side |
| Embedded / microkernel target (seL4 system) | → [[platform-sel4]] (capability provenance route) |
| Callback / download behavior, and the original sample is wanted | → step 7 (network and on-disk side) |

## Entry decision (Decision Gate) — platform × form

```
live acquisition
├─ sample file already exists (on disk) → this skill is not needed; go straight to [[re-triage]] for a first look
├─ Windows target → [[platform-windows]] (VAD/region + threads + module chain + ETW/Sysmon)
├─ Linux target   → [[platform-linux]] (VMA + mmap/mprotect tracing + process_vm_readv)
├─ macOS target   → [[platform-macos]] (Mach task VM + Endpoint Security)
├─ seL4 target    → [[platform-sel4]] (capability/VSpace audit, not "scan processes")
└─ platform unknown / cross-platform → follow the platform-neutral criteria in step 1 first, then enter the matching branch
```

**Platform observation models differ. Methods must not be translated mechanically** (the table below is the division of labor across branches, not a synonym swap):

| Platform | Observation object | Event source (trigger) | Read (ground truth) | Permission model |
|---|---|---|---|---|
| Windows | process VAD/region + threads + module chain | Sysmon 8/10/25, ETW (including Threat-Intelligence), kernel callbacks | `VirtualQueryEx` / `ReadProcessMemory` / PE-sieve | administrator + debug rights |
| Linux | process VMA (`/proc/<pid>/maps`) | tracepoint/kprobe, **BPF LSM** (`file_mprotect` and similar hooks) | `process_vm_readv()` / ptrace / gcore | ptrace access check (including Yama) |
| macOS | Mach task + VM region | **Endpoint Security** (MMAP/MPROTECT/REMOTE_THREAD_CREATE/GET_TASK) | `mach_vm_read` / `mach_vm_read_overwrite` (needs a task port) | SIP / Hardened Runtime / task-port authorization |
| seL4 | capability (VSpace / frame / TCB) | **fault endpoint** + records from system construction | no capability means no access right | capability system (there is no "root reads everything" model) |

## When to use / when not to use

- Use: the analysis target **has no file that can be analyzed** — only a phenomenon (does not touch disk, memory-resident, parasitic in another process), and it must first be turned into "a sample that can be analyzed"
- Use: the payload exists only in memory, and the window is short (one-shot decrypt, clear after use, buffer reuse)
- **Situations it fits (not limited to cheats)**: fileless malware / reflectively loaded payload / memory webshell (server) / APT memory residency / the pre-load stage of ransomware and theft / game cheats (user mode and driver) / unauthorized executable pages on a microkernel or embedded system
- Do not use: a sample file already exists ([[re-triage]]); whole-machine image forensics ([[re-mem-forensics]]; malfind-style checks of an offline image belong there); device-backup parsing ([[re-mobile-forensics]]); "given a PID, how do I dump" ([[re-memdump]])
- **Authorization boundary (hard line)**: collect only on a device / system **you own or have written authorization for** (`RE_AUTH` = `owned` / `research`). The collection actions themselves (enumerate, hook, read memory, dump, load a monitoring component) leave obvious traces and will trip anti-cheat / EDR / business monitoring. Doing this on a production environment or someone else's device is unauthorized. Confirm authorization and the stop condition first
- Boundary: this skill only **collects**. It does not hide from the target's detection system (hiding belongs to the [[re-evasion]] domain, and only in an authorized scenario)

## Tool preparation

### Windows

- **PE-sieve / HollowsHunter** (the reference implementation for this skill: detect injected/replaced PE, shellcode, inline hooks, and patches by memory artifact; supports thread call-stack scans) — GitHub releases (`hasherezade/pe-sieve`, `hasherezade/hollows_hunter`). Check the release-page sha256. Verify with `pe-sieve.exe /help`
- **System Informer** (formerly Process Hacker) / **Process Explorer**: whole-process region / thread / handle view
- **procdump** (Sysinternals): `procdump -ma <pid> out.dmp`; verify `procdump -?`
- **Sysmon** (Event 8/10/25, see the behavior-monitoring section of [[re-behavior]]); **frida** ([[re-frida]], script templates [[re-frida/frida-scripts]])
- Detail: [[platform-windows]]

### Linux

- `/proc` parsing (python3, [[re-python]]), `gdb`/`gcore` ([[re-memdump]]), `bpftrace`/`perf`/BPF LSM ([[re-ebpf]]), `frida`
- Verify: `cat /proc/<pid>/maps | head` shows VMA address / permissions / backing pathname
- Detail: [[platform-linux]]

### macOS

- `lldb` / `vmmap` / `otool` ([[re-lldb]], [[re-format-macho]]); Mach VM API (`mach_vm_region*` / `mach_vm_read*`, needs a task port); Endpoint Security client (needs an entitlement and user authorization)
- Note: **under SIP + Hardened Runtime, root cannot read everything** — see the permission boundary in [[platform-macos]]
- Detail: [[platform-macos]]

### seL4 / microkernel

- No general off-the-shelf tool: a security monitor must record provenance at system-construction time (capability route). Method and checklist: [[platform-sel4]]

## Operating steps (platform-neutral trunk)

The platform-specific implementation of each step is in the matching platform branch. Here, only **what to do and the criteria**.

1. **Scan anomalous executable regions** (do not guess a PID; sweep the surface first):
   - Enumerate the target's execution-memory units and filter "executable": Windows = VAD/region (`VirtualQueryEx`/`NtQueryVirtualMemory`); Linux = VMA (`/proc/<pid>/maps`; from 6.11, `PROCMAP_QUERY` ioctl filters efficiently); macOS = VM region (`vm_region_recurse_64`/`mach_vm_region*`); seL4 = VSpace mapping audit (see the branch)
   - Priority features: **no backing (anonymous/private) and executable**; **protection transition** (W→X, RW→RWX→RX — the instant of the transition is the best capture time); high entropy / executable-format features (PE/Mach-O/ELF); no known JIT/runtime source
   - **Do not check only "private / unbacked"**: file-backed memory can be abused too (Windows `MEM_IMAGE` + module stomping/DLL hollowing; a COW page still reports `MEM_IMAGE`; a Linux file-backed mapping rewritten; a macOS file-backed region patched)
   - **Cross mapping source with the structure record**: Windows uses `VirtualQueryEx`+`NtQueryVirtualMemory` to take the mapping path and compare it with the PEB module chain ("mapped, no module entry" = hidden by unlinking); Linux compares maps pathname/inode with the ELF on disk; macOS compares the dyld record with the VM region
2. **Execution-context attribution** (the thread is the second-strongest signal, and the stack must be read, not only the entry):
   - Take each thread's execution position: start (Windows `NtQueryInformationThread` + `ThreadQuerySetWin32StartAddress`; macOS thread backtrace) → attribute it to an execution region. On Linux, enumerate threads with `/proc/<pid>/task/`. Use `wchan` / `state` in `stat` as auxiliary clues. Take PC and return addresses from a **stack backtrace** (`eu-stack`/gdb)
   - **A normal start can still be a trampoline**: starting in a legitimate module and then jumping into an unbacked executable region bypasses "look only at the start"
   - Add three layers of evidence: **current PC/RIP**, **call-stack return addresses**, **region ownership** — a hit in the anomalous region at any layer raises the score
3. **Runtime correlation (trigger and ground truth have different jobs)**:
   - **The event source is only the trigger for "when to dump"**: memory allocate / write / protection transition + suspicious thread creation + abnormal module load — **judge the combination**. Do not alert on a single point
   - **The memory scan is the ground truth for "what to dump"**: a direct syscall, a shared-segment mapping, or overwriting an existing executable region can all bypass a user-mode hook
   - Platform event sources: Windows = Sysmon 8/10/25 and ETW; Linux = tracepoint/kprobe/BPF LSM; macOS = Endpoint Security; seL4 = fault endpoint
   - **Also catch the injector / constructor**: the source that performed the injection or mapping (process / driver / construction path) is often more valuable to analyze than the parasitic payload
4. **Snapshot / Dump (do not only look for an MZ/PE header)**:
   - **Save the whole suspicious region**: the payload may never have had an executable-format header, or the header may have been **wiped on purpose** (classic: wipe the PE header after injection, then rebuild from the region location)
   - Content class (decides the later analysis path): complete PE/Mach-O/ELF / manually mapped image / raw shellcode / JIT code / decrypted code blob
   - Record per region: base / size / protection and **change history** / type / mapping source / collection time
   - **In-memory copy vs on-disk copy**: compare the on-disk file of a same-named image with the memory contents (finds stomping, patch, wiped header, code replacement)
5. **Rebuild / false-positive assessment / report**:
   - Rebuild: rebuild a manually mapped image from the section table; recover a wiped-header payload from the region contents (mark "rebuilt from memory, not the original file"; the sample phrase is `重建自内存，非原始文件`)
   - **False-positive allowlist and down-rank** (required): JIT (.NET/V8/JVM/Mono), browsers, Wine/Proton, QEMU TCG, **security software's own hooks and patches**, profiler, overlay, shim/hotpatch — they also produce unbacked executable memory
   - **Score, do not make a binary judgment**: unbacked executable + thread/PC/stack hit + recent W→X + high entropy / format features + no known runtime source → high confidence. A single feature is not enough to conclude
   - Report with the core fields of [[re-analyze/analysis-contract]] (target_id / sha256 / evidence) — **the collection method itself is evidence** (sample phrases: `该区在 T 时刻为 RWX` / `该线程起点不在任何映射来源内`)

## Platform branches (references)

- [[platform-windows]] — VAD/region scan, thread and call-stack attribution, Sysmon/ETW/kernel callbacks, PE-sieve and PE rebuild, kernel and driver carriers
- [[platform-linux]] — VMA enumeration (`/proc/<pid>/maps`, `PROCMAP_QUERY`), mmap/mprotect tracing (tracepoint/kprobe/BPF LSM), `process_vm_readv` and ptrace dump, ELF memory-disk diff, memfd and deleted mappings, JIT false positives
- [[platform-macos]] — Mach task and VM region, `mach_vm_read`, Endpoint Security (MMAP/MPROTECT/REMOTE_THREAD_CREATE/GET_TASK), Mach-O/dyld provenance, task port and SIP/Hardened Runtime boundary
- [[platform-sel4]] — capability provenance, VSpace mapping audit, executable-page policy, TCB debug and fault endpoint — **provenance is kept at design time**, a different route from the first three's "reconstruct after the fact"

## Cross-domain join

- [[re-memdump]]: dump execution for a given PID (this skill decides "which to sweep, what to dump")
- [[re-mem-forensics]]: checks of an offline whole-machine image (this skill is the online / live side); [[re-fileless]] / [[re-loader]]: analysis of the collection product
- [[re-frida]]: cross-platform execution layer; [[re-java]]: server-side memory webshell; [[re-kernel]] / [[re-ebpf]]: kernel and kernel-mode observation
- [[re-evasion]]: sample-side anti-detection (the collection side must know it will be seen); [[re-malware]]: product-analysis gateway; [[re-triage]]: product first-look entry
- [[re-rtos]] / [[re-tee]] / [[re-firmware]]: related analysis of embedded and trusted-execution targets (the seL4 branch's system-construction view complements them)

## Common pitfalls (shared across platforms)

- **Hooking only user-mode APIs and thinking that is full coverage**: a direct syscall, a shared segment, or overwriting an existing executable region can all bypass it — the event source is only the trigger; the memory scan is ground truth
- **Treating "unbacked executable" as malicious directly**: JIT, browsers, Wine/Proton, QEMU TCG, and security software's own hooks all produce the same kind of region — **it is a signal, not a verdict**. Need provenance + execution history + a score
- **Checking only "private / unbacked" memory**: file-backed memory is abused too (Windows `MEM_IMAGE`+COW; Linux/macOS file-backed mappings rewritten)
- **Finding the payload only by an executable-format header**: the payload may have no header, or the header may have been **wiped on purpose** — save the whole region, then classify, and rebuild when needed
- **Looking only at the thread entry**: a trampoline, `SetThreadContext`, or borrowing a jump inside a module will bypass it — look at PC and the call stack together
- **Misjudging the platform permission model**: on macOS, root cannot read everything (SIP/Hardened Runtime/task port); seL4 has no "root reads everything" at all — design collection against the platform branch's permission boundary
- **Collecting too late**: one-shot decrypt / clear after use — dump at the **instant** the trigger hits. Do not "note the address and read it later"
- **The collection action itself is exposed**: enumerate / hook / read memory will be seen by anti-cheat, anti-debug, and monitoring ([[re-game]] / [[re-evasion]]) — work inside the authorization, prepare in an isolated environment first, and finish dynamic collection in one pass
- **A traceless hook makes the memory view untrustworthy**: a traceless hook implemented with shadow pages / hardware breakpoints separates the "read view" from the "execute view" — cross several views. **The view difference itself is evidence**
- **Clearing happens before forensics** (common on servers): a restart / killing the process loses the evidence with it — dump and collect evidence first, then block the implant path and the clearing
