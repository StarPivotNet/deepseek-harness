---
name: re-tracing
description: >
  System-call / function-call tracing: strace/ltrace/dtruss.
  Triggers: strace, `跟踪系统调用`, ltrace, `API监控`
capabilities: [tracing]
---

# System-call / function-call tracing

## When to use / when not to use

- Use: observe runtime behavior (file/network/process operations); record system-call and library-call sequences as evidence; locate dynamically resolved APIs (after GetProcAddress/dlopen)
- Do not use: you only need memory contents (use [[re-memdump]]); you only need static logic (a decompiler skill)
- Do not use: a Windows target uses APIMonitor/ProcMon (this skill is mainly Linux/macOS)

## Tool setup

Follow the top rule in [[re-analyze/platform-tips]] — tracing is dynamic execution. Default to a sandbox, with network isolation.

### strace (Linux)

- Debian/Ubuntu: `apt install strace`
- Fedora/RHEL: `dnf install strace`
- Arch: `pacman -S strace`
- WSL: the Linux package works directly
- Verify: `strace -V`
- Common options: `-f` follows children, `-o` writes a file, `-e trace=` filters, `-s 200` enlarges string display (default 32 bytes), `-x` turns non-ASCII into hex, `-y`/`-yy` resolve an fd to a path, `-c` prints a summary, `-p` attaches — cheat sheet and combinations are in [[commands]]

### ltrace (Linux library calls)

- Debian/Ubuntu: `apt install ltrace`
- Fedora/RHEL: `dnf install ltrace`
- Arch: `pacman -S ltrace`
- Verify: `ltrace -V`

### dtruss (macOS, DTrace version of strace)

- Built into macOS (with the Xcode CLT); needs root, and some SIP scenes are restricted
- Verify: `sudo dtruss -c ls / 2>&1 | head` prints deduplicated call statistics

### APIMonitor / ProcMon (Windows)

- APIMonitor: download the zip from rohitab.com and unzip; it runs as-is
- ProcMon: Microsoft Sysinternals — `choco install sysinternals` (or download from the official site)
- Verify: opening APIMonitor/ProcMon can list and attach to a process

## Steps

1. **strace -f, full process tree**:
   ```sh
   strace -f -o trace.log ./target args
   ```
   `-f` is required: it follows fork/vfork/clone children. Without it, every child behavior is missed.
   `-tt` adds microsecond timestamps. `-T` adds per-call duration (network wait / slow-call leads). `-s 200` enlarges string display (default 32 bytes; required when paths/arguments are cut off).
   An already-running target uses attach (calls before attach are invisible):
   ```sh
   sudo strace -f -p <pid> -o attach.log     # attach needs the same privilege as the target
   strace -f -c ./target                      # on exit, print syscall counts/time summary (hotspot location)
   ```

2. **Filter (-e trace=...)**:
   ```sh
   strace -f -e trace=network,file ./target     # network and files only
   strace -f -e trace=write,read ./target       # read and write only
   strace -f -e trace=execve,fork,clone ./target # process behavior only
   strace -f -e trace=!futex ./target           # drop noise (futex is high frequency)
   ```
   Filter allow-list first, deny-list second, to control output size (see pitfall 2).

3. **ltrace library calls**:
   ```sh
   ltrace -f -o lib.log ./target
   ltrace -e malloc+free ./target        # trace only the named library functions
   ltrace -l /path/libfoo.so ./target    # trace a library loaded by dlopen
   ltrace -f -S ./target                 # library calls and system calls together
   ltrace -f -c ./target                 # library-call summary on exit
   ```
   A dynamically resolved API (a function obtained by `dlsym`) does not appear in the static IAT, but it does appear in ltrace output — complementary to [[re-imports]].

4. **Save output as evidence**:
   ```sh
   strace -f -tt -o evidence/trace-$(date +%s).log ./target
   # or
   ltrace -f -o evidence/libcall.log ./target
   ```
   Every record carries pid and a timestamp. After analysis, cite the file path and hash in the notes (store sha256 for both the sample and the log; see [[re-triage]]).

5. **Windows uses APIMonitor/ProcMon**:
   - APIMonitor: run (as administrator) → select the target process → check the API classes to monitor (File/Network/Registry/Process) → attach, and watch call arguments and return values
   - ProcMon: whole-system (file/registry/network/process events). Filter by process first (Process Name equals the target name), then filter by Operation
   - Suspicious point: a consecutive injection-class API sequence (OpenProcess→VirtualAllocEx→WriteProcessMemory→CreateRemoteThread) is malicious-behavior evidence

## Instruction-level tracing

One level deeper than system calls — instruction-granularity execution flow:

- **QEMU plugin**: `-plugin` loads an instruction-level trace plugin (insn granularity, call/ret paths, guest code-block events). Use — recover the real path after unpacking, and deobfuscate (static obfuscation cannot hide actual execution)
- **Intel PT**: hardware trace (`perf record -e intel_pt`) → decode (`perf script` or a third-party parser) → restore the branch flow. Use — a complete execution path with no instrumentation overhead
- **trace analysis**: hotspots (sort by execution count), path recovery (rebuild the call chain), and handoff to [[re-deobfuscate]] (filter dead code by the real path)
- **Output**: an instruction-level execution-flow summary (for evidence archive in [[re-analyze/analysis-contract]])

## Related skills

- [[re-binary-core]]: workflow step 6 (behavior tracing)
- [[re-malware]]: malicious-behavior observation (callback / persistence / autorun)
- [[re-cracking]]: watch API call arguments related to checks / registration
- Complementary to [[re-imports]] (dynamically resolved APIs). When anti-debug is found, switch to [[re-anti-analysis]]
- [[re-ebpf]]: BPF observation / trace forensic recovery — skb/kernel paths that strace does not cover are complemented by BPF observation

## Pitfalls

- **Omitting -f drops children**: after the target forks, the parent exits/execs, and every untraced child behavior is lost — `-f` is standard
- **Huge output**: without a filter, a large program's log can reach gigabytes and fill the disk — allow-list with `-e trace=` first, and write `-o` to a file instead of the terminal when needed
- **Anti-debug samples detect the trace environment**: `ptrace` state checks / `LD_PRELOAD` traces expose strace/ltrace — combine with the anti-debug bypass in [[re-anti-analysis]]
- ltrace traces only PLT-layer calls by default — library functions loaded after `dlopen` need an explicit `-l`
- Command-family cheat sheet and operation sequences are in [[commands]]. Tool-specific pitfalls and version differences are in [[gotchas]]
