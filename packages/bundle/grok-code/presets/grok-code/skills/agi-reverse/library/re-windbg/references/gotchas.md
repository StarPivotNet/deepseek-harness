# WinDbg tool-specific pitfalls and boundaries

## Version differences (classic vs Store vs WDK)

- **Classic (WinDbg 10.0.x)**: installed with Windows SDK "Debugging Tools for Windows". Traditional Win32 UI. `windbg.exe`/`kd.exe`/`cdb.exe` are in the same package
- **Store (WinDbg 1.x, WinDbg Next)**: `winget install Microsoft.WinDbg` or the Store. New Chromium UI. Commands are compatible with the classic build (the same debug engine), but the UI entries for attach/breakpoints/the memory view differ — when a tutorial screenshot does not match, operate from the command window. The commands are shared
- **WDK**: installs the kernel-debug toolchain (kd.exe/kdnet.exe, `bcdedit`-related scripts, driver test tools) — user-mode debugging alone does not need the whole WDK
- **32-bit and 64-bit WinDbg are separate**: the classic build has x86 and x64 executables — opening a 64-bit dump with 32-bit WinDbg reports a format error. The Store build handles this automatically
- **Command compatibility**: `!` extension commands come from extension DLLs (`ntsdexts`/`ext` and similar). An old version may lack an individual extension — core commands such as `!analyze` exist in every version

## Symbol-server pitfalls

- **Symbols not configured → all bare offsets**: `lm` ends with `(no symbols)`, and `k` prints `module!+0x1a` — `.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols` then `.reload /f`
- **Symbol server unreachable / a proxy**: an intranet that cannot pull symbols hangs (it retries for a long time) — point `.sympath` at the local symbol cache first. When setting `_NT_SYMBOL_PATH`, confirm the network is reachable
- **Private symbols (not public)**: public symbols for system DLLs only go to function granularity. Line numbers / locals need private symbols — when analyzing system-component logic, follow the disassembly. Do not depend on `dv` locals
- **`bu` vs `bp`**: `bu` (unresolved) works for a module symbol that is not loaded yet (it binds automatically after the module loads) — use `bu` for a breakpoint inside a DLL. `bp` fails because the symbol is unresolved
- **A stale symbol cache**: the symbol cache is old and does not match the binary (after a service pack) — when `!analyze -v` shows scrambled addresses, delete the matching entries under `C:\symbols` and pull again

## Kernel-debug pitfalls

- **PatchGuard (kernel protection) limits**: local kernel debugging (`File > Kernel Debug > Local`) is only usable on a test machine and is capability-limited (PatchGuard interferes with breakpoints/single-step). Formal kernel analysis uses a two-machine/VM transport
- **Transport configuration must match on both sides**: serial parameters (debugport/baudrate) or NET parameters (hostip/port/key) must match exactly between host and target — recheck with `bcdedit /dbgsettings`. A VM pipe serial uses the same `\\.\pipe\com_1` name on both sides
- **kdnet key lifetime**: the key `kdnet.exe` generates is bound to the target NIC. After a NIC change / reinstall it must be generated again
- **Kernel debugging cannot pause every kernel thread**: after `g` the system is running, and a breakpoint stops only at the event moment — for a timing-class bug, substitute the `!analyze -v` or TTD (user-mode) approach
- **wow64 kernel debugging**: a 32-bit process's thread stack is at the x86 layer, and `!process` fields follow the bitness — when checking across bitness, confirm the process bitness first

## Exception / stack-scene pitfalls

- **The current context of a WER dump is not trustworthy**: a dump captured by Windows Error Reporting stops inside the `WerpReportFault` reporting path — a direct `k` shows the reporting code's stack. You must `.ecxr` to restore the exception context before `k` (`.exr -1` to look at the exception record first also works)
- **`.cxr` vs `.ecxr`**: `.cxr <addr>` specifies a CONTEXT address by hand. `.ecxr` takes the current exception context automatically — dump analysis uses `.ecxr`. A live scene uses `.exr` to get the address, then `.cxr`
- **When the stack is damaged, `k` is an illusion**: after the stack pointer is stomped, `k` prints scrambled addresses — restoring the scene with `.exr`/`.cxr` is the only reliable path. Take the scene address directly from `STACK_TEXT` in `!analyze -v`
- **`!analyze -v` is an aid, not the conclusion**: it gives FAULTING_IP/STACK_TEXT heuristically, and obfuscation / a rare scene can point at the wrong place — check `STACK_TEXT` frame by frame, and `.exr`/`k` by hand when needed

## TTD limits

- **Administrator privilege is required**: ttd.exe recording needs an administrator. Running without it fails silently or records no trace
- **User mode only**: it cannot record the kernel/a driver. A PPL-protected process cannot be injected for recording
- **Trace files are huge**: a few minutes can reach several GB (no upper bound) — limit with `-maxfile <MB>` or `-ring` (2GB ring overwrite). The `.idx` index is about twice the trace size
- **Replay is read-only**: you cannot write memory / change registers inside a trace — "verify a hypothesis" cannot be done during replay, only observation. To change something, record again or switch to ordinary debugging
- **Recording overhead is high**: the target slows noticeably during recording (several times). `-numvcpu` is adjustable. Some frameworks (Electron-class) may deadlock/crash while recording — if it will not record, fall back to ordinary breakpoint debugging
- **A `.run` file contains sensitive information**: the trace contains process memory / file paths / register values — sharing the trace is sharing the data. Redact it (the same principle as a [[re-malware]] report)

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]]). Attach / kernel debugging needs administrator privilege
- Version-dependent behavior (the extension-command set, UI entries) follows the version actually installed. The command window is the most stable interface across versions
