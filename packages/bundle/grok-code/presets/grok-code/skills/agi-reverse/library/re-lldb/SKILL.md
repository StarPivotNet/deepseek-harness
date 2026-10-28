---
name: re-lldb
description: >
  lldb debugging (macOS/iOS): attach, expr, image.
  Triggers: lldb, `macOS调试`, `iOS调试`
capabilities: [debugging]
---

# lldb dynamic debugging (macOS/iOS)

## When to use / when not to use

- Use: dynamic debugging of a macOS/iOS target (attach/launch/breakpoints/expression evaluation/symbol lookup)
- Use: debugging a debug-build program with DWARF on Linux (lldb shares a lineage with the clang toolchain, and DWARF handling is mature)
- Do not use: a Linux target ([[re-gdb]]), a Windows target ([[re-x64dbg]])
- Do not use: iOS jailbreak/certificate environment problems (the [[re-mobile]] domain); read-only memory ([[re-memdump]] prefers the default dump)
- Do not use: scripted bulk memory dumps / forensics ([[re-memdump]] / [[re-mem-forensics]] fit better)

## Tool setup

See the macOS branch of [[re-analyze/platform-tips]] — SIP and TCC restrict attach, and Developer Tools authorization is required.

### lldb

- macOS: bundled (Xcode Command Line Tools: `xcode-select --install`)
- Linux: `apt install lldb` / `dnf install lldb` / `pacman -S lldb`
- A fuller macOS install: `brew install llvm` (includes a newer lldb)
- Verify: `lldb --version`
- Version differences: the lldb bundled with Xcode, llvm.org's lldb, and the Swift toolchain's lldb are similar in features but differ in version number (confirm with `lldb --version`); when a script depends on the `lldb.SBDebugger` API, cross-version compatibility must be verified (see [[gotchas]])

### SIP off, or authorization (attach prerequisite)

- System Settings > Privacy & Security > Developer Tools > authorize the terminal that uses lldb (TCC authorization)
- Older systems: `sudo DevToolsSecurity -enable`
- Note: in general do not turn SIP off (handle it temporarily only for a debug need); iOS kernel-level debugging needs a KDK/development kernel and belongs to the [[re-mobile]] domain

## Procedure

1. **Confirm Developer Tools permission**:
   ```sh
   lldb -p <test process pid>   # if it reports "please check the developer mode" / permission denied → authorize the terminal in System Settings
   ```
   After authorization, restart the terminal; if it still fails, check SIP status: `csrutil status`.
   Note: the TCC authorization prompt must be confirmed by hand in System Settings. It cannot be bypassed from the command line.

2. **Attach / launch**:
   ```
   (lldb) process attach --pid <pid>     # attach
   (lldb) process attach --name Safari   # attach by name (must be unique)
   (lldb) target create ./sample         # or launch directly
   (lldb) run --args arg1
   (lldb) continue / c
   ```
   An iOS device: `platform select remote-ios` + `process connect connect://<device>` (needs a debug service; jailbreak/certificate requirements are in [[re-mobile]])
   - Attach timing: the target has already run its init logic, so pre-entry behavior is invisible — if you need to see it from the entry, use `target create` + `run` launch mode
   - Stop at entry on launch: `process launch --stop-at-entry` (equivalent to `-s`)

3. **`image lookup` symbols**:
   ```
   (lldb) image lookup -n main            # look up a symbol by name
   (lldb) image lookup -a $pc             # look up the current function/source line by address
   (lldb) image list                      # loaded images (dylib base table)
   (lldb) image lookup -rn dispatch       # regex-match symbols
   ```
   For a stripped binary, `image lookup -a` looks an address's owning module up backward, together with `image dump symtab`
   - Module base: `image list -o` adds an offset column — under ASLR the base differs on every run. In a script, take the base first and then compute the absolute address (see [[gotchas]])

4. **Memory expressions `expr`**:
   ```
   (lldb) expr $rax
   (lldb) expr $rax = 0                   # write a register
   (lldb) expr (char*)0x100000000         # a typed read of an address
   (lldb) expr -O -- @"hello"             # Objective-C evaluation (objc runtime)
   (lldb) memory read -c 20 -s 4 -f x $rsp     # read memory (missing -f x reports a format-conflict error)
   (lldb) memory write -s 1 0x100000000 0x90  # write a byte (bypass a check)
   ```
   - Expression evaluation has side effects (it executes code) — do not evaluate carelessly on a sensitive path. See [[gotchas]]

5. **Breakpoints and scripts**:
   ```
   (lldb) breakpoint set -n main
   (lldb) breakpoint set -a 0x100004000 -c '*(int*)($rsp) == 0x1234'   # conditional breakpoint
   (lldb) breakpoint command add 1
   > frame variable
   > expr $rax
   > continue
   > DONE
   ```
   Python automation: lldb has Python built in — `script import lldb`, or batch with `lldb -s script.lldb`.
   - Symbol breakpoint: `breakpoint set -n objc_msgSend` (by symbol name; takes effect automatically after the module loads); regex: `-r '^check_'`
   - Breakpoint management: `breakpoint list` / `breakpoint delete` / `breakpoint disable 1`

6. **Single-step / stack / threads**:
   ```
   (lldb) thread step-over / step-into / step-out   # step over / into / out of a function (aliases next/step/finish)
   (lldb) thread backtrace                          # current thread stack (alias bt)
   (lldb) thread list                               # all threads
   (lldb) frame select 1                            # switch stack frame
   (lldb) frame variable                            # current-frame locals
   (lldb) register read                             # all registers
   ```
   - `step-out` after stepping over a call, together with the return register, is the fastest path to "verify a function's return"

7. **Memory search and regions**:
   ```
   (lldb) memory find 0x100000000 0x101000000 -e 0xdeadbeef   # search a range for a value/byte string
   (lldb) memory find -s "password" 0x100000000 0x101000000   # search for a string
   (lldb) memory region 0x100004000                           # permissions/bounds of the region that owns this address
   ```
   - Finding a key/constant: `memory find` locates it first, then break the write point; look at anomalous region permissions (RWX) first (packer/decrypt segments)

8. **Evidence check (close-out)**: breakpoint-hit records, `frame variable` / `expr` output, and `memory read` dumps (`memory read --force -o file` to export) are filed against the [[re-triage]] survey. Write conclusions into [[re-analyze/analysis-contract]]

## Cross-domain

- [[re-binary-core]]: workflow step 6 (macOS/iOS debugger)
- [[re-mobile]]: the lower-level tool for iOS app / jailbreak dynamic debugging
- [[re-format-macho]]: parse the structure before debugging (entry / LC_MAIN and signature state)
- When attach fails, follow [[re-analyze/platform-tips]] to [[re-memdump]]

## Common pitfalls

- **SIP/TCC blocks attach**: attach from an unauthorized terminal is refused (`permission denied` or a silent failure) — authorize Developer Tools in System Settings; turn SIP off only in an extreme case
- **The permission prompt must be confirmed by hand**: TCC pops a prompt for every new debug target, and a scripted attach gets stuck — authorize the target program in advance
- **Kernel debugging needs extra configuration**: macOS kernel debugging needs a matching KDK version + a development-kernel boot. Ordinary reversing does not use it. Do not waste time on it on top of user-mode debugging
- **Signature state**: a modified Mach-O that was not re-signed will not run (see [[re-format-macho]]) — `codesign -f -s -` re-signs it before debugging
- **Three layers: task_for_pid entitlement / SIP / Hardened Runtime**: symptom — Developer Tools is already authorized and attach still fails, or the target crashes as soon as it starts; cause — besides TCC there are three more layers: the debugger needs the task_for_pid entitlement, debug APIs are restricted when the target has Hardened Runtime enabled, and SIP restricts attach to system processes; fix — check layer by layer (`csrutil status`, check the target signature and entitlement). A test target can be unsigned/re-signed first ([[re-format-macho]]) and then debugged. See the macOS branch of [[re-analyze/platform-tips]]
- **ASLR base drift**: the dylib base differs on every launch — a hardcoded address in a script stops working; take the base with `image list -o` and convert, and prefer a symbol name for breakpoints (`-n` / `-s`)
- **Expression evaluation has side effects**: `expr` really executes code (calls a function / changes memory) — evaluating at a hook point can change target behavior. In a verification scenario, prefer read-only `frame variable`
- Version differences, the debug server, and boundaries: [[gotchas]]
