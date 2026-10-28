---
name: re-gdb
description: >
  GDB/pwndbg/gef debugging: attach, breakpoints, memory read/write.
  Triggers: gdb, `调试`, pwndbg, attach
capabilities: [debugging]
---

# GDB/pwndbg/gef dynamic debugging

## When to use / when not to use

- Use: dynamic debugging of a Linux target (attach/start/breakpoints/memory read-write); core-file analysis; debugging a PE process under Wine
- Do not use: a native Windows target (go to [[re-x64dbg]], or gdb inside Wine; see the [[re-analyze/platform-tips]] Linux branch); a macOS target (go to [[re-lldb]])
- Do not use: read-only memory with no debugging (prefer an existing dump; go to [[re-memdump]])

## Tool setup

See [[re-analyze/platform-tips]]: dynamic execution defaults to a sandbox; Wine-process attach experience on the Linux branch; the `direct read vs dump` decision — if attach fails, switch to [[re-memdump]].

### gdb

- Linux: `apt install gdb` / `dnf install gdb` / `pacman -S gdb`
- macOS: `brew install gdb` (needs a self-signed certificate; lldb is usually smoother)
- WSL: the Linux package works directly (attach across the Windows boundary is not possible; see the [[re-analyze/platform-tips]] WSL branch)
- Verify: `gdb --version`

### pwndbg / gef (pick one)

- pwndbg: official portable install script (main path on Linux/macOS):
   ```sh
   curl --proto '=https' --tlsv1.2 -LsSf 'https://install.pwndbg.re' | sh -s -- -t pwndbg-gdb
   ```
   For the LLDB build, change `-t` to `pwndbg-lldb`; Homebrew (`brew install pwndbg/tap/pwndbg-gdb`), Nix, and distro packages are alternatives. In-repo `git clone + ./setup.sh` is legacy/development use (it calls sudo internally and needs root) and is no longer the main path
- gef:
   ```sh
   curl -L https://github.com/hugsy/gef/raw/master/gef.py -o ~/.gdbinit
   ```
- Verify: entering gdb shows the pwndbg/gef banner
- Note: do not install both (hooks interfere); the pwndbg portable build loads through a wrapper script and does not write `~/.gdbinit`, which differs from gef's `~/.gdbinit` injection; versions roll quickly, and feature differences follow each official README (details in [[gotchas]])

### checksec (binary protection check)

- pwndbg has a built-in `checksec` command (available once pwndbg is installed)
- Or `pip install pwntools` → `pwn checksec --file ./target`
- Verify: `gdb -q -ex 'checksec' -ex quit ./target` prints NX/Canary/RELRO/PIE

## Procedure

1. **Check ptrace permission before attach**:
    ```sh
    cat /proc/sys/kernel/yama/ptrace_scope
    # 1 = 仅父进程可 attach（默认）；0 = 任意同属主；容器内常被强制禁止
    sudo sysctl -w kernel.yama.ptrace_scope=0   # 临时放宽（重启还原）
    ```
    ```sh
    gdb -q -p <pid>          # 同属主或 root；失败（Operation not permitted）→ 见坑 1
    ```
   Attach inside a sandbox container is often blocked by seccomp → go straight to a [[re-memdump]] dump.

2. **Breakpoints / single-step / conditional breakpoints**:
    ```
    (gdb) file ./target
    (gdb) b *0x401000          # 地址断点
    (gdb) b sym.check if argc == 2    # 条件断点
    (gdb) r arg1 arg2          # 运行并传参
    (gdb) ni / si              # 单步（跳过/进入调用）
    (gdb) c                    # 继续
    (gdb) info b               # 列出断点
    ```
   Dynamic-analysis command with arguments: `gdb -q -ex 'b main' -ex 'r' -ex 'x/10i $rip' ./target`
   - Data breakpoint: `watch *(int*)0x601000` (fires on write) / `rwatch` (fires on read) — find when a key is written / where decryption lands
   - Syscall breakpoint: `catch syscall openat` — map file/network behavior; pair with `commands ... end` to print arguments automatically and continue
   - Automate a breakpoint hit (do not change the execution flow; batch-verify arguments):
      ```
      (gdb) b check
      (gdb) commands
        silent
        printf "arg=%s\n", $rdi
        continue
      end
      ```

3. **Inspect / modify memory and registers**:
    ```
    (gdb) x/20wx $rsp          # 栈上 20 个 word
    (gdb) x/s 0x601000         # 字符串
    (gdb) p $rax               # 寄存器
    (gdb) set $rax = 0         # 改寄存器
    (gdb) set {int}0x601000 = 0x90909090   # 写内存（绕过校验）
    (gdb) find 0x400000, 0x410000, "flag{"  # 内存搜索字符串
    ```

4. **Anti-debug bypass**:
   - Change flags (common anti-debug check points):
      ```
      (gdb) p $eflags
      (gdb) set $eflags = $eflags | 0x100     # 置 TF 位
      ```
   - ptrace self-check: the return of `ptrace(PTRACE_TRACEME)` is checked → break at the call site and `set $eax = 0` (x86) to continue
   - Time-delta detection (rdtsc): first `p $rax` and record the delta of two calls; over the threshold it exits — break at the compare site and patch the compare register
   - The changes above affect only this run and do not change the file (a persistent patch means editing the binary and rechecking the hash)

5. **gcore dump (prefer an existing dump)**:
    ```
    (gdb) gcore out
    ```
   Or an external command: `gcore -o out <pid>` (ships with the gdb package; includes register/thread ELF notes)
   Per the [[re-analyze/platform-tips]] "direct read vs dump": prefer an existing dump; for unpacking, wait until OEP decryption before the dump; replay a core directly with `gdb ./target core` (`bt` for the crash stack, `info proc mappings` for mappings).

6. **Scripted batch (-x / python)**:
    ```
    gdb -q -batch -x script.gdb ./target      # 非交互跑完整脚本
    ```
   script.gdb may contain `commands ... end`, `define` custom commands, and embedded `python` (gdb's built-in Python interpreter; pwndbg/gef are built on it) — freeze repetitive analysis (batch-print call arguments, walk one path) into a reusable script; archive an interactive conclusion as a one-liner with `gdb -q -ex ... -ex quit`.

## Cross-domain joins
- [[re-address-space]]: base conversion (align info proc mappings with the link address)

- [[re-binary-core]]: workflow step 6 (Linux debugger)
- [[re-anti-analysis]]: unpack verification (break at OEP) and anti-debug bypass
- [[re-ctf]]: pwn debugging
- [[re-malware]]: dynamic observation of a Linux malicious sample
- Complements [[re-memdump]] (attach fails → dump)

## Common pitfalls

- **ptrace forbidden → dump fallback**: when yama ptrace_scope=1, a non-parent attach is refused; container seccomp kills attach outright — do not force it; switch to [[re-memdump]] per [[re-analyze/platform-tips]]
- **Anti-debug (ptrace self-check, time delta)**: the sample self-checks with `ptrace(PTRACE_TRACEME)` or detects a debugger with an rdtsc time delta — locate the check statically first, then breakpoint-patch it
- **Wine process attach**: a PE process under Wine is a Linux process, and gdb can attach, but the address space mixes PE mappings with Wine structures — handle it per the [[re-analyze/platform-tips]] Linux-branch experience (check `/proc/<pid>/maps` to locate the PE image segment)
- Debugger-injection traces (LD_PRELOAD/environment variables) can be detected — clean them with something like `unset env LD_PRELOAD`, then attach
- **Clock countermeasures fall into three classes**: Symptom — the sample detects abnormal time (wrong timing multiplier, abnormal single-step duration, unexpected clock source) and then exits or changes behavior; cause — clock countermeasures fall into three classes: time-multiplier detection / single-step delay detection / VM time-source detection; fix — classify first, then handle each: for a time-multiplier class, restore the real clock or patch the compare site; for a single-step delay class, use hardware breakpoints to reduce measured steps; for a VM time-source class, follow the environment-fingerprint approach in the [[re-analyze/platform-tips]] sandbox branch
- **A breakpoint that does not fire ≠ the code did not run**: Symptom — a breakpoint at the target address never fires, the path is misjudged as not taken, and key logic is skipped; cause — four mechanisms make "the breakpoint did not break" ≠ "the code did not run": self-modifying code (the int3 byte is overwritten or checksummed at runtime), memory remap (code moves to a new mapping and the old address dies), exception mechanism (the flow jumps through an exception-handler path and never hits the breakpoint instruction), anti-debug bypass (the sample scans for 0xCC / checksums code-segment bytes and then diverts); fix — triage the four classes first: `x/i` to see whether the breakpoint site is still int3 (self-modifying), compare `/proc/<pid>/maps` for mapping changes (remap), find the real jump target in the exception context (exception mechanism), statically find the 0xCC scan and segment-checksum site first (anti-debug), then decide to move the breakpoint / set a memory breakpoint / patch the check (see [[re-binary-core]] analysis methodology R17)
- **Single-step exception → check anti-debug (trap flag / exception handling)**: Symptom — `si` raises an unexpected SIGTRAP/`#DB`, or sample behavior jumps after a single step (the time-delta class is the "clock countermeasures fall into three classes" pitfall); cause — trap-flag detection (the sample reads the TF bit / uses the single-step exception itself) and exception-handler anti-debug (int3 is taken over by the sample's own handler, the SEH chain carries the flow jump, an exception is control flow); fix — rule out time detection first, then statically locate the TF check after `pushf`/`lahf` and the int3 write site, break at the handler entry to see the real direction, and patch the check or switch to a hardware breakpoint (see [[re-binary-core]] analysis methodology R18)
- The command cheat sheet (breakpoint/memory/script/pwndbg-gef command families) is in [[commands]]; tool-specific pitfalls and version differences are in [[gotchas]]
