# strace / ltrace / dtruss command cheat sheet and operation sequences

Split: strace sees system calls (kernel boundary), ltrace sees library calls (user-mode boundary), dtruss is the macOS counterpart of strace (DTrace implementation). Options follow this machine's `strace --help` / `ltrace --help` (version differences are in [[gotchas]]).

## Command-family cheat sheet

### strace — system calls

| Use | Command |
|---|---|
| Full process-tree trace | `strace -f -o trace.log ./target` |
| Filter by category | `-e trace=file,network,process,signal,ipc,memory,desc,read,write` (combinable) |
| Drop noise | `-e trace=!futex` (exclude high-frequency calls) |
| Named calls | `-e trace=openat,execve,connect,sendto` |
| Regex on call names | `-e trace=/open` (syscalls whose name contains open) |
| Attach a running process | `sudo strace -f -p <pid> -o attach.log` |
| Summary stats | `-c` (on exit, print the count/time/error table) |
| Timestamps | `-tt` microseconds; `-T` per-call duration |
| String length | `-s 200` (default 32) |
| hex output | `-x` (non-ASCII to hex); `-xx` (everything) |
| Resolve fd to path | `-y` (path); `-yy` (includes socket detail) |
| One file per pid | `-o log.%p` |
| Quiet | `-q` (suppress attach/detach messages) |

### ltrace — library calls

| Use | Command |
|---|---|
| Library-call trace | `ltrace -f -o lib.log ./target` |
| Named functions | `-e malloc+free` (`+` adds, `!` excludes) |
| Named library | `-l /path/libfoo.so` (a library loaded after dlopen) |
| Library + system calls | `-S` |
| Summary | `-c` |
| Relative timestamps | `-r` |
| Instruction pointer | `-i` (print the call-site IP; compare with disassembly) |
| Call stack | `-w 5` (at most 5 backtrace frames) |
| attach | `ltrace -p <pid>` |

### dtruss (macOS, DTrace)

| Use | Command |
|---|---|
| Basic trace | `sudo dtruss -f ./target` (DTrace output goes to stdout) |
| Call stack | `-s` (print stack backtraces) |
| Duration stats | `-e` (elapsed times, microseconds) |
| Filter calls | `-t <syscall>` (for example `-t write`) |
| Summary | `-c` (syscall count statistics) |

### Post-processing pipes

```sh
strace -f -o trace.log ./target
grep -E 'openat\(.*ENOENT' trace.log        # "file not found" leads (config path / missing dependency)
grep -E 'connect\(' trace.log               # network callback points
grep -c 'ptrace' trace.log                  # anti-debug trace check
awk '/read\(|write\(/' trace.log           # data-movement fragments
```

## Common operation sequences

### 1. Locate persistence / file behavior

```
strace -f -e trace=file,process -o fs.log ./target
→ grep openat/creat/rename/unlink + O_WRONLY/O_CREAT → list of paths written to disk
→ grep execve → process chain that was launched
→ compare the result with the persistence-location list in [[re-behavior]]
```

### 2. Network callback and protocol arguments

```
strace -f -e trace=network,read,write -o net.log ./target
→ grep -E 'socket|connect|sendto|recvfrom' → target IP:port and data fragments
→ -s 200 keeps the payload from being truncated; compare with the [[re-netcap]] capture
```

### 3. Trace dynamically resolved APIs (after dlopen/dlsym)

```
ltrace -f -o lib.log ./target
ltrace -f -l /path/libfoo.so ./target     # name the dynamically loaded library explicitly
→ output shows functions that are not in the static IAT → merge with the [[re-imports]] static result into a complete API surface
```

### 4. Locate anti-debug check points

```
strace -f -e trace=ptrace,process -o det.log ./target
→ grep ptrace to watch the sample's self-trace / detection behavior
→ a sample often shows timing differences or a fake path against a trace environment — after the check point is confirmed, bypass or statically patch per [[re-anti-analysis]]
```

### 5. Hotspot stats (performance / path preference)

```
strace -f -c -o /dev/null ./target        # syscall hotspots
ltrace -f -c ./target                     # library-call hotspots
→ high-frequency futex/epoll_wait = a wait loop; high-frequency read/write = a data-movement path
```

## Lessons (internalized)

- Output is evidence: `-o` to disk + timestamps; the terminal is only a preview. Archive the log sha256 ([[re-triage]])
- The first suspect when a string "shows no contents" is the default `-s` 32-byte truncation — enlarge it and rerun
- Allow-list filtering beats deny-list: shrink with `-e trace=network,file` first, then drop noise with `!futex`
- attach cannot catch initialization: rerun early logic in launch mode. attach only sees "after the current moment"
- ltrace depends on the PLT / dynamic symbol table. A statically linked program basically produces no output — `file` first to confirm dynamic linking. For a static sample, switch to strace or emulation

## Notes

- Run everything inside a sandbox (top rule in [[re-analyze/platform-tips]])
- Trace results from an anti-debug sample may be deliberately polluted (see [[gotchas]] and [[re-anti-analysis]])
- Evidence chain: log path + sha256 + timestamp → [[re-analyze/analysis-contract]]
