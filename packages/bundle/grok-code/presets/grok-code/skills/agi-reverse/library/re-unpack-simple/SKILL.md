---
name: re-unpack-simple
description: Compression-packer unpacking: UPX/ASPack/FSG. Triggers: `脱壳`, unpack, UPX, `esp定律`, OEP
capabilities: [unpack]
---

# Unpacking: compression packers (UPX/ASPack/FSG)

## When to use / when not to use

- Use: [[re-packer-id]] identifies a simple compression packer (UPX/ASPack/FSG and similar); the packer entry has a `pushad`/`pusha` feature; you need a clean sample to continue static/dynamic analysis
- Use: the first manual attempt on an unknown packer (the ESP law works on most compression packers)
- Do not use: a strong packer / virtualizing packer (VMProtect/Themida; switch to [[re-unpack-advanced]])
- Do not use: the target is already confirmed unpacked (go straight to [[re-binary-core]])
- Do not use: you need to observe packed behavior itself (behavior analysis sometimes deliberately keeps the packer; judge that when pairing with [[re-behavior]])
- Note: verifying the unpack product must be in a sandbox ([[re-sandbox]], top rule in [[re-analyze/platform-tips]])

## Tool setup

### upx (primary official unpacker)

- Linux: `apt install upx-ucl` / `dnf install upx` / `pacman -S upx`
- macOS: `brew install upx`
- Windows: download the win64 zip from the official GitHub release `upx/upx` (or `choco install upx`)
- WSL: the Linux package
- Verify: `upx --version`

### Debugger (by OS)

- Debug a PE under Linux / Wine: [[re-gdb]] — `apt install gdb` / `dnf install gdb` / `pacman -S gdb`, verify `gdb --version`. **Wine direct read**: after `wine sample.exe` runs, `gdb -p <pid>` attaches and operates on the Wine process directly (see the Linux branch of [[re-analyze/platform-tips]])
- Windows: [[re-x64dbg]] — official release zip. Verify: loading the sample can single-step
- macOS: a PE unpack scene uses Wine + [[re-gdb]] or a Windows VM, not the local debugger
- WSL: cannot attach a Windows process. Cross the boundary with Windows-side tools (WSL branch of [[re-analyze/platform-tips]])

### Scylla (Windows IAT repair)

- Built into recent official x64dbg releases (Scylla is under the plugins/ directory)
- Standalone: GitHub `NtQuery/Scylla` release
- Wine: the standalone Scylla can attach a Wine process and repair the dump (if it fails, finish IAT repair in a Windows environment)
- Verify: Scylla appears in the x64dbg plugin menu, can Attach to a process, and lists modules

## Steps

Run in order. Record each step's result (evidence path + sha256; see [[re-triage]]). **Before you start, record the five-item unpack baseline per [[re-triage]]** (SHA256 / PE timestamp / EP RVA / section hash / import table). Compare item by item after unpacking before judging success or failure.

1. **Prefer the official / automatic unpack (`upx -d`)**:
   ```sh
   upx -d sample.exe -o unpacked.exe
   file unpacked.exe     # should show a normal PE structure; still reports UPX / errors → failure
   sha256sum unpacked.exe
   ```
   Common reasons `upx -d` fails: the file was modified (self-check / packed a second time), or the UPX version is incompatible. On failure, take the manual flow in step 2.

2. **ESP law to find the OEP** (set the break after pushad):
   - Principle: the compression-packer entry `pushad` saves registers → after the packer finishes decrypting, `popad` → `jmp OEP`. **Set a hardware access breakpoint on the address ESP points at after pushad**. After running, look for the OEP near the first instruction after `popad`.
   - **What it really is (a technique, not an unpack formula)**: the entry `pushad` push is the packer's necessary "save context" behavior. The ESP law uses it to locate the "restore context" point — after `popad` restores, decrypt is done and control flow is about to jump to real code. It holds only for the implementation "entry pushes to save context, the tail restores and then jumps". It is not valid for every packer: a TLS-callback packer (the callback runs before the EP, and there is no pushed context at the EP), a multi-threaded packer (each thread pushes its own stack, and the breakpoint hits a misaligned stack address), and virtualizing packers such as VMProtect/Themida (the entry goes straight into the VM dispatcher, with no pushad/popad cycle) do not apply. **Confirm the EP entry really is a pushad/popad cycle before using it**. Otherwise go straight to step 3 or switch to [[re-unpack-advanced]].
   - x64dbg (Windows): load → stop at the EP → single-step until you see `pushad` → single-step through `pushad` → record the ESP value **after pushad executes** → right-click the ESP register → Hardware Breakpoint (on access) → run → break on the first instruction after `popad` → the target of the `jmp` a few lines below is the OEP. Write down the OEP address.
   - gdb (Linux/Wine; see Wine direct read in [[re-analyze/platform-tips]]):
     ```
     (gdb) starti                    # stop at the EP
     (gdb) si                        # single-step through pushad (x86 pushad pushes 8 registers)
     (gdb) awatch *(int*)$esp        # hardware watchpoint on the address ESP points at after pushad (break on access)
     (gdb) continue                  # run; fires when popad accesses that address
     ```
   - OEP features: a function prologue (`push ebp; mov ebp,esp`), followed immediately by many normal API references.

3. **Memory-breakpoint method (VirtualAlloc breakpoint)**:
   - Applies when: the ESP law fails (no pushad, multiple stubs, multi-stage decrypt).
   - **Idea (execution watch on the decrypted region)**: the packer writes the real code, once decrypted, into some region (the decompress target section / a VirtualAlloc region). Set an execute/access watch on that region. Break when packer control flow first lands on the decrypted code — that is **the real-code entry after decrypt finishes**. You do not need to guess "which address the OEP is at".
   - **"First execution is the OEP" does not hold**: some packers jump to a loader first (the packer's own runtime), decrypt in stages (the first execution is still an intermediate layer, with another decrypt loop after it), or plant a fake OEP (a fake function prologue that tempts an early dump) — after the break you must verify the target has real-code features (function prologue `push ebp; mov ebp,esp` plus dense normal API references afterward). For a multi-stage packer, set the break again until control flow stably leaves packer code, then enter step 4.
   - x64dbg: `bp VirtualAlloc` → after each return, see whether the allocated region was written with executable content (the packer's decompress target section) → set a memory-access breakpoint on that region (View > Memory Map > target section > Set breakpoint on access) → run to where the packer finishes decrypting. You can also set a memory breakpoint directly on the packer's second section (UPX1/.aspack).
   - gdb (Wine): `break *VirtualAlloc`. After return, inspect the allocated region, then watch the allocated address.

4. **Dump the OEP** (timing: after decrypt finishes; see the key experience in [[re-analyze/platform-tips]]; default dump first):
   - Linux/Wine: after running to the OEP (decrypt finished), default dump `gcore -o out <pid>` (full flow is in [[re-memdump]]; before the dump, filter vsyscall/vdso from maps).
   - Windows: x64dbg runs to the OEP → `Plugins > Scylla > Attach to process` → fill in the OEP address (the value recorded in step 2) → `Dump`. Record the image base + OEP offset first.
   - **Do not dump before the packer finishes decrypting** — what you get is the packer's initial state (see pitfall 1).

5. **IAT repair (Scylla/ImpREC)**:
   - x64dbg: `Plugins > Scylla > Attach to process` → fill the OEP with the address from step 2 → `IAT Autosearch` → `Get Imports` (check that API resolution is correct) → `Fix Dump` writes `unpacked_fixed.exe`.
   - Alternative: ImpREC (Windows, an older tool) uses the same flow: Open Process → IAT AutoSearch → Fix Dump.
   - Verify after repair: `file unpacked_fixed.exe` → import into [[re-ghidra]] / [[re-ida]], decompile, and confirm the import table resolves → rerun inside a sandbox ([[re-sandbox]]) and confirm behavior matches the pre-unpack run and no self-check fires.

## Related skills

- [[re-anti-analysis]]: workflow step 3 (simple-packer branch) always calls this skill
- Called from the triage "sample is packed / unpack" path of [[re-analyze]] (re-anti-analysis → re-unpack-simple)
- [[re-malware]]: a packed malicious sample (UPX and similar) is unpacked, rerun in the sandbox, then behavior-analyzed
- [[re-mobile]] / [[re-apk]]: some Android hardening packers can be compared to this flow's idea (a specific hardening packer follows [[re-frida]] / [[re-memdump]] in-memory DEX extraction)
- [[re-crypto-decrypt]] / [[re-crypto-keys]]: when decrypt / keys are inside the packer, unpack first (dump after the OEP; see dump timing in [[re-memdump]])
- Companions: [[re-memdump]] (default dump), [[re-gdb]] / [[re-x64dbg]] (debuggers), [[re-sandbox]] (rerun the unpack product to verify)

## Pitfalls

- **Dumping too early = the packer's initial state**: symptom — after the dump, `file` still reports UPX, and decompilation shows only compressed data; cause — the dump happened before the packer ran to the OEP and finished decrypting; fix — dump **after decrypt finishes** (key experience in [[re-analyze/platform-tips]]). Default dump first
- **IAT not repaired → the import table is garbage**: symptom — the unpacked sample's decompilation is full of `GetProcAddress` dynamic calls, and import-table parsing fails; cause — the import table is rebuilt by the packer at runtime, and the dump was not repaired; fix — repair with Scylla/ImpREC in step 5, then decompile again and verify
- **Self-check (CRC) → a patch is needed after unpacking**: symptom — the unpacked sample exits as soon as it runs in the sandbox / pops a check failure; cause — the program compares its own bytes (under the original packer those were compressed data, and they no longer match after unpacking); fix — locate the check code (xref the image base / the CRC function), patch it to skip or hook it. Do the verification inside a sandbox
- **Wrong debugger in a Wine environment**: symptom — a Windows debugger fails to attach under Wine / breakpoints do not fire; cause — Wine is a Linux process and needs the Linux debug path; fix — Wine direct read per [[re-analyze/platform-tips]]: `gdb -p` attaches the Wine process, reads memory, sets breakpoints, and `gcore` dumps
- **A two-layer compression packer → the ESP law is used twice**: symptom — after the ESP law breaks you are still in an unpack layer, the dump is still packer code, and after `upx -d` peels one layer `file` still reports packer features; cause — packer inside packer (for example ASPack v2.12 still has another layer decrypting the IAT after the first layer finishes); fix — keep watching after the first layer lands: another pushad/popad cycle, or `VirtualFree` releasing the IAT decrypt heap, is the last step. Follow to the final `jmp` and verify the target is a real code prologue (`push ebp; mov ebp,esp` plus dense normal API references) before the dump. Do not jump one early, before the transitional jmp
- **Searching FF 25 for the IAT is unreliable**: symptom — a tutorial's binary search for `FF 25` (indirect jmp) to find the IAT start finds nothing or the wrong place; cause — not every program calls APIs through an indirect jump (a direct `CALL [addr]` is common); fix — use the debugger `Find > All intermodular calls` to locate one real program call site, follow `CALL/JMP [addr]` to the top of the jump table, compute the IAT start and block size, then fill ImportREC/Scylla
- **PE header fields not repaired after the dump → load fails**: symptom — after IAT repair the sample still will not open / "invalid Win32 application" / crashes on load; cause — the dump tool did not repair `SizeOfImage`/`NumberOfSections`/`SizeOfHeaders`, or each section's RVA/raw range does not match SectionAlignment/FileAlignment, or LordPE/ImportREC fails on Win7+ because of ASLR; fix — if it is still abnormal after Fix Dump, use pefile to check and correct those fields one by one, and if needed turn off a random base and dump again. `CheckSum` is not in this class — an ordinary user-mode EXE/DLL is not checked at load time. Only drivers, DLLs loaded during boot, and DLLs loaded into critical system processes need a recompute
- **A crash after the dump ≠ unpack failure**: symptom — IAT repair is done and decompilation looks normal, but it still crashes/exits, and that is misread as unpack failure and abandoned; cause — besides the IAT it depends on other mechanisms: TLS callback (the packer resets parameters / decrypts data in the callback), the relocation table (base relocation under ASLR was not handled), the exception table (the SEH chain was rearranged by the packer), Load Config (security cookie / GS check points at packer data); fix — check the TLS callback table, relocation directory, exception directory, and Load Config directory one by one per [[re-format-pe]], and repair whichever is missing. The unpack-success criterion is that code/imports/relocations/exception mechanisms are complete (see [[re-unpack-advanced]]), not "it does not crash" or "the IAT was repaired"
- **Forcing the ESP law as a formula**: symptom — applying the ESP law to a TLS-callback packer / multi-threaded packer / VMProtect, the hardware breakpoint does not fire or stops at a misaligned stack address, and hours of retries produce nothing; cause — "entry push finds the restore point" was treated as a universal formula, but it only applies to a single-threaded compression packer whose entry is pushad; fix — confirm the precondition before you start (the EP entry really is a pushad/popad cycle). Otherwise go straight to the step 3 memory-breakpoint method / switch to [[re-unpack-advanced]]. Do not spend time on the formula
- **Treating "first execution of the decrypted region" as the OEP and dumping immediately**: symptom — the first memory-breakpoint hit is dumped, and what you get is the packer loader / a fake OEP; decompilation is still packer code; cause — the packer jumps to a loader first, decrypts in stages, or plants a fake OEP. First execution ≠ decrypt finished; fix — after the break, verify real-code features first (function prologue + dense API references). For a multi-stage packer, set the break again until control flow is stable
- **A Wine unpack failure is not necessarily a wrong flow**: symptom — the full flow is followed under Wine, breakpoints do not fire / the packer runs abnormally / the decrypt result is scrambled; cause — a Wine environment problem, not a flow problem: a packer-dependent API is missing, a packer driver component cannot load, anti-virtualization detection (Wine-specific API/registry/process name), or environment detection (OS version/hardware features) makes the packer refuse to decrypt normally; fix — locate the failure point first: `WINEDEBUG=+loaddll` for the load-failure log, and break `GetVersionEx` / registry reads to see whether an environment check hit. Once it is confirmed to be a Wine environment limit, **switch decisively to a Windows VM** ([[re-sandbox]]) to finish the unpack. Do not keep wrestling inside Wine
