# lldb tool-specific pitfalls and boundaries

## macOS permission stack (attach prerequisite; check layer by layer)

- **TCC (Privacy & Security > Developer Tools)**: attach from an unauthorized terminal reports `permission denied` or fails silently — authorize it by hand in System Settings and restart the terminal; the prompt cannot be bypassed from the command line
- **DevToolsSecurity**: older systems (before 10.14) also need `sudo DevToolsSecurity -enable`; on newer systems this command is no longer required
- **task_for_pid entitlement**: the debugger process needs task_for_pid permission — under an ordinary terminal, lldb depends on the Developer Tools authorization chain. Jailbreak/enterprise environments have another path (the [[re-mobile]] domain)
- **Hardened Runtime**: when the target has Hardened Runtime enabled (macOS 10.14.4+), debug APIs are restricted (for example `get-task-allow` is missing) — re-sign the target first (`codesign -f -s -`, or with the `com.apple.security.get-task-allow` entitlement; see [[re-format-macho]])
- **SIP**: confirm with `csrutil status`; turning SIP off only affects attach to system-protected processes. An ordinary target does not need it touched
- Check order: TCC authorization → DevToolsSecurity → csrutil → target signature/entitlement — exclude layer by layer. Do not turn SIP off first

## Version differences

- **Xcode lldb vs llvm.org lldb**: the version bundled with Xcode is not in sync with upstream llvm (the version numbers differ a lot); the lldb from `brew install llvm` is newer than the system build, and features/APIs are newer — script dependencies follow the actual version
- **Swift toolchain lldb**: best support for Swift expression evaluation; a reversing scenario with no Swift need can use the system/llvm build
- **Python API compatibility**: the `lldb.SBDebugger` API is mostly stable across versions but occasionally gains or loses pieces — an `lldb -s` batch script is more stable across versions than a Python script
- **Distro lldb on Linux lags**: the lldb from apt/dnf/pacman lags upstream — when you need a new feature, use the official llvm.org binary or brew

## Debug-behavior pitfalls

- **Expression evaluation has side effects**: `expr` really executes code (calls functions, writes memory, triggers message sends) — evaluating carelessly at a hook point can change target behavior or even crash it; read-only verification uses `frame variable`
- **A conditional breakpoint never hits**: when the condition references an unloaded symbol/type it fails silently — break unconditionally first and confirm it stops, then add conditions step by step
- **ASLR base drift**: macOS randomizes the base by default — after every `run`, the `image list` base changes; a hardcoded address in a script stops working. Use a symbol breakpoint or convert with `image list -o`
- **A stripped target has no `-n` breakpoint**: `breakpoint set -n` cannot find the symbol — use `image lookup -a` to look the address's owner up backward, or try luck with `-rn`; an address breakpoint + `image list -o` conversion
- **`memory read` format conflict**: mixing widths/formats reports `invalid format` — pass them as an explicit group, `-s 4 -f x`
- **The target freezes after attach**: after attach the target pauses by default (SIGSTOP) — `continue` is what resumes it; forgetting continue makes it look hung
- **wow64-class case (a 32-bit target)**: a 64-bit lldb debugging a 32-bit macOS target is normal (the system bundles 32-bit support), but `expr` pointer width is computed as 64-bit — write expressions for the target's bitness

## Anti-debug and boundaries

- **ptrace detection**: the target can call `ptrace(PT_DENY_ATTACH)` and refuse attach (refused at start) — locate it statically first ([[re-format-macho]] / [[re-ida]] find the ptrace call), patch it out, then debug
- **Debugger-feature detection**: `sysctl` / `task_info` enumerates debug flags — handle the check points statically first (see [[re-anti-analysis]])
- **Kernel debugging has a high bar**: macOS kernel debugging needs a matching KDK version + development-kernel boot arguments — ordinary reversing is not worth it. Do not spend time on it on top of user-mode debugging
- **iOS remote debugging**: `platform select remote-ios` + debugserver needs a signature/jailbreak environment — environment problems belong to [[re-mobile]]. This skill only covers the command layer

## Usage notes

- Execute entirely inside a sandbox (top principle in [[re-analyze/platform-tips]]); attach needs Developer Tools authorization
- When the target is a malware sample, survey statically first ([[re-triage]] hash / [[re-format-macho]] structure) and then go dynamic
- Write conclusions into [[re-analyze/analysis-contract]]; cross-check symbol/address evidence against the [[re-triage]] survey
