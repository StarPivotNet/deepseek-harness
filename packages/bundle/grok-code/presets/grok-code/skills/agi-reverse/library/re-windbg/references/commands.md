# WinDbg command cheat sheet and operation sequences

WinDbg commands are three kinds: ordinary commands (`.exr`/`g`/`r`, starting with a dot), extension commands (`!analyze`/`!process`, starting with a bang, from an extension DLL), and pseudo-registers (`$<name>`). Symbol syntax is `module!symbol` (`nt!KeWaitForSingleObject`). Official reference: Microsoft Learn debugger command reference (debuggercmds).

## Command-family cheat sheet

### Session and running

- `windbg -p <pid>` / `windbg <exe>`; `-g` skips the initial breakpoint; `-z <dump>` opens a dump; `-k` connects kernel debugging
- `g` continue; `gh`/`gn` continue (hand the exception to the program / ignore it); `Ctrl+Break` breaks in; `q` quits
- `.restart` restarts the target; `.detach` detaches; `.kill` terminates

### Breakpoints

- `bp <module!symbol|address>`; `bu <symbol>` is an unresolved-symbol breakpoint (it takes effect automatically after the module loads — preferred when the target DLL is not loaded yet)
- `bm <wildcard>` sets breakpoints in bulk (for example `bm nt!Io*`); `bl` lists; `bd`/`be` disable/enable; `bc *` clears
- Conditional breakpoint: `bp addr ".if (rax==0) { } .else { gc }"` — continue automatically when the condition is not met
- Command breakpoint: `bp addr "r; k; gc"` runs commands on hit and then continues (log-style observation)

### Single-step and stack

- `p` step over; `t` step into; `pa <addr>` step over to an address; `ta <addr>` step into to an address; `gu` run until return; `pt` run until a call returns
- `k` / `kb` / `kv` stack walk (arguments / symbol frames); `kn` with frame numbers; `dps rsp` views stack contents as pointers
- `.frame <n>` switches stack frame; `.ecxr` sets the exception context (the opening of dump analysis); `.exr <addr>` displays the exception record; `.cxr <addr>` sets the context by hand

### Registers and memory

- `r` / `r rax` / `r eax=0`; `r $t0=...` pseudo-registers (script temporaries)
- `db`/`dd`/`dq`/`du` read memory (byte/dword/qword/Unicode); `dps` interprets as pointers
- `eb`/`ed` write memory (`eb 0x401000 90`); `u <addr>` disassembles (`u address Lcount`)
- Search: `s -d 0x0 L?10000000 0xdeadbeef` (a value), `s -a 0x0 L?10000000 "text"` (an ASCII string) — find constants/strings in the process virtual address space
- Memory map: `!address <addr>` region info (protection/mapping); `!vad` the user-mode VAD tree

### Symbols

- `.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols`; `.symfix` uses the default symbol server
- `.reload /f [module]` force-reloads symbols; `lm`/`lmv m <module>`/`lmi <module>` module and image info
- `x <module>!*<keyword>*` searches symbols (for example `x nt!*ExAlloc*`)

### Extension commands (common subset)

- Crash: `!analyze -v` (EXCEPTION_CODE/FAULTING_IP/STACK_TEXT/PROCESS_NAME)
- Process/thread: `!process 0 0`; `!process <EPROCESS> 1`; `!thread`; `!teb`; `!peb`
- Handle/heap: `!handle <handle>`; `!heap -a`; `!pool <address>` (a kernel pool block)
- Kernel objects: `!object <address>`; `!devobj`/`!drvobj` (device/driver objects); `!irp <address>`; `!stacks 0` (full-stack summary)
- Other: `!dlls` (process module tree), `!runaway` (thread CPU time), `!locks` (locks)

### dump and dumping

- User-mode full: `.dump /ma C:\x.dmp` (includes handles/memory, the forensics standard); `.dump /f` (full)
- Kernel: the target's `%SystemRoot%\Minidump\*.dmp` (a small dump). A full dump needs the kernel dump settings configured
- `.writemem <file> <start> <end>` exports a memory range; `.readmem` reads it back

### TTD (time-travel debugging, needs an administrator)

- Record: `ttd.exe -out C:\traces target.exe args`; `ttd.exe -attach <pid> -out ...`; `-monitor <name>`; `-ring` (2GB ring cap)
- Open: WinDbg `File > Open` selects `.run`. Index: `!tt.index` (slow the first time, fast after)
- Replay: `g-` runs backward; `t-`/`p-` single-step backward; `!tt 50` jumps by percent; `!tt position` jumps to `event:step`
- Breakpoints: `!tt br <register> [value]` (stop where the value changes; `br-` searches backward); `!tt bm <address range>` (stop on a memory access)
- Data model: `dx @$cursession.TTD.Calls("module!function")`; `dx @$cursession.TTD.Memory(start, end, "rwec")` (memory-access records)
- `ttd.exe -stop all` stops every recording; `-help` is the full parameter list

## Common operation sequences (combined patterns)

### 1. Crash dump analysis (the standard minidump opening)

```
windbg -z C:\dump.dmp
.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols; .reload /f
.ecxr                    # set the scene from the exception context (a WER dump's current context is inside WerpReportFault and is not trustworthy)
k                        # the real stack walk
!analyze -v              # automated analysis: check FAULTING_IP / STACK_TEXT frame by frame
```

### 2. Check bypass (break the API → change the return → continue)

```
windbg target.exe (-g can skip the initial breakpoint)
bp kernel32!CreateFileW          # or the target check API
g → after the hit:
r rax=0                          # change the return value
gu; g                            # continue after leaving the function
```

### 3. Driver / kernel-module symbols and deep analysis

```
!process 0 0 → find the target process EPROCESS
.process /p <EPROCESS>; .reload /f
lmv m <driver name>               # base / version / path
bp <driver name>!<function>       # a symbol breakpoint inside the driver
!analyze -v (on a kernel crash it produces the bugcheck + the faulting driver)
```

### 4. TTD record → replay to find a decrypt / check point

```
ttd.exe -out C:\traces target.exe       # record from an administrator command line
WinDbg opens .run → !tt.index
dx @$cursession.TTD.Calls("module!suspicious function")   # look at call counts / argument distribution
!tt br <register> → locate the value-change point → single-step forward/backward and look at context
```

### 5. Recover a damaged-stack scene (live session)

```
crash hit → .exr <EXCEPTION_RECORD address> (take it from STACK_TEXT in !analyze -v)
.cxr <CONTEXT address> → k → kv
```

## Lessons (internalized)

- `!analyze -v` is the start, not the end — after `STACK_TEXT` you must `.ecxr` + `k` and check the real call chain by hand
- When symbols are not loaded, every output is a bare offset — `.symfix` + `.reload /f` first. Breakpoints use `bu` (they can be set while unresolved)
- Conditional breakpoints use `.if/.else + gc` syntax (not gdb's `if` suffix). A command breakpoint does log-style observation without stopping
- A user-mode `s` search can use `L?<range>`. A kernel address-space search is large; shrink the range first
- TTD's `!tt bm`/`br` are the tool for "find a memory/register event" — much faster than rerunning the target over and over
- In a damaged-stack scene, `.ecxr`/`.cxr` is the only reliable walk. Do not trust `k`'s direct output

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]]). Attach / kernel debugging needs administrator privilege
- Write the conclusion in [[re-analyze/analysis-contract]]. Compare the dump product's sha256 with the [[re-triage]] first-look value. A driver scene pairs with [[re-kernel]]
