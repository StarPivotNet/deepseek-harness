# strace / ltrace tool-specific pitfalls and boundaries

## Process tree and attach

- **Omitting -f drops children**: after fork/clone, every child behavior is lost — `-f` is standard. Daemonized targets (double-fork + setsid) depend on it especially
- **attach privilege and limits**: `-p` needs the same privilege as the target (ptrace privilege). Attaching a host process across a PID namespace (from inside a container) is refused outright. With `/proc/sys/kernel/yama/ptrace_scope=1`, a non-parent attach fails (set it to 0, or stay in the same session)
- **attach timing blind spot**: calls before attach are invisible — rerun registration/init logic in launch mode, or locate the breakpoint statically first ([[re-ida]] / [[re-binary-core]])
- **Multi-threaded targets**: `-f` implicitly traces every thread. Output is interleaved by thread. `-e trace-fds=` can narrow to an fd

## Output and filtering

- **Output size runs away**: an unfiltered gigabyte-scale log fills the disk — allow-list + `-o` file. When you only need the conclusion, summarize directly with `-c`
- **String truncation**: the default is 32 bytes — paths/URLs/crypto arguments get cut off. Start at `-s 200`
- **Wrong `-e trace=` category name**: a category or call name that does not exist reports "invalid system call" (strace parses the whole string as a call name) — use the documented categories file/process/network/signal/ipc/memory/desc/read/write
- **New kernel calls have no decode**: new syscalls on kernel 6.x+ show as raw numbers/names on an old strace — upgrade strace, or read the kernel headers to fill in the meaning

## Anti-debug confrontation

- **ptrace self-check conflict**: the sample runs ptrace(PTRACE_TRACEME) on itself or a child and conflicts with the debugger — strace hangs / produces no output / the sample exits immediately. Fix: locate the check statically ([[re-anti-analysis]]), or trace only the critical path
- **Injection-mechanism traces**: strace/ltrace injection can be enumerated from /proc/self/maps — a behavior jump after detection is normal. Do not treat polluted output as real
- **Timing is disturbed**: per-call overhead grows, and a timing check (self-timer/rdtsc) will misjudge — for a time-sensitive target, use Intel PT (`perf record -e intel_pt`) or lightweight BPF ([[re-ebpf]]) instead

## ltrace limits

- **PLT layer only**: library functions loaded after dlopen need an explicit `-l`. A statically linked program has no PLT — ltrace prints nothing; switch to strace
- **No debug symbols means argument meaning is unclear**: arguments show as registers / raw pointers — pair `-i` (instruction pointer) with disassembly to confirm meaning
- **Maintenance lags**: new glibc internal functions (for example malloc variants) may show as addresses rather than names — a few garbled names do not block the flow. Fill meaning with `-i` + disassembly

## macOS (dtruss) differences

- SIP limits: system-signed processes (most of /usr/bin and system daemons) are refused by dtruss, or the privilege fails — first verify the command on an ordinary user-mode program
- Needs root: `sudo dtruss`. Without the Xcode CLT there is no DTrace toolchain

## Version differences

- **strace 7.x (current mainline)**: seccomp-bpf is opt-in (since 5.3, enabled explicitly with `--seccomp-bpf`, incompatible with `-p` attach). From 6.4, specifying `--syscall-limit` automatically turns off the seccomp-bpf path
- **ltrace 0.8.x**: long-term small-step maintenance; options are stable (-e/-l/-S/-c/-i/-w). Differences from 0.7.x are mainly output-format details
- **Distro packaging differences**: the RHEL family tends to be old (strace 5.x is common, without 6.x options) — when a new option does not exist, follow this machine's help
- **Kernel-side config matters**: Yama ptrace_scope and seccomp policy affect attach and tracing — if behavior is strange, check the kernel config first

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]])
- Trace logs are evidence: archive path + sha256 + timestamp ([[re-triage]]). Write the conclusion in [[re-analyze/analysis-contract]]
