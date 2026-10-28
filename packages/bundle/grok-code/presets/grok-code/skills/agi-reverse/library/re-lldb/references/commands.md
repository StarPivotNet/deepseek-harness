# lldb command cheat sheet and operation sequences

lldb is a command-line debugger (bundled on macOS / Linux distro repos / a standalone llvm.org build). Remember commands by family: `target` (session) → `process` (run) → `breakpoint` (breakpoints) → `thread` (threads/stepping) → `frame` (stack frames) → `memory`/`register` (memory/registers) → `image` (symbols/images). `image` is an alias of `target modules`. Official reference: lldb.llvm.org (the GDB to LLDB mapping page + the command reference).

## Command-family cheat sheet

### Session and run

- `target create <file>` loads the target; `target list` / `target delete`
- `process launch [--stop-at-entry] [-- args]` starts (stop at entry); `run [args]` is the short equivalent
- `process attach --pid <pid>` / `--name <name>` attaches; `process detach` detaches; `process kill` terminates
- `continue` / `c` continues; `process interrupt` interrupts (Ctrl+C); `process status` is the current state
- `lldb -p <pid>` attaches directly from the command line; `lldb -s script.lldb <file>` runs a script file in batch

### Breakpoints

- `breakpoint set -n <symbol>` a symbol breakpoint (takes effect automatically after the module loads); `-a <address>` an address breakpoint; `-r <regex>` a regex breakpoint
- `breakpoint set -n func -s <module>` limits the module; `-c <condition>` a conditional breakpoint
- `breakpoint list` / `delete` / `disable <id>` / `enable <id>` / `clear`
- `breakpoint command add <id>` runs commands in batch (end with `> ... > DONE`); `breakpoint command delete <id>` removes them

### Stepping and stack

- `thread step-over` / `step-into` / `step-out` (aliases `next` / `step` / `finish`)
- `thread step-inst` single-instruction step; `thread until <address>` runs to an address (use inside a loop)
- `thread backtrace` (`bt`); `thread list`; `thread select <n>` switches thread
- `frame select <n>` switches stack frame; `frame variable` locals; `frame info` current-frame info

### Registers and expressions

- `register read` (all) / `register read rax`; `register write rax 0` writes a register
- `expr <expression>` evaluates; `expr $rax = 0` writes; `expr (char*)0x...` a typed read of an address
- `expr -O -- <objc expression>` Objective-C evaluation (the objc runtime must be in the target process)
- `expr -l objc++ -- ...` switches language (a C++ target uses c++)

### Memory

- `memory read [-c count] [-s width] [-f format] <address>` (when a format conflict errors, pass `-f x` explicitly)
- `memory write -s <width> <address> <value>` writes bytes
- `memory find <start> <end> [-e expression|-s string]` searches a range for bytes/a string
- `memory region <address>` region permissions/bounds (look at anomalous RWX segments)
- `memory read --force -o <file> <address> <address+length>` exports to a file (a large dump)

### Symbols and images

- `image list` loaded image bases; `image list -o` adds the offset (ASLR conversion)
- `image lookup -n <name>` / `-a <address>` / `-rn <regex>` looks up which symbol owns it
- `image dump symtab [<module>]` the full symbol table; `target symbols add <file>` loads a symbol file by hand
- `image lookup -t <type name>` looks up a type definition (a debug-build target)

### Python scripts

- `script` enters the Python REPL; `script import lldb` uses the `lldb.debugger` handle
- `command script import <module>` registers a Python command; `lldb -s script.lldb` is batch
- Common: the `lldb.debugger.GetSelectedTarget().FindFunctions("main")` family

## Common operation sequences (combined playbooks)

### 1. Attach → breakpoint → verify call arguments

```
lldb -p <pid>
(lldb) breakpoint set -n objc_msgSend -s <target module>
(lldb) breakpoint command add 1
> register read rdi rsi          # the first two arguments of the x64 ABI
> thread backtrace
> continue
> DONE
(lldb) continue
```

### 2. Locate check / authorization logic (symbol → breakpoint → change a value to bypass)

```
(lldb) target create ./sample
(lldb) run --args <arguments>
(lldb) breakpoint set -n strcmp                 # or -n the target check function
(lldb) continue → after the hit:
(lldb) register write rax 0                     # change the return value (equal)
(lldb) continue                                  # see whether it was bypassed
```

### 3. Memory search for a key/constant

```
(lldb) memory find -s "flag{" 0x100000000 0x101000000
(lldb) memory find 0x100000000 0x101000000 -e 0xdeadbeef
# hit address → break the write point or memory region to see the owning module → walk back to the caller
```

### 4. Let a decrypt loop run to completion (conditional breakpoint + until)

```
(lldb) breakpoint set -a <loop-tail address> -c '*(int*)($rdi) == 0xABCD'
(lldb) continue                     # stop only when the condition holds
(lldb) memory read -c 16 -s 1 -f x <output address>
```

## Lessons internalized

- Prefer a symbol name for a breakpoint (`-n`). Do not use a hardcoded address — under ASLR the base drifts on every run
- `memory read` without a format reports a format conflict — `-f x` (hex) is the usual debug option
- `expr` has side effects (it executes code): in a verification scenario, read-only `frame variable` first, and evaluate only after you confirm it is needed
- A wrong conditional-breakpoint condition does not error. It just never hits — break unconditionally first and confirm it stops, then add the condition
- In a batch `lldb -s` script, one command per line; an error does not abort. Watch the output at the end

## Usage notes

- Execute entirely inside a sandbox (top principle in [[re-analyze/platform-tips]]); attach needs Developer Tools authorization
- Write conclusions into [[re-analyze/analysis-contract]]; cross-check against the [[re-triage]] survey; iOS target permission/certificate problems go to [[re-mobile]]
