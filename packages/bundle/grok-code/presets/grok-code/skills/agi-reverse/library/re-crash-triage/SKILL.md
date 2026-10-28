---
name: re-crash-triage
description: >
  Crash/vulnerability sample analysis: deterministic reproduction, ASAN/UBSAN report reading, input minimization
  (afl-tmin/cmin), gdb backtrace location, rr record-and-replay, PoC output.
  Triggers: `崩溃`, crash, ASAN, UBSAN, `未定义行为`, UAF, `堆溢出`, `越界`, `段错误`, segfault,
  core dump, PoC, `漏洞分析`, `崩溃分析`.
capabilities: [debugging]
---

# Crash analysis and vulnerability location (crash triage)

## When to use / when not to use

- Use: fuzz produced a crashing input; the program segfaults/aborts; you need to decide whether the crash is a real vulnerability (reachability) and produce a minimal PoC; a multi-threaded/non-deterministic crash needs reproduction
- Do not use: there is no crash yet and you want to find bugs actively (→ [[re-fuzzing]]); the crash is already located and you need to dig into function logic (→ the [[re-binary-core]] base)
- Do not use: you only need to see a symbol stack ([[re-gdb]] alone also works, but this skill contains the full "reproduce → minimize → locate → PoC" flow)

## Tool preparation

Verify every tool before use. Reproducing a crash is dynamic execution and runs inside the sandbox by default ([[re-analyze/platform-tips]] supreme rule; see [[re-sandbox]]).

### ASAN / UBSAN — memory and undefined-behavior detection (built into clang/gcc)

- clang: `sudo apt install clang` / `sudo dnf install clang` / `sudo pacman -S clang` / macOS Xcode includes it
- gcc: Debian/Ubuntu `sudo apt install gcc` (ASAN is built into gcc; there is no separate package); Fedora `sudo dnf install gcc`; Arch `sudo pacman -S gcc`
- Compile: `gcc -fsanitize=address,undefined -g -fno-omit-frame-pointer -o target_asan target.c` (clang arguments are the same)
- Verify: write a small out-of-bounds array program, compile and run it, and confirm the output contains the text `AddressSanitizer`

### gdb — backtrace and core analysis

- Debian/Ubuntu: `sudo apt install gdb`
- Fedora/RHEL: `sudo dnf install gdb`
- Arch: `sudo pacman -S gdb`
- macOS: `brew install gdb` (needs a codesign entitlement); Xcode's lldb also works (see [[re-lldb]])
- Windows: the Linux build inside WSL; on native Windows use WinDbg ([[re-windbg]])
- Verify: `gdb --version`

### rr — record/replay (non-deterministic crashes)

- Debian/Ubuntu: `sudo apt install rr` (the universe repo)
- Fedora/RHEL: `sudo dnf install rr`
- Arch: `paru -S rr` (an AUR package; the official repo has no rr)
- macOS: not supported (rr supports Linux only; the official wording is "Apple hardware is fine, Apple software is not"); Apple Silicon users use Asahi Linux or a Linux VM (needs PMU passthrough)
- Windows: the Linux build inside WSL2
- Build from source:
  ```sh
  git clone https://github.com/rr-debugger/rr && mkdir rr/obj && cd rr/obj
  cmake -DCMAKE_BUILD_TYPE=Release ../rr && make -j$(nproc) && sudo make install
  ```
- Prerequisite: Linux kernel 3.11+ (4.7+ recommended); when `perf_event_paranoid` > 1 it is extremely slow, so open it first:
  ```sh
  sudo sysctl kernel.perf_event_paranoid=1
  ```
- Inside a VM you need PMU passthrough (VMware/KVM can; VirtualBox cannot)
- **Self-check a container/restricted environment first**: `rr check` checks PMU/`perf_event` availability and known limits; use it only after that passes; rr cannot record in nested virtualization or in a container whose PMU was not passed through
- **Fallback when the PMU is unavailable** (do not get stuck on rr): switch to "rerun the same input several times + logs/conditional breakpoints" to shrink the race window; for a data-race class of problem, locate it with `valgrind --tool=helgrind` or a `-fsanitize=thread` build; pure ASLR jitter can be ruled out first with `set disable-randomization on`
- Verify: `rr --version`

### afl-tmin / afl-cmin — input minimization and dedup (installed with AFL++)

- Install: see the AFL++ section of [[re-fuzzing]] (`afl-tmin` / `afl-cmin` install with the package)
- **Prerequisite (`afl-cmin` especially)**: `afl-cmin` needs the target to be observable by AFL — it usually must be built with AFL instrumentation (`afl-clang-fast` / `afl-gcc`), or it fails with "no instrumentation / not instrumented". `afl-tmin`'s constraint is much weaker (it can work on a pure crash criterion), and an uninstrumented target can usually still run
- **A common miss**: when the target is a standalone ASAN build (`gcc -fsanitize=address -g`) and did **not** go through `afl-clang-fast`, `afl-cmin` is not guaranteed to run. Confirm the build method first; when it is not an AFL compiler output, switch to minimizing one by one with `afl-tmin`, or go back to [[re-fuzzing]] and rebuild an instrumented version
- Verify: `afl-tmin -h` / `afl-cmin -h`

## Procedure

Run in order; archive the crashing input and the PoC by sha256 first (the [[re-triage]] method).

1. **Deterministic reproduction**:
   ```sh
   sha256sum crash_input > crash_input.sha256
   ./target < crash_input          # stdin input
   ./target crash_input            # file input
   ./target -f crash_input         # follow the target's actual argument form
   ```
   - Crashing on 3 runs in a row = a deterministic crash; continue to step 2; crashing sometimes and not others = non-deterministic (multi-thread / uninitialized / ASLR); jump to step 4 and use rr
   - Enable core dumps (leave a core after the crash for analysis): `ulimit -c unlimited`; if `cat /proc/sys/kernel/core_pattern` points at systemd-coredump/apport, the system takes the core (see pitfall 4)
2. **Read the ASAN report** (the target must be built with `-fsanitize=address -g -fno-omit-frame-pointer`; see tool preparation):
   - `heap-buffer-overflow` / `stack-buffer-overflow` / `global-buffer-overflow`: an out-of-bounds read/write — the report contains the direction (`READ of size N` / `WRITE of size N`) and the out-of-bounds offset
   - `heap-use-after-free`: UAF — look at the `freed by` and `allocated by` stacks, and find the free point and the reuse point
   - `attempting double-free`: a double free
   - `SEGV`: a null/wild pointer access; the detail needs gdb (step 4)
   - The key point: frame `#0` is the crash point; **do not look only at the line number** — combine it with data flow to judge which input byte caused it
3. **Minimize the input**:
   ```sh
   afl-tmin -i crash_input -o crash.min -- ./target @@
   # dedup several crashing inputs by path first (needs AFL instrumentation; see tool preparation):
   afl-cmin -i crashes_dir -o minimized -- ./target @@
   ```
   - **`@@` applies only to a "file argument" target** (AFL replaces `@@` with the input-file path). When the target reads **stdin**, do not use `@@`; add the "file → stdin" step on the command line, for example:
     ```sh
     afl-tmin -i crash_input -o crash.min -- sh -c './target < "$1"' _ @@
     ```
     or, when the target has its own file argument such as `-f <file>`, use that instead of `@@`; pick the spelling from the real input form confirmed in step 1
   - afl-tmin produces the shortest input that still crashes; you can also delete head/tail bytes by hand to verify (binary-search the minimum boundary)
   - The minimized input is the PoC draft; keeping the same crash type = the criterion that it is the same bug
4. **Locate it with a gdb backtrace**:
   ```sh
   gdb -q ./target
   (gdb) set disable-randomization on     # turn ASLR off so addresses can be compared
   (gdb) run crash.min
   (gdb) bt                                # full backtrace
   (gdb) info registers                    # registers at the crash point
   (gdb) x/16i $pc                         # disassembly at the crash point
   ```
   - Core-file analysis: `gdb -q ./target /path/to/core`
   - `bt` is all `??` (no symbols): record the module base + offset, and decompile in [[re-ghidra]] / [[re-ida]] to fill the frames (see pitfall 5)
   - A non-deterministic crash → rr record and replay:
     ```sh
     rr record ./target crash_input
     rr replay                            # open a gdb session
     (rr) continue                         # run back to the crash point
     (rr) bt
     (rr) reverse-continue                 # execute backward before the crash to find the root cause
     ```
5. **PoC / report**:
   - PoC: `crash.min` + sha256 + the reproduction command (environment: ASAN build arguments, run arguments, input channel)
   - Report points: crash type (ASAN category), crash-point function/line/offset, data flow (which input byte → the out-of-bounds index), root cause (a missing length check / an unverified index / use after free), **reachability** (see pitfall 3: the crash path is really reachable and the input is controllable), impact assessment (out-of-bounds read → information leak, out-of-bounds write → RCE, a pure crash → DoS), fix suggestion
   - Output: the PoC hash and crash features can enter [[re-ioc]]

## Cross-domain joins

- [[re-vuln]]: step 3 of this gateway's workflow always calls this skill (crash analysis is the core step of the vulnerability-discovery chain)
- [[re-fuzzing]]: its crash output (`out/crashes/`) is handed to this skill for analysis (this skill also uses its afl-tmin/cmin toolchain in reverse)
- [[re-binary-core]]: after location, filling symbols / reading function logic goes through the base ([[re-ghidra]] / [[re-ida]] / [[re-radare2]]); [[re-triage]] provides the archive method
- [[re-memdump]]: when the process is already dead / an existing core file needs more context, dump and analyze (crash core → memdump)
- [[re-sandbox]] / [[re-analyze/platform-tips]]: reproduction is dynamic execution and runs inside the sandbox by default

## Common pitfalls

- **A non-deterministic crash (multi-thread)**: symptom — the same input crashes 3 times out of 10, and a gdb rerun cannot reproduce it; cause — a thread race / uninitialized memory / an ASLR address difference; fix — rr record (`rr record ./target input`) stops automatically at the crash point, and `rr replay` + `reverse-continue` locates the root cause backward; first `set disable-randomization on` to rule out the ASLR factor
- **ASAN vs optimization differences**: symptom — it crashes under ASAN (-O0/-O1) but not in release (-O2), or the reverse and only release crashes; cause — optimization changes memory layout/timing and hides or exposes undefined behavior; fix — try both builds; add `-fsanitize=undefined` to catch UB; impact and reachability judgments follow real release behavior (what ASAN reports is a potential vulnerability and must be confirmed)
- **A crash ≠ a vulnerability (reachability)**: symptom — ASAN reports an out-of-bounds access but it is in dead code / an unreachable branch, or the crash was introduced by the harness; cause — an input the fuzzer triggered does not necessarily correspond to a real attack surface; fix — a gdb backtrace + decompile confirms the crash path is reachable and the input is controllable; distinguish a harness bug from a target bug (step 4 of the [[re-vuln]] workflow is the fallback confirmation)
- **The system takes the core**: symptom — after `ulimit -c unlimited` a crash still leaves no core file; cause — `core_pattern` points at systemd-coredump (a pipe) / apport intercepts it; fix — first `cat /proc/sys/kernel/core_pattern` to confirm where it lands, then retrieve it from that place:
  - `core_pattern` looks like `|/usr/lib/systemd/systemd-coredump ...`: systemd has already taken the core; **do not rush to change the global setting**; just use it — `coredumpctl list` finds the entry (by executable name/time), `coredumpctl info <PID|executable name>` shows metadata, `coredumpctl dump <PID> -o core` exports it, or `coredumpctl gdb <PID>` enters gdb directly. This is more complete than changing `core_pattern`, and it does not affect other programs' core behavior on the system
  - apport takes it (Ubuntu): the core lands in `/var/crash/`; expand it with `apport-unpack`
  - Change it temporarily only when you really need a raw core file: `sudo sysctl kernel.core_pattern=core` (the core lands in the process working directory; note it applies only to processes started afterward)
  - Fallback: `gdb --args ./target crash.min` runs it directly and does not depend on a core file
- **Missing symbols**: symptom — `bt` is all `??` and addresses do not line up; cause — strip / static linking / the binary and the core are different versions; fix — the core and the binary must be the same version (compare sha256); record the crashing module's base and offset, locate the function by offset in [[re-ghidra]] / [[re-ida]], and convert back to the gdb address
