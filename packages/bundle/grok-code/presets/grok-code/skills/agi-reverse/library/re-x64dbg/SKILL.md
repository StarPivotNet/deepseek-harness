---
name: re-x64dbg
description: >
  x64dbg debugging (Windows): attach, breakpoints, Scylla.
  Triggers: x64dbg, `Windows调试`, Scylla
capabilities: [debugging]
---

# x64dbg dynamic debugging (Windows)

## When to use / when not to use

- Use: dynamic debugging of a native Windows target (PE); attach/launch/breakpoints/memory search; Scylla IAT repair after unpacking
- Do not use: a Linux target (use [[re-gdb]]); a macOS target ([[re-lldb]]); analysis inside WSL (cannot attach across the boundary; see the WSL branch of [[re-analyze/platform-tips]])
- Do not use: read-only memory with no interaction (on the Windows side use procdump/DumpIt + Volatility; see the Windows branch of [[re-analyze/platform-tips]])
- Do not use: UI-less automated batch runs / a large amount of scripted operation (hand the heavy work to the command box and scripts; see [[commands]])
- Use: a verification scene that needs register/memory-level evidence (an authorization-check path, the decrypt moment, call arguments). Dynamic conclusions land in [[re-analyze/analysis-contract]]

## Tool setup

Follow the Windows branch of [[re-analyze/platform-tips]] — attach needs administrator privilege. The memory-dump toolchain is procdump/DumpIt.

### x64dbg

- Download: GitHub `x64dbg/x64dbg` release (unzip the zip and it runs; x64dbg.exe; x32dbg.exe in the same package handles 32-bit targets)
- Windows: `choco install x64dbg`
- Verify: open x64dbg.exe, `File > Open` loads any exe and stops at the entry
- Version: 2023 v1.0 is the only formal stable release. From 2025.06.30 the major version switched to CalVer (type system rework, AVX-512, script engine rewrite). Snapshot builds (dev rolling) are newer than release but have regression risk — formal analysis uses release. Details are in [[gotchas]]
- Three UI pieces: the CPU view (disassembly/registers/memory/stack, four panes), the command box at the bottom (expressions + commands; see [[commands]]), and view switching Alt+C / Alt+M / Alt+B and so on

### Scylla (IAT repair plugin)

- Built into recent official x64dbg releases (Scylla is under the plugins/ directory; Ctrl+I opens it)
- Standalone: GitHub `NtQuery/Scylla` release
- Verify: Scylla appears in the x64dbg plugin menu, can Attach to a process, and lists modules

### OllyDbg (old 32-bit)

- Download: the official site ollydbg.de (32-bit only; the main tool before x64dbg)
- Verify: opening and loading a 32-bit exe works
- Note: plugins/scripts/databases are not shared with x64dbg (see [[gotchas]])

## Steps

1. **Two modes, attach and launch (pick the entry method first)**:
   - Launch (`File > Open` / F3 / drag the exe onto the window): the debugger takes over from process creation and stops at the system breakpoint (ntdll) by default. `Alt+F9` runs to user code
   - Breakpoint timing: the `Options > Settings > Events` tab can check System/Entry Breakpoint, System/User TLS Callbacks, DLL Load/Unload, Thread Create/Exit, and Exit Breakpoint — when you need to break logic before the entry (TLS callbacks, constructors, DLL load), turn the matching event on here. A miss cannot be replayed
   - Attach (`File > Attach` / Alt+A, administrator privilege): the process is already running, and early initialization has already executed — anti-debug / anti-attach logic may already have run, and a miss cannot be recovered. After attaching a multi-threaded process, F12 to pause before setting breakpoints, to avoid a thread race. End with `detach`/Alt+F2
   - A windowless service / background process: after attach, filter by process name/pid
   - Static first look before dynamic work: [[re-triage]] hash/packer identification → [[re-format-pe]] looks at section permissions and the entry — this decides where breakpoints go, and whether anti-debug must be handled first
   - Attach failure (privilege/protection) is pitfalls 1 and 3

2. **Breakpoint family**:
   - `F2` is a software breakpoint (INT3) at an address/symbol. `Shift+F2` is a conditional breakpoint, for example `[401000]==0x90` (only when the memory value matches), `eax==0x1000`. The breakpoint window `Alt+B` manages them (Space enables/disables, Delete removes, double-click edits the condition/log)
   - Hardware breakpoint: right-click the selected line > Hardware breakpoint (execute/read/write), or the command `bph` — uses DR registers, at most 4, can break on data access, and does not modify code bytes (resists an integrity check)
   - Memory breakpoint: `Alt+M` memory window, right-click the selected region > Set Memory BPX (fires on access/write, implemented with GUARD_PAGE) — commonly used to catch the key-decrypt moment and a packer's self-decrypt code
   - Log/command breakpoint: right-click in the breakpoint window and set a log expression and a hit command. It does not break, it only records — bulk verification of call arguments
   - If a breakpoint does not hit, check module load first: `Alt+E` module window shows whether the target module is loaded. A breakpoint that survives a reload uses the `API name` or `module.function` form (for example `bp kernel32.VirtualAlloc`), and takes effect again after the module reloads

3. **Run and trace combinations**:
   - `F9` continues. `F4` runs to the cursor. `Ctrl+F9` runs until the function returns (pair with `F8` to skip a call and leave the function quickly). `Alt+F9` runs to user code (from a system breakpoint / library code back to the user module). `F12` pauses. `Ctrl+F2` restarts the session
   - `F7`/`F8` single-step (step into / step over). `Shift+F7`/`Shift+F8` single-step but skip exceptions (use when system APIs raise many internal exceptions)
   - Conditional trace: the commands `ticnd <condition>` / `tocnd <condition>` single-step continuously until the condition holds — automatically walk a decrypt loop / search for a specific state. A trace record (`opentrace` plus running) can replay the instruction stream
   - Command-line combinations are in [[commands]] (`bp`/`bph`/`bpm`/`find`/`savedata` and similar, typed in the bottom command box)

4. **Memory window and search**:
   - `Alt+M` opens the Memory Map: section permissions (an abnormal RWX = packer/decrypt section), module list
   - Search: `Ctrl+B` binary pattern (for example `55 8B EC`, `?` wildcards supported), `Ctrl+F` find in the current view, `Shift+D` strings inside the module
   - Location flow: string/constant → `Ctrl+R` find cross-references → breakpoint at the reference / walk up to the caller — a check compare point and a decrypt function both start from "who references this"
   - The Dump window `Ctrl+G` jumps to an address. `Ctrl+E` edits memory (change bytes to bypass a check)
   - Export: the command `savedata <file> <address> <size>` saves a memory range. `minidump <file>` generates a full-memory dmp for [[re-mem-forensics]]

5. **Registers and the call stack**:
   - Change values directly in the register window (right-click to change EAX/EFLAGS and similar) — changing the return register (`EAX=0`) or a flag is the fastest branch rewrite
   - `Alt+K` call-stack window: walk the return-address chain and locate "who called here". The stack pane shows locals/arguments (x64 passes arguments in RCX/RDX/R8/R9; on the stack they start at [rsp+0x28])
   - Breakpoint the call target (`bp <API name>`) and look at the arguments. That is the most direct path to sorting out crypto/check calls

6. **Anti-debug bypass**:
   - Right-click the register window and change flags such as EFlags/ZF
   - Break `IsDebuggerPresent`/`NtQueryInformationProcess` → change the return register (`EAX=0`) then `F9`
   - Timing-delta / execution-count class: breakpoint the compare instruction and change the compare registers
   - Locate the check point statically first ([[re-ida]] / [[re-format-pe]] find check-API references and feature strings), then pick a bypass: change a return value/flag at a single point, hide in bulk with ScyllaHide, or statically patch the check point directly — the order is "the point first, the suite later". Turning on the whole toolkit does not produce a targeted result
   - The anti-debug plugin ScyllaHide (install from the x64dbg plugin manager) hides debugger traces in bulk. Boundaries and cases that cannot be bypassed are in [[gotchas]]

7. **Scylla repairs the IAT (after unpacking)**:
   ```
   Plugins > Scylla (Ctrl+I) → fill in the OEP → IAT Autosearch → Get Imports → Dump → Fix Dump
   ```
   - Flow: run inside the packer to the OEP (look at stack/memory features that are already decrypted, or set a hardware breakpoint on the OEP) → `Ctrl+I` opens Scylla → the OEP field is a full VA (it is usually auto-filled as entry point + ImageBase; a hand fill is also a VA, not an RVA) → `IAT Autosearch` (normal and advanced modes; try both when the results differ) → `Get Imports` checks the imports → `Dump` saves the process image → `Fix Dump` selects that dump file and writes the repaired clean exe (`*_SCY.exe`)
   - Failure shape: a log line `IAT not found at OEP ...` = the OEP was filled wrong. Go back to the debugger, confirm the real OEP, and start again. Red invalid items after Get Imports can be deleted with Cut thunk. A dump file that will not run directly is normal — without Fix Dump there is no IAT
   - Compare the repaired file's sha256 with the original and archive it (see [[re-triage]])

8. **Patch and save (persist a check bypass)**:
   - `Ctrl+E` changes bytes or `Space` assembles in place → `View > Patches` (Ctrl+P) shows the change list → `Save file` writes a new exe back to disk / `Save patch` exports a `.1337` patch file (it can be distributed and reused)
   - Record the original bytes before the patch. Roll back with `Undo selection` (Ctrl+Backspace). Patch-location methodology is in [[re-patching]]

9. **Evidence check (closeout)**: breakpoint-hit records / register and memory evidence (view with `Ctrl+E` and archive), `savedata`/`minidump` export products, the Scylla-repaired file sha256 — compare all of them with the [[re-triage]] first-look values and archive them. Write the conclusion in [[re-analyze/analysis-contract]]

## Related skills

- [[re-binary-core]]: workflow step 6 (the Windows debugger)
- [[re-anti-analysis]]: the core tool for unpacking (run to the OEP + Scylla repair)
- [[re-cracking]]: locate registration-code / check logic
- [[re-imports]]: compare IAT completeness after Scylla repair
- [[re-patching]]: persist a patch after debugging confirms the check point
- [[re-triage]]: sample hash / first look comes first, and debug conclusions are compared with it
- Complementary to [[re-memdump]] (procdump is the Windows-side fallback); see [[re-analyze/platform-tips]]

## Pitfalls

- **Administrator privilege is required**: attaching a high-privilege process/service fails — start x64dbg as administrator. If it still fails, check for a protected process
- **Anti-debug / anti-attach**: `ThreadHideFromDebugger`/`NtSetInformationThread` or a network-disconnect check — hide debugger traces with the ScyllaHide plugin, or statically patch the self-check point first
- **A PPL process cannot be attached** (Protected Process Light, such as some EDR/system processes) — x64dbg has no driver and cannot attach. Switch to kernel debugging or drop that target
- **Bitness must match**: a 64-bit target must use x64dbg (x32dbg supports only 32-bit). Mixing them fails to load or crashes
- **On attach failure, separate privilege from PPL/a protected process first**: symptom — x64dbg run as administrator still fails to attach; cause — an ordinary privilege limit is solved by administrator, while PPL (Protected Process Light) depends on the Signer Level (EDR commonly uses PPL-Windows TCB/Antimalware), and a non-matching level cannot attach; fix — first confirm whether the target is PPL (the Protection column in Process Explorer) and its Signer Level, then prepare the matching debug capability for that level (a same-level driver / kernel debugging). See the Windows branch of [[re-analyze/platform-tips]]
- **The program crashes only under x64dbg → check debugger-feature detection**: symptom — the sample is normal in its native environment and normal under another debugger, and only crashes or jumps behavior after x64dbg loads/attaches; cause — the sample detects debugger features (x64dbg module / window class / DLL name / memory features) and, once it recognizes x64dbg, crashes on purpose or switches logic; fix — find the feature string / window class name / module name statically first ([[re-ida]] / [[re-format-pe]]), patch the feature-check point or hide x64dbg traces (ScyllaHide), then load again (see anti-debug methodology AD31 in [[re-anti-analysis]])
- **Hardware breakpoints are detected (DR registers)**: symptom — after a hardware breakpoint / memory breakpoint is set the process exits immediately, or the breakpoint does not fire; cause — the sample reads the debug registers (DR0-DR3/DR6/DR7) to detect hardware breakpoints; fix — hide with ScyllaHide injection (HookLibrary/InjectorCLI), or switch to a logical breakpoint to avoid DR traces. When needed, statically patch the DR check point before attach (see anti-debug methodology AD15 in [[re-anti-analysis]])
- **A breakpoint is set and does not hit**: first `Alt+E` to confirm the module is loaded and the address lands on the post-load base. A rewritten code section (packer decrypt) overwrites INT3 — set the breakpoint again after decrypt finishes
- **The analysis blind spot of attach mode**: logic before the entry (TLS callbacks, constructors, decrypt initialization) has already executed at attach time — registration/initialization-class logic must use launch mode + Events breakpoints. Do not look inside attach mode for a process that is no longer there
- **A Scylla dump product that "will not run" is not a failure**: a dump file that was not Fix Dump'd has no IAT, and running it directly must crash. If it still crashes after repair, check invalid import items and whether the OEP is correct
- Version differences, Scylla details, and anti-debug bypass boundaries (including cases that "cannot be bypassed") are in [[gotchas]]
