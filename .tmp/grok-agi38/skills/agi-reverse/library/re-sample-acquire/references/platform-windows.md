# Windows platform branch: VAD / threads / events / kernel

The observation object is **the process's VAD (virtual address descriptor) and region + threads + module chain**. The process is only a container.

## 1. Scan for anomalous executable regions (do not guess a PID)

- Walk: `VirtualQueryEx` / `NtQueryVirtualMemory` across the target address space. A whole-process sweep uses HollowsHunter (PE-sieve engine)
- **Priority features**:
  - `State=MEM_COMMIT` + `Type=MEM_PRIVATE` + protection includes an execute bit (Volatility `malfind`'s classic criterion: private + committed + executable)
  - **Protection transition**: W→X, RW→RWX→RX — write first, then make executable, is the strongest signal. The instant of the transition is the best capture time (the hook point in step 3)
  - Protection-value reference: `PAGE_EXECUTE_READWRITE`(0x40), `PAGE_EXECUTE_READ`(0x20), `PAGE_EXECUTE_WRITECOPY`(0x80)
- **`MEM_IMAGE` cannot be judged clean**:
  - module stomping / DLL hollowing puts a payload into a mapping that looks like a legitimate DLL (the mapping type is still `MEM_IMAGE`)
  - a copy-on-write image page **still reports `MEM_IMAGE`** from `VirtualQueryEx` — to tell whether it has become a private modified page of this process, check the **Working Set `.Shared` bit** (`K32QueryWorkingSetEx`). That bit is also a way to find an **inline hook** (writing the hook triggers COW privatization)
- **Module-chain cross-check (missing PEB module)**: use `VirtualQueryEx` + `NtQueryVirtualMemory` to take the mapped file path of `MEM_IMAGE` and compare it with the PEB loaded-module list — "mapped, no PEB entry" = a module hidden by unlinking (`GetModuleHandle` / `EnumProcessModules` cannot see it; the memory view can)

## 2. Execution-context attribution

- Thread start: `NtQueryInformationThread(hThread, 9 /* ThreadQuerySetWin32StartAddress */, &addr, sizeof(addr), NULL)` → `VirtualQueryEx` on the region that contains that address: `MEM_COMMIT && Type != MEM_IMAGE` is suspicious (the criterion used by Get-InjectedThread-class scripts)
- **Looking only at the start misses cases** (known bypasses): (1) LoadLibrary/DLL injection (code lands in `MEM_IMAGE`); (2) `SetThreadContext` rewrites RIP (the start shows inside a legitimate module); (3) a `jmp rcx`-class gadget (borrows an existing jump inside a module as the entry); (4) on Win11 a thread started via `_beginthreadex` has its start in msvcrt; (5) a trampoline from a legitimate DLL into a private executable region
- **Add three layers of evidence**: current RIP, **call-stack return addresses**, region ownership — PE-sieve `/threads` specifically scans thread call stacks (can catch shellcode and a sleeping beacon)

## 3. Event side (trigger, not ground truth)

- **Sysmon**: Event 10 (ProcessAccess — who opened the target), Event 8 (CreateRemoteThread, with `StartAddress` / `StartModule` / `StartFunction`), Event 25 (ProcessTampering / image hollowing)
- **ETW**: the Threat-Intelligence provider can expose direct syscalls, memory allocation, and thread-context rewrite (driver / EDR implementation side: see [[re-evasion]])
- **Kernel callbacks** (when a driver is available): `PsSetCreateProcessNotifyRoutine` / `PsSetCreateThreadNotifyRoutine` / `PsSetLoadImageNotifyRoutine` — LoadImage finding "an executable mapping with no matching file on disk", and a thread start that is inside no module, are both strong evidence
- Division of labor with the memory scan: the event source answers "**when** to dump"; the memory scan answers "**what** to dump". A direct syscall / shared section / overwrite of an existing RX region can bypass a user-mode hook

## 4. Dump and rebuild

- Tools: `pe-sieve.exe /pid <pid> /shellc /hooks /imp /dmode unmap` (injected PE is unmapped and rebuilt automatically), `/minidmp`, `procdump -ma <pid> out.dmp`
- **Save the whole suspicious region**. Do not filter only on `MZ`: the payload may have no PE header, or the header may have been wiped on purpose (classic case: wipe the PE header after injection → locate by region → dump, then rebuild the PE from sections)
- Content classes: complete PE / manually mapped PE / raw shellcode / JIT code / decrypted code blob
- **Module memory vs disk difference**: compare the on-disk copy of a same-named module with the in-memory copy (finds stomping, patch, wiped header). PE-sieve `/dmode unmap|realign` and import-table recovery (`/imp`) exist for that rebuild

## 5. Kernel and driver carriers (common for cheats / rootkits)

- Scan kernel executable memory + **compare before and after driver load** to locate a driver with no module (a driver can unlink itself from the module chain)
- Record: driver object, whether Device/Io dispatch routines were rewritten (hijacking a system-driver pointer for communication is a common technique), whether callback registrations (`ObRegisterCallbacks` and similar) were removed
- Method details and tools: see [[re-kernel]]

## 6. False positives and allowlist

- Allowlist / down-rank: .NET and browser JIT, AV/EDR's own hooks and patches, shim/hotpatch, profiler, overlay
- Score: private executable + thread/RIP/stack hit + recent W→X + high entropy / PE features + no known source → high confidence. A single feature is not enough to conclude

## Tools and verification

- PE-sieve / HollowsHunter: GitHub releases (`hasherezade/pe-sieve`, `hasherezade/hollows_hunter`). Check the release-page sha256. Verify with `pe-sieve.exe /help`
- System Informer (systeminformer.com) / Process Explorer (Sysinternals): three views — region, thread stack, handles
- Verify the collection surface: in the target process, see at the same time "executable region list + each thread's start and the region it is in + module chain"

## Pitfalls on this platform

- **Hooking only `VirtualProtect` (kernel32)**: a sample that calls `NtProtectVirtualMemory` directly bypasses it — hook both (or use a kernel callback)
- **Treating `MEM_PRIVATE + executable` as the conclusion**: JIT and security software produce the same thing — take a baseline first (a clean environment of the same kind of process) and report only the delta
- **Traceless hooks**: a traceless hook implemented with shadow pages / hardware breakpoints makes "what was read" and "what was executed" different memory — cross several views (user-mode read, kernel-side read, PE-sieve). The difference is the evidence
