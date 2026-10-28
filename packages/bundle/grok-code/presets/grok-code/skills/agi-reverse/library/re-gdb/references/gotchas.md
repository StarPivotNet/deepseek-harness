# GDB tool-specific pitfalls and boundaries

## ptrace permission and sandbox pitfalls

- **yama ptrace_scope**: when `/proc/sys/kernel/yama/ptrace_scope` = 1 (the default), a non-parent attach is refused (`Operation not permitted`) — same owner does not help; `sudo sysctl -w kernel.yama.ptrace_scope=0` relaxes it temporarily (restored on reboot), or run the target as a child (`gdb ./target` rather than attach)
- **Container seccomp blocks ptrace**: attach inside docker/a sandbox often fails outright — do not force it; take the [[re-memdump]] dump route
- **Wine process attach**: a PE process under Wine is a Linux process and can be attached, but the address space mixes PE mappings with Wine structures — locate the PE image segment in `/proc/<pid>/maps` (base differs by wine version/bitness); handle anti-debug and the process model on the Linux side

## Breakpoint-mechanism pitfalls (a breakpoint that does not fire ≠ the code did not run)

- **Self-modifying code overwrites INT3**: a packer/self-decrypt rewrites the breakpoint byte at runtime — `x/i` to see whether the breakpoint site is still 0xCC; set the breakpoint again after decryption finishes
- **Memory remapped**: code moves to a new mapping (after `mmap`/`mprotect`), and the old address is dead — compare `info proc mappings` before and after
- **Exception-path jump**: the flow goes through exception handling (handler/SEH) and never hits the breakpoint instruction — break at the handler entry and watch the real direction
- **0xCC scan detection**: the sample scans breakpoint bytes / checksums the code segment and then diverts — find the scan site statically first (see the [[re-anti-analysis]] anti-debug methodology)

## Anti-debug countermeasure pitfalls

- **ptrace self-check**: a `ptrace(PTRACE_TRACEME)` return-value check — after breaking on the call return, `set $eax=0`; note that one ptrace session can attach only once; after gdb already holds it, the sample's own ptrace fails, and that itself is a detection point
- **rdtsc time delta**: single-step delay is measured — lower the single-step rate, use hardware breakpoints to reduce measured steps, or patch the compare site
- **Trap-flag (TF) detection**: `si` raises a mysterious SIGTRAP/`#DB`, or behavior jumps after a single step — statically find the check after `pushf`/`lahf` that inspects TF (see the SKILL.md pitfall)
- **Signals taken over by the sample**: changes such as `handle SIGTRAP nostop` need care — the sample may use the single-step exception itself for control flow
- **Timing / multi-thread races**: when the breakpoint hits changes behavior (setting a breakpoint while other threads keep running will miss) — `Ctrl+C`/`interrupt` to pause first, then set the breakpoint

## Environment and version pitfalls

- **PIE/ASLR address drift**: a no-symbol sample changes address every run — pin it with `set disable-randomization on`; when replaying a core, `info proc mappings` first to get the offset, then match decompiler addresses
- **pwndbg and gef conflict**: installing both = init scripts interfere, or the later install overwrites the earlier one; leftover Python errors are common — pick one; both gef and the legacy `./setup.sh` pwndbg write `~/.gdbinit`; clear the old file before switching; portable pwndbg uses a wrapper script and does not occupy `~/.gdbinit`
- **pwndbg dependency versions**: pwndbg depends on a newer gdb (Python 3 API); a distro gdb that is too old errors on install or load — check `gdb --version` first (for example Debian's old bundled gdb 10.x is incompatible with new pwndbg)
- **gdb version differences**: `catch syscall` needs Linux gdb (macOS lldb goes to [[re-lldb]]); `dump memory`/`gcore` behave the same across versions, but the default filename includes the pid
- **LD_PRELOAD / environment-injection traces**: a debugger-injected `LD_PRELOAD` can be detected — clean it with something like `unset env LD_PRELOAD`, then attach; if the sample itself depends on `LD_PRELOAD`, record the original value first

## Usage notes

- Dynamic execution defaults to a sandbox + network isolation ([[re-analyze/platform-tips]] highest principle); if attach fails, switch to [[re-memdump]]
- A modification affects only this run; after a persistent patch, recheck sha256 ([[re-triage]] / [[re-patching]])
- Write conclusions into [[re-analyze/analysis-contract]]; version-dependent behavior follows what the target environment actually does
