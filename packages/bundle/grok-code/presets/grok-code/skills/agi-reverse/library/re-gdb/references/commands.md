# GDB command cheat sheet and operation sequences

gdb itself + one enhancement frontend (pwndbg / gef; install is in [[re-gdb]]). Commands are grouped by family; pwndbg/gef commands follow each official README.

## Session and run family

| Command | Role |
|---|---|
| `gdb ./target` / `gdb -q -p <pid>` | open a program / quiet attach |
| `attach <pid>` / `detach` / `kill` | attach / detach / kill the process |
| `r <args>` / `r < infile` | run with arguments / redirect input |
| `c` / `si` / `ni` | continue / step into / step over |
| `finish` | run the current function to completion and stop at the return |
| `until <addr>` | run to a specified line/address |
| `set follow-fork-mode child` | follow the child (fork-type samples) |
| `set detach-on-fork off` | stop both sides after fork |
| `set disable-randomization on` | turn off ASLR (PIE addresses stay fixed; easier replay) |
| `handle SIGALRM nostop noprint pass` | do not interrupt the signal (common for timeout-class anti-debug) |

## Breakpoint family

| Command | Role |
|---|---|
| `b *0x401000` / `b sym` / `b file.c:10` | address/symbol/line breakpoint |
| `b sym if argc == 2` | conditional breakpoint |
| `hbreak` | hardware breakpoint (DR registers, limit of 4) |
| `watch *(int*)0x601000` / `rwatch` / `awatch` | write/read/read-write data breakpoint |
| `catch syscall <name>` | syscall breakpoint (openat/write and similar) |
| `commands ... end` | run automatically on hit (`silent` + printf + continue to batch-print arguments) |
| `condition <n> <expr>` | add a condition to an existing breakpoint |
| `ignore <n> <count>` | skip the first N hits |
| `info b` / `disable` / `enable` / `delete` | breakpoint management |

## Memory and register family

| Command | Role |
|---|---|
| `x/20wx $rsp` | inspect memory by format (`x/s` string, `x/i` instruction, `x/30gx` 8 bytes) |
| `p $rax` / `p *(int*)0x601000` | register / dereference |
| `set $rax = 0` / `set {int}0x601000 = 0` | change a register / write memory (this run only) |
| `find 0x400000, 0x410000, "flag{"` | search memory for a string/bytes |
| `disassemble /r 0x401000` | disassemble with raw bytes |
| `info registers` / `info proc mappings` | all registers / process mappings |
| `dump memory out.bin 0x400000 0x401000` | export a memory range to a file (for [[re-memdump]] analysis) |
| `bt` / `frame <n>` / `info locals` / `info args` | call-stack backtrace and frame switch |

## core and process family

| Command | Role |
|---|---|
| `gcore <file>` | dump the current process to a core (prefer an existing dump; see [[re-memdump]]) |
| `gdb ./target core` | replay a core (`bt`, `info proc mappings`, `x/gx $rsp` as the start) |
| `info threads` / `thread <n>` | switch threads (multi-thread samples) |
| `info sharedlibrary` | loaded shared libraries (if a breakpoint does not hit, look here first) |

## pwndbg command family (available after installing pwndbg)

| Command | Role |
|---|---|
| `checksec` | NX/Canary/RELRO/PIE check |
| `vmmap` | memory map (PIE base, stack/heap/library ranges) |
| `heap` / `bins` / `tcache` | heap structure / free lists (for [[re-exploit]] analysis) |
| `cyclic 200` / `cyclic -l <pattern>` | generate / locate an offset (stack-overflow location) |
| `search "str"` / `search -t dword 0xdeadbeef` | memory search |
| `telescope $rsp` | expand the stack contents as a pointer chain |
| `context` | registers + disassembly + stack context (auto-refresh each step) |

## gef command family (available after installing gef)

| Command | Role |
|---|---|
| `checksec` | same as pwndbg |
| `context` / `telescope` | context / pointer chain |
| `xinfo 0x...` | which mapping/symbol an address belongs to |
| `heap bins` / `heap chunks` | heap structure |
| `xuntil` | run to an address (without setting a breakpoint) |

## Script family (-ex / -x / python)

- One-liner: `gdb -q -ex 'b main' -ex 'r' -ex 'x/10i $rip' -ex quit ./target`
- Batch: `gdb -q -batch -x script.gdb ./target` (`define` custom commands + `commands` breakpoint groups inside script.gdb)
- Python: gdb's built-in Python interpreter, a `python` block or `-ex 'python ...'` — pwndbg/gef are implementations of the gdb Python API

## Operation sequences (combined patterns)

### 1. Locate and bypass a license-check compare (arguments + conditional breakpoint)

```
gdb -q ./target
b main; r <input>            # start with the sample input
b strcmp                      # or the check function
commands                      # print arguments automatically on hit
  silent
  printf "a=%s b=%s\n", $rdi, $rsi
  continue
end
c                             # collect every compare argument → recover the check logic statically
```

### 2. core replay (locate a crash sample)

```
gdb ./target core
bt                            # crash call chain
info proc mappings            # mapping baseline (check the PIE offset)
x/20gx $rsp                   # stack scene
# when the environment must be replayed, record and replay with rr (see [[re-crash-triage]])
```

### 3. pwndbg heap-exploit analysis (locate UAF/double free)

```
vmmap                         # heap range
heap                          # heap-chunk overview
bins                          # fastbin/tcache free-chain state
# break and watch malloc/free arguments ($rdi address) against chunk-chain changes
```

### 4. Bypass an anti-debug self-check (ptrace self-check patch)

```
Statically locate the ptrace(PTRACE_TRACEME) call site ([[re-ida]] / [[re-ghidra]])
gdb -q ./target
b *<instruction after ptrace returns>; r
set $rax = 0                  # forge "not being traced"
c                             # patch later compare sites the same way, or statically patch the binary once
```

## Lessons internalized

- The `*` in `b *address` means "exact address" (skip symbol resolution); it is required when pasting a decompiler address; a file offset must add the ASLR base; check with `vmmap`/`info proc mappings` first
- Without `silent` inside `commands`, every hit prints "Breakpoint n..." noise; printf uses gdb format (`%s` needs an address; `$rdi` is the argument)
- A breakpoint that does not hit ≠ the code did not run: first check hit counts with `info b`, module load with `info sharedlibrary`, and whether the byte at the breakpoint is still int3 with `x/i` (self-modifying code overwrote it)
- gdb's `set $reg` affects only this run; persistence means editing the binary and rechecking the hash ([[re-patching]])
- In a Python script, `gdb.execute("...")` throwing aborts the script; wrap a batch run in try/except and print progress
- `find`'s address-range arguments are `start, end` (comma-separated; a space after the comma is allowed); a wrong spelling reports a syntax error — confirm the range with `info proc mappings` first

## Usage notes

- Dynamic execution defaults to a sandbox ([[re-analyze/platform-tips]] highest principle); if attach fails, switch to a [[re-memdump]] dump
- Archive modification/dump products with sha256 ([[re-triage]]); write conclusions into [[re-analyze/analysis-contract]]
