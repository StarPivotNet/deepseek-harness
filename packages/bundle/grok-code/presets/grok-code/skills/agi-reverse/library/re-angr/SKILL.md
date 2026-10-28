---
name: re-angr
description: angr symbolic execution: symbolic inputs, solving. Triggers: angr, `符号执行`, `自动解题`, constraint
capabilities: [symbolic-execution]
---

# angr symbolic execution (symbolic input / automatic solving)

## When to use / when not to use

- Use: a CTF reversing challenge — the input is checked byte by byte inside a long loop / a deep comparison chain (the pass address is known or can be located), and reversing it by hand is tedious and error-prone
- Use: you know "the input must reach some address / avoid some address" and want to hand the path condition to a solver (find / avoid mode)
- Use: the input source is complex (argv / file / standard input) and you need to symbolize it per channel, then solve
- Do not use: a simple XOR / plaintext compare (within one screen of pseudocode) — by hand is faster ([[re-binary-core]])
- Do not use: the check contains content that cannot be symbolized (environment-dependent values, random numbers, unsybolized input) — you get no solution or a wrong one (see pitfall 3)
- Do not use: you need a precise constraint set rather than one path — pure constraint solving is lighter with [[re-z3]] (see pitfall 2)
- Note: symbolic execution is a double-edged sword — first locate the key check function by hand and shrink the symbolic range (see pitfall 2); runtime verification goes through the sandbox ([[re-analyze/platform-tips]] supreme rule)

## Tool preparation

See the [[re-analyze/platform-tips]] supreme rule — running the target to verify a solved result defaults to the sandbox; angr itself is an in-process emulator and does not touch real syscalls, so the solve itself needs no sandbox.

### angr (pip install)

- `pip install angr` (Linux / macOS / Windows all work; on Windows pip installs a win32 wheel, and installing the Linux build inside WSL also works)
- **Python version compatibility (important)**: **angr 9.3.0 and later require Python 3.12+** (`requires-python >=3.12`; the current 10.x mainline is the same); **9.2.x is not a fixed range** — the floor rises with patch versions (9.2.91 requires ≥3.8, 9.2.203 already requires ≥3.10), so you cannot judge the whole "9.2.x" line. Before install, use the target version's PyPI `requires-python` (`pip index versions angr` lists available versions), then pick by the system Python:
  - System Python is already 3.12+ (Ubuntu 24.04 defaults to 3.12) → `pip install angr` directly (current mainline 10.x; Python >=3.12)
  - System Python is 3.11 or below → `pip install "angr<9.3"` (the 9.2.x line); **do not force-install 9.3+**
  - When several versions coexist, isolate with a venv: `python3.12 -m venv ~/venvs/angr && source ~/venvs/angr/bin/activate` (or `brew install python@3.12` / `py -3.12 -m venv angr-venv`)
- Upgrade the base tools first: `pip install --upgrade pip setuptools wheel` (avoids native-component compile failures)
- On Linux, also install `binutils` (angr calls objcopy when it processes / rewrites a binary): `apt install binutils`
- Verify: `python3 -c "import angr; print(angr.__version__)"`

### python3

- Linux: `apt install python3` (usually present); macOS: `brew install python`; Windows: the official installer / `choco install python`
- Verify: `python3 --version`

### Target binary

- A copy of the original sample (**back it up first**: symbolic execution does not modify the file, but modeling needs repeated comparison; see pitfall 5) + the [[re-triage]] survey artifacts (architecture / bitness / statically linked or not / packed or not)
- Verify: `file target` confirms architecture and bitness (angr supports arm targets; watch endianness)

## Procedure

Run in order and record each step (addresses / constraints / solve script / flag; evidence paths in [[re-triage]]). **Manual first, then automation**: a smaller symbolic range is more stable (see pitfall 2).

1. **Input adapter (Input Adapter): determine the symbol source**:
   - Locate the input-read site in the decompiler: uses of `read` / `scanf` / `fgets` / `getline` / `main(int argc, char **argv)` argv ([[re-ghidra]] / [[re-ida]] / [[re-radare2]])
   - Pick the attachment by **symbol-source type** (CTF stdin is only one of them — a real target's input may be a network packet / a file mapping / a JNI argument / custom bytecode):

     | Symbol source | How to attach |
     |---|---|
     | stdin (standard input) | `project.factory.full_init_state(stdin=claripy.BVS('in', 32*8))` |
     | argv (command-line arguments) | `project.factory.full_init_state(args=["./target", claripy.BVS("arg1", 64*8)])` |
     | file (file input) | `state.fs.insert('/tmp/in', angr.SimFile('in', content=claripy.BVS('in', 32*8)))` — symbolic after fopen; fd operations use `state.posix.fd[0]` (fd 0=stdin; fd 1/2 are stdout/stderr — do not mix them) |
     | memory (mmap/heap/global buffer) | Symbolize the target memory region directly: `state.memory.store(addr, claripy.BVS('buf', n*8))` — a read from that address is symbolic (generic for an mmap file, a decrypt buffer, shared memory) |
     | network buffer (packet/recv) | Hook `recv`/`read`: **take the buf argument per the calling convention** (x86-64 SysV is RSI=buf, RDX=len), write symbolic bytes at that address, and **the return value is an ssize_t byte count, not a buffer pointer** — return a symbolic length so control flow such as `if (recv(...) > 0)` can vary. Implementing it as "return a symbolic pointer" bends all later control flow |
     | jni argument (Android native input) | Symbolize `JNIEnv` method arguments: symbolize at the return of `GetByteArrayElements`/`GetStringUTFChars` (confirm the argument shape with [[re-android-native]]/[[re-frida]]) |
     | custom VM bytecode (custom VM instruction stream) | Symbolize the whole bytecode buffer + constrain the opcode range (the 0x00-0x0F class) — the symbolic-execution path for VM reversing (join with [[re-deobfuscate]]) |

   - Record: symbolic channel + byte count + read-site address (used later by find / hook); confirm the N-byte length against the read-site logic (see pitfall 3)

2. **Model reaching a target address / avoiding an address (find / avoid)**:
   - In the decompiler, confirm the **success-path address** (the address that prints the flag after the check passes) and the **failure-path addresses** (places that print "wrong" and similar; list every failure point)
   - Model: `simgr.explore(find=<entry address>, avoid=[<failure-branch address>])` (find may be several addresses, or a lambda `lambda s: b"flag{" in s.posix.dumps(0)`)
   - Trick for choosing the find address: pick the **check-loop exit**, not program exit — a state that "passed the success branch of the check" is enough; you do not have to wait for the print (see pitfall 5)
   - If the check is decided by a function return (`if (check(input))`) → set find on the success-branch address after check returns, and avoid on the failure branch

3. **Path constraints and solving (solver)**:
   - After a state is found, the constraints are the conditions accumulated on that state's path: `found = simgr.found[0]`
   - Solve: evaluate the symbolic variable directly (does not depend on the posix plugin): `flag = found.solver.eval(inp, cast_to=bytes)` (inp is the stdin/argv symbol created in step 1), or evaluate by symbolic-variable name: `found.solver.eval(flag_sym, cast_to=bytes)`
   - When there are multiple solutions, add constraints as needed (length / printable characters; see pitfall 4):
     ```python
     for c in flag_sym.chop(8): found.solver.add(0x20 <= c, c <= 0x7e)
     ```
   - Write to a file: `open('flag.bin','wb').write(flag)`, and also print repr to inspect it (non-printable characters are often a symbolic-length problem; see pitfall 3)

4. **Respond to path explosion (hook / depth limit / stages)**:
   - **Hook unrelated calls**: replace heavy / system calls that are unrelated to the check with a light procedure:
     ```python
     project.hook(addr_of_sleep_or_memset_impl, angr.SIM_PROCEDURES["stubs"]["ReturnUnconstrained"]())
     ```
     Prefer angr's built-in `angr.SIM_PROCEDURES` library (`libc.sleep`, `linux_kernel`, and others): `project.hook_symbol("sleep", angr.SIM_PROCEDURES["libc"]["sleep"])` (sleep is in the libc category, not posix)
   - **Limit exploration scale**: `simgr = proj.factory.simgr(state, veritesting=True)` (veritesting merges paths; common on long-loop challenges; see pitfall 2); `simgr.explore(find=..., avoid=..., num_find=1)` stops when found; control with a `stash` cap / the `lazy_solves` option
   - **Staged exploration**: for a long loop, hook the entry address, explore to the loop boundary first, then symbolically unroll the loop body alone (locate the loop invariant by hand, then shrink the range)
   - Still exploding → go back to step 1 and shrink the symbolic range / combine with manual analysis (see pitfall 2), or switch to [[re-z3]] and model the already-unrolled loop body

5. **Typical template (find / avoid mode)**:
   ```python
   import angr, claripy
   p = angr.Project("./target", auto_load_libs=False)   # disable library load: faster and more stable
   inp = claripy.BVS("inp", 32 * 8)                      # 32 bytes of symbolic input
   state = p.factory.full_init_state(stdin=inp)
   simgr = p.factory.simgr(state, veritesting=True)
   simgr.explore(find=0x401100, avoid=[0x401200, 0x401300])   # illustrative addresses: replace with the target's real entry/branches
   if simgr.found:
       sol = simgr.found[0].solver.eval(inp, cast_to=bytes)
       print(sol)                                        # save directly into the evidence directory
   else:
       print("no path found")                            # troubleshoot: wrong address / input length / not symbolized
   ```
   - Parameterize the template: write `find` / `avoid` / input length / symbolic channel in a header comment and vary one parameter at a time (see pitfall 5)

**Verify**: inside the sandbox ([[re-sandbox]]), run the target with the solved input as-is (stdin redirect `./target < flag.bin`, or the argv / file channel); it must print `flag{...}`; cross-check against [[re-z3]] / a manual recovery (see pitfall 4).

## Cross-domain joins
- [[re-address-space]]: align mapped_base/rebase with the target address

- [[re-ctf]]: this skill is the automated-solving path of re-ctf gateway workflow step 3 (byte-by-byte long-loop check challenges)
- [[re-binary-core]]: the workbench in front — decompile to locate the input-read site / success and failure branch addresses ([[re-ghidra]] / [[re-ida]] / [[re-radare2]]); [[re-triage]] survey decides architecture / bitness / packer
- [[re-deobfuscate]]: recover obfuscation before symbolic execution (junk instructions / a flattened function explode paths if executed symbolically as-is)
- [[re-z3]]: sister skill — a constraint set with no loop / already unrolled by hand is lighter and faster in z3; when angr is slow, move a constraint subset to z3
- [[re-crypto-decrypt]]: its "tool preparation" lists angr as an optional decrypt-emulation option (symbolically execute the decrypt function when algorithm recovery fails)
- [[re-sandbox]]: sandbox for running a solved input ([[re-analyze/platform-tips]] supreme rule)
- [[re-gdb]] / [[re-tracing]]: dynamic cross-check (a breakpoint shows the real check-branch direction, compared with the angr path conclusion)

## Common pitfalls

- **Path explosion**: symptom — `explore` runs for more than ten minutes, the state count soars, and memory fills up; cause — the symbolic range is too large (the whole program is symbolic), unrelated branches (strlen / memcpy unrolling, error-handling branches) are explored one by one, and a long loop is not merged; fix — hook unrelated syscalls (step 4), `veritesting=True` to merge paths, `num_find=1` to stop when found, shrink the symbolic input range (step 1 symbolizes only the bytes the check actually reads); if that still fails, explore in stages or switch to manual analysis
- **A complex check is slow → combine with manual analysis**: symptom — a challenge that looks simple produces no angr result for several minutes; cause — the check chain contains a table lookup / a random number / a syscall side effect, and symbolic execution is inefficient at those points; fix — decompile by hand first and locate the **key check function**, set the symbolic entry at the check-function entry (`blank_state` + set registers / memory by hand), and skip the unrelated code in front; when the check is a pure set of equations, switch directly to [[re-z3]]
- **Unsymbolized input → no solution**: symptom — `explore` returns `no path found` in seconds, or the solved value fails on the original program; cause — the input was not symbolized (the read is real stdin / file contents), the symbolic byte count is less than the length actually read (`fgets(buf, 0x40)` but only 16 bytes were symbolized), or the input contains a quantity that is fixed only at runtime (a random number / a timestamp); fix — confirm the read site and length against the decompiler (step 1), and symbolize stdin length up to the read cap; at a random-value point, pin it with a hook (`hook_symbol("rand", ...)`) and then symbolize
- **Python version compatibility**: symptom — `pip install angr` reports a compile error / import crashes immediately (`ImportError` pointing at a C extension); cause — angr 9.3.0+ officially requires Python 3.12+, and the 9.2.x floor rises with patch versions (9.2.91 requires ≥3.8, 9.2.203 already requires ≥3.10); installing a new release on an interpreter that is too old (or an old dependency with no wheel on 3.13) compiles on the spot and may fail; fix — look up the **target version's** Python requirement (PyPI `requires-python`): 9.3+ uses 3.12+, and 9.2 picks an interpreter from that patch's metadata; install in a separate venv (tool-preparation section); before install, `pip install --upgrade pip setuptools wheel`
- **Wrong find address → the solved "flag" does not run**: symptom — the solve succeeds but the output contains non-printable characters / the program does not print the flag; cause — find was set inside an error-handling loop (failure also passes through it), only one of several failure points was avoided, or the symbolic length does not match what the program reads; fix — pick the **check-loop exit** for find (confirm the unique success path in the decompiler) and list every failure branch in avoid; `repr()` the output before replaying it as-is (see step 3 verification); take several solutions and run each against the target
- **PIE base offset → the find address is filled in wrong**: symptom — find is filled with the address Ghidra displays (for example `0x00101231`) and angr never finds it; cause — for a PIE binary Ghidra displays base 0x100000 and angr loads from 0x400000; fix — convert the address (a fixed offset such as a difference of 0x300000), or first check the module's actual load base inside angr and then set the find address; comment the conversion at the top of the script
- **Direct symbolic execution is inefficient on a custom VM / heavy obfuscation**: symptom — the check is wrapped in a custom bytecode VM (Tigress and similar), angr state-explodes / the solve produces nothing; cause — the VM dispatch loop is repeatedly symbolized + obfuscated path branches (eliminate opaque predicates first; see [[re-deobfuscate]]); fix — instantiate VM handlers with Unicorn emulation (angr only owns the outer control flow), or after exploring to a dead path export each path's SMT equations to [[re-z3]] to generate input (a Tigress case reached 100% branch coverage)
- **Inaccurate SimProcedure summaries → bizarre results**: symptom — `explore` results clearly violate intuition (wrong return, a check bypassed), or the same logic run a different way disagrees; cause — angr replaces library functions with Python summaries (SimProcedure) to avoid path explosion (strlen/malloc and others), but the summaries have bugs or are incomplete; fix — when behavior is abnormal, suspect SimProcedure first: disable that summary (note that loose input constraints may then explode paths) or customize the summary with `project.hook` for the actual case (for example a hand-written scanf hook for a single format string)
- **Missing divide-by-zero constraint → solved junk such as 4294967295**: symptom — the solved input contains values such as `0xFFFFFFFF` and always crashes the original program; cause — Z3 evaluates `a/b` (denominator 0) as all ones (4294967295); angr intercepts divide-by-zero only on some paths (the VEX-side exit), and SimProcedure / custom analysis code can let it through; fix — for a symbolic expression that divides, add an explicit "denominator nonzero" constraint; do not rely on angr to handle it automatically
- **Uninitialized registers/memory are automatically symbolized → the solve space is bloated**: symptom — the solve is extremely slow or the result contains garbage, and the log has unconstrained warnings; cause — `entry_state` creates unconstrained symbolic variables for uninitialized registers/memory and symbolizes unrelated state too; fix — set state options from the warning: `ZERO_FILL_UNCONSTRAINED_MEMORY`/`ZERO_FILL_UNCONSTRAINED_REGISTERS` (or `SYMBOL_FILL_*` to suppress the warning), or set known initial values explicitly and shrink the solve space
- **cmovxx does not automatically split branches (ollvm successor recovery)**: symptom — when angr simulates an ollvm real block to find successors, the cmov branch is lost and the successor relation is incomplete; cause — angr implements cmov-class instructions by **accumulating constraints** rather than splitting into two states; fix — split by hand: `state.copy()` twice (one executes the Move: `setattr(regs, dst, getattr(regs, src))`, one does not), and **manually skip the cmov instruction** (`state.regs.ip += ins.size`) so angr does not execute it again, then step each simgr to find successors
- **A dispatcher hook must unhook + calibrate the address offset**: symptom — after the hook jumps from the main dispatcher's last instruction to a real block, execution jumps back into the dispatcher and loops, or angr decodes garbage instructions; cause — the hook was not removed (execution returns and re-enters the hook); capstone decoded from the wrong boundary (instruction misalignment); fix — unhook immediately after jumping to the target block; when decoding is garbage, adjust the hook address (an empirical offset such as -6; try bit by bit and print the assembly to confirm; see the method in the next item)
- **ollvm real-block identification and patch order**: symptom — a static plugin (D-810) is weak against mutated ollvm (two loop headers, a merge block fused with the loop header); cause — static analysis handles variants poorly; fix — find the real order by dynamic execution: BFS to find the loop header (returning to an already-visited block means it is the loop header) → the loop header's two predecessors = prologue + merge block (the one with more predecessors is the merge block) → the merge block's predecessors = real blocks, and also find the ret block (no successor and the last instruction is retn); **patch order is fixed**: first collect the full list of useless blocks (including start and end addresses) → then patch control flow → finally nop the useless blocks from that earlier list (patching first and then searching for useless blocks finds the wrong ones)
- API cheat sheet (load / state / solve / hook families) and combined playbooks: [[commands]]; version differences, solver semantics, and load boundaries: [[gotchas]]
