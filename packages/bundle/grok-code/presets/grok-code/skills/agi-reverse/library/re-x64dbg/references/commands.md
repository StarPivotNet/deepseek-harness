# x64dbg command cheat sheet and operation sequences

x64dbg has two entries: graphical shortcuts (the main UI) and the command box at the bottom (a command line that supports script expressions). They can be mixed — `bp` first, then F9 to run. The command box executes on Enter. Expressions support registers / memory references (`[address]` reads a value), arithmetic, and string formatting. Every command name and argument follows the official x64dbg docs (docs/commands/).

## Shortcut cheat sheet (grouped by task)

| Task | Shortcut | Notes |
|---|---|---|
| Open/attach | F3 / Alt+A | File > Open / File > Attach (administrator privilege) |
| Run | F9 | continue running |
| Run to cursor | F4 | run to the selected line |
| Run to user code | Alt+F9 | from a system breakpoint / library code back to the user module |
| Run to return | Ctrl+F9 | the current function's RET (pair with F8 to skip a call and leave the function) |
| Pause/restart/close | F12 / Ctrl+F2 / Alt+F2 | Pause / Restart / Close session |
| Single-step | F7 / F8 | step into / step over |
| Single-step (skip exceptions) | Shift+F7 / Shift+F8 | use when system APIs raise internal exceptions often |
| Software breakpoint | F2 / Shift+F2 | toggle a breakpoint / edit a conditional breakpoint |
| Breakpoint window | Alt+B | manage: Space enables/disables, Delete removes, double-click edits the condition/log |
| Memory breakpoint/hardware breakpoint | right-click menu | memory window right-click Set Memory BPX; disassembly right-click Hardware breakpoint |
| Memory map | Alt+M | section permissions, module list |
| Binary search | Ctrl+B | a byte pattern, `?` wildcards supported (for example `55 8B EC`, `EB0?90`) |
| Find | Ctrl+F | find in the current view (disassembly/memory/stack) |
| Module strings | Shift+D | find string references in the current module |
| Go to address | Ctrl+G | jump by expression/address |
| Edit memory | Ctrl+E | change bytes (patch to bypass a check) |
| Analyze | Ctrl+A / A | analyze the whole module / analyze one function |
| Cross-references | Ctrl+R / X | references of the selected address / xrefs of the current instruction |
| Views | Alt+C / Alt+M / Alt+E / Alt+T / Alt+G / Alt+K / Alt+B / Alt+R / Alt+L | CPU / memory / modules / threads / graph / call stack / breakpoints / references / log |
| Scylla | Ctrl+I | open the IAT repair plugin |

## Command-line commands (the bottom command box)

### Breakpoint family

- `bp <address|API name>` software breakpoint (INT3; `ss`/`ud2`/`long` change the type, for example `bp 401000,ss` is a one-shot breakpoint). Break an API name directly: `bp kernel32.VirtualAlloc`
- `bph <address>[,r|w|x][,1|2|4|8]` hardware breakpoint (execute by default; 8 bytes is allowed on x64; the address must be aligned; DR register cap is 4)
- `bpm <address>[,a|r|w|x]` memory breakpoint (GUARD_PAGE, fires on a whole memory region, all types by default)
- `bc <address|name>` deletes; `bpd`/`bpe` disable/enable; `bplist` lists all
- Condition/log: `SetBreakpointCondition <address> <condition>`, `SetBreakpointLog <address> <expression>`, `SetBreakpointCommand <address> <command>` — on hit it does not pause, it only logs / runs a command. Commonly used to verify arguments in bulk

### Run and trace

- `run [address]` (aliases `go`/`r`/`g`) runs. With an address = set a one-shot breakpoint then run (equivalent to F4)
- `sti [n]` single-steps n times (Trap Flag); `sto` steps over; `rtr` runs until return (equivalent to Ctrl+F9); `skip` skips the current instruction
- `erun`/`esti`/`esto` single-step with exception handling (equivalent to the Shift+F8 family)
- `ticnd <condition> [,max steps]` conditional step-into trace; `tocnd` conditional step-over trace — automatically finish a decrypt loop / wait for a specific register value
- `opentrace <file name>` turns on trace recording (pair with ticnd/tocnd to record the instruction stream; it can be replayed)

### Memory and search

- `find <start address> <byte pattern>` searches one page, and `$result` returns the hit address (in-page search; cross-page uses findallmem). Patterns support `?` wildcards and string formatting
- `findallmem <start address> <pattern>` searches the whole memory map, and `$result` = the hit count (results go to the References window and can be walked)
- `savedata <file name> <address> <size>` exports a memory range. A file name of `:memdump:` is saved as `memdump_pid_addr_size.bin`
- `minidump <file name>` generates a dmp with full memory + handle info
- `alloc`/`free` allocate/free memory inside the target process (commonly used for injection / patching)

### Session and analysis

- `attach <pid|process name>` / `detach` attach/detach; `stop` ends the debug session
- `analyse` analyzes the module (equivalent to Ctrl+A); `symload`/`symdownload` load/download symbols
- `reffind`/`refstr` find references/strings (equivalent to the Shift+D family)

## Common operation sequences (combined patterns)

### 1. Unpack: run to the OEP + Scylla repair

```
bp VirtualAlloc (or a memory breakpoint on the packer's decrypt write point) → F9 run → watch the unpack process
Reach OEP features (a standard prologue such as push ebp; mov ebp,esp) → Ctrl+I opens Scylla
Check the OEP field (a full VA) → IAT Autosearch → Get Imports → Dump → Fix Dump
```

### 2. Find a registration-code / authorization-check compare point

```
Shift+D module strings, look for a prompt of the "注册成功/Invalid key" class → Ctrl+R finds the string reference
Walk up from the reference to the compare instruction (strcmp / a custom check call) → F2 breakpoint → change the register / change the jump
```

### 3. Capture runtime decrypted data (a key / an in-memory decrypted section)

```
Find an RWX section in the memory window (Alt+M) → set a memory breakpoint on that section (write trigger) → F9
The hit stops at the write point → Ctrl+G to the written address → Ctrl+E to view/copy the plaintext
savedata dumps the whole decrypted section, for offline analysis by [[re-format-pe]] or [[re-imports]]
```

### 4. Automatically run through a decrypt loop (conditional trace)

```
ticnd "RAX==0 && [401000]==0x90", 1000000
# single-step until the condition holds or the 1,000,000-step cap — it stops naturally when the decrypt loop ends
```

## Lessons (internalized)

- The command box supports expressions and `[memory]` dereference: `[401000]` reads a value, `eip`, `(byte)[eax]` — write the expression directly in a conditional breakpoint / ticnd condition. Do not precompute a constant
- `find` searches only inside one memory page. A whole-memory search uses `findallmem` (results are in the References view)
- Conditional breakpoints / log breakpoints do not change the execution flow. They suit "confirm arguments / confirm the call site", and they are more reversible than changing a register directly
- A hardware breakpoint (bph) does not modify code bytes, and is preferred against an integrity-check target. But there are only 4 DR register slots
- After attach, F12 to pause before setting breakpoints — on a multi-threaded target, setting breakpoints while it runs misses hits

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]]). Administrator privilege is the prerequisite for attach
- After Scylla writes the repaired exe, compare its sha256 with the original sample and archive it (see [[re-triage]]). Write the analysis conclusion into the [[re-analyze/analysis-contract]] data contract
