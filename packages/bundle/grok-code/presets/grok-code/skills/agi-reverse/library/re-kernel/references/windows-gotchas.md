# Kernel-reversing methodology pitfalls and boundaries

## Version-difference group (the largest variable in kernel analysis)

- **Structure layout changes with the version**: internal field offsets of EPROCESS / DRIVER_OBJECT / _KPCR and similar change across Windows versions (and between Win10 builds) — with symbols, use the symbol name; without symbols, lay the structure out by hand from `ntddk.h` / public structures and record the target version; counterexample: applying an old document's offsets to a new system is entirely wrong
- **Exported symbols change with the version**: `KeServiceDescriptorTable` is no longer exported from Win8 on (SSDT location has to be found by index / memory signature); `!ssdt` output also differs in newer WinDbg — check the tool's capability for that version
- **Signing requirements change with the version**: x64 has always enforced driver signing; newer Win11 builds add attestation-signing requirements — test signing on the analysis VM (`bcdedit`, Secure Boot off) covers only part of the cases; a driver that will not load can be an environment limit, not an analysis error
- **PatchGuard gets stronger with the version**: SSDT / critical-function inline hooks that worked in the Win7 era trigger bugcheck 0x109 (CRITICAL_STRUCTURE_CORRUPTION) on newer x64 — label "historical technique" and "currently usable technique" separately, and do not verify modifications of protected structures on a real environment

## Rootkit technique-boundary group (technique-identification counterexamples)

- **An inline hook does not change the address**: function pointers / table slots all looking normal ≠ no hook — an inline hook rewrites the function prologue; compare the original image byte by byte (get the path from `lmv m nt` and read the original file); compare at least 16 bytes so the check covers the `mov rax,imm64;jmp rax` shape
- **An SSDT hook is not the only table**: newer systems also have IDT / IRP / callback hook surfaces — checking only the SSDT misses them; callback arrays (PsSet* / CmRegister / ObRegister) and minifilters are the more common modern techniques
- **Hidden ≠ absent**: after DKOM unlinks a list, `!process` cannot see it, but the object is still alive (handles / references can locate it) — forensic cross-check uses `psxview`'s cross-view, not a single view
- **A minifilter can look benign**: `FltRegisterFilter` itself is a legitimate filter framework (EDR / backup / AV all use it) — malice is what the callback does (tampering with read/write contents?), not whether it is registered
- **Debugger vs malicious hook confusion**: breakpoints under a kernel debugger (`ba` / `bu`) also rewrite instructions / register context — disable debugger breakpoints before collecting hook evidence, so debug artifacts are not treated as sample behavior

## Environment and tools group

- **A blue screen means roll back**: after a driver bugcheck the debug session may be unusable (on retry the driver is already half loaded) — snapshot rollback is the fastest recovery; do not keep verifying inside a broken state
- **Breakpoint not resolved**: `bp <address>` is invalid before the module is loaded — use `bu <symbol>` (deferred binding); `ba` hardware breakpoints are limited in count (4) and require an aligned address
- **Symbol-server reachability**: on an intranet / offline environment `!analyze -v` with no symbols prints bare addresses — pre-download a symbol cache (`srv*C:\symbols*...`, `.symfix` + `.reload` ahead of time) and confirm symbols loaded before analysis
- **Test-signing environment difference**: test signing affects only the driver-load check, not PatchGuard / structure checks — "it loads" is not "it can hook"; judge the boundaries separately
- **VM kernel-debug link**: a serial named pipe is more stable than KDNET (it does not depend on the NIC); time / performance differences between the debugger machine and the target affect timing-sensitive detection — record the environment parameters

## Usage notes

- All driver load / trigger / verification stays inside the debug VM ([[re-sandbox]] + the top rule in [[re-analyze/platform-tips]]); do not load analysis samples on a production environment
- Grade conclusions with version context per [[windows-decision-tree]]; rootkit-technique descriptions stay inside the authorized analysis scenario
