# Dynamic-analysis countermeasure workflow (general)

Applies to dynamic analysis of any target that has anti-analysis, anti-debug, or packing (mobile, desktop, and firmware). The method is the core; the instrumentation tool is replaceable (Frida / objection / Xposed / GDB / LLDB).

## Crash-iteration method (static locate → targeted script → crash-log driven)

Do not preload a universal bypass bundle. Follow the loop:

1. **Baseline crash check**: run the target as-is first (spawn / early startup, `--pause` or an equivalent stop before early code), capture the crash log, and classify it into four kinds:
   - Java/managed crash (FATAL EXCEPTION + exception class name)
   - native crash (SIGABRT / SIGSEGV / SIGBUS / SIGFPE / SIGILL)
   - ANR
   - anti-analysis indicator (log contains security / tamper / root / frida / xposed / magisk / substrate / debug / hook keywords)
2. **Crash signature → protection mechanism**:

| Crash signature | Points to | How to locate |
|---|---|---|
| System.exit(0) on the stack | anti-analysis self-kill | search System.exit / Process.killProcess |
| SecurityException | permission or integrity check | search the exception class |
| SIGABRT (native) | native anti-tamper (instrumentation detection, library integrity) | inspect the .so; search dlopen / ptrace / frida strings |
| exits on startup with no crash | finish() or System.exit inside an early entry | read conditional branches in the entry Activity/function |
| root/integrity SDK log (RootBeer/SafetyNet/Play Integrity) | root/integrity SDK | search the SDK package name |
| ssl/certificate/pin log | certificate pinning blocking capture | search CertificatePinner / TrustManager |
| frida/xposed/substrate log | instrumentation detection | search process name / port / module checks |

3. **Targeted bypass**:
   - boolean check method → return false
   - native function → `Interceptor.replace` equivalent + NativeCallback returning 0
   - unknown check → hook the self-kill function (System.exit and similar) and print the call stack to find the source
   - background thread keeps checking → hook `Thread.start()` or the matching Runnable
4. Three to five layers of checks is normal; if the default instrumentation port is probed → start on another port

## High-frequency detection surfaces (detection and bypass share the same surface)

- **Filesystem**: instrumentation server paths, su paths (20+ common locations), TracerPid in `/proc/self/status`
- **Ports**: default instrumentation ports (for example 27042-27045), debugger ports
- **Thread names**: instrumentation runtime thread-name signatures (GumJSLoop / GumJS-Worker / coordinator class)
- **Memory layout**: `dlopen` of the instrumentation library path, `mmap` PROT_EXEC, signature strings in maps
- **System properties / environment**: `ro.debuggable`, `ro.kernel.qemu`, `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES`
- **Time**: sleep / GetTickCount / RDTSC (detects sandbox time acceleration)
- **ptrace**: PTRACE_TRACEME self-trace to detect a debugger

## Raw syscall detection

When the target implements syscalls itself (bypassing libc), libc-symbol hooks and detections all fail — capture at the svc instruction:

- **Architecture branch**: arm64 SYS_OPENAT=56 (there is no open syscall), svc encoding `01 00 00 D4`, path argument in x1 (x0 is dirfd); arm SYS_OPEN=5, `00 00 00 EF`, path in r0
- **Method**: walk executable segments (r-x), filter .so → signature scan hit → read the instruction before svc for the syscall number (arm64: immediate field of `mov x8`; arm: r7) → attach only when the syscall number equals the target (for example SYS_OPEN) → print the filename and return value
- **Note**: check arm64 argument indexes against the syscall convention (openat's path is in x1, x0 is dirfd; do not copy a remembered index); check the syscall-number table against the target kernel / Android version

## Implementation lessons (internalize)

- A return value can be changed only in **onLeave with `retval.replace()`**; onEnter cannot change it
- Assigning the same kind of hook more than once **silently overwrites** (a cache issue) — merge related hooks into one
- After saving the original reference, call it with the original `this`
- Prefer printable ASCII output, then fall back to hex; cache string constants; detach a selective hook when finished
- A client-side hook cannot forge a **server-side** attestation result (Play Integrity and similar) — for a server-checked result, write only "cannot bypass", never a fake success
