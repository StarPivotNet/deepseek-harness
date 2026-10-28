---
name: re-patching
description: Patch authoring: byte-level patches and instruction rewrites. Triggers: `打补丁`, patch, `修改跳转`, `绕过验证`, crack
capabilities: [binary-patching]
---

# Patch authoring (byte-level patch / instruction rewrite)

## When to use / when not to use

- **Boundary (inherited from [[re-cracking]])**: only software you own, an authorized test, or a CTF / research environment. Do not unlock unauthorized software or bypass commercial software. **Work on a copy of the sample first** ([[re-ghidra]] / [[re-ida]] save a copy or export a temporary Program). Do not patch the original sample and break the evidence chain
- Use: the check site is already located from [[re-license]], and bytes must change to bypass the check or change behavior (unlock a feature, skip a check)
- Use: the check algorithm is not reversible (a hash / asymmetric signature check), so this replaces a keygen (see pitfall 1 of [[re-keygen]])
- Use: a distribution case (the patch file is small, and the original file is not redistributed)
- Do not use: the check sites are not located yet (do [[re-license]] first)
- Do not use: a legitimate serial is needed for a paying user (the algorithm is reversible → [[re-keygen]] is cleaner and does not modify the target)
- Do not use: only memory changes and nothing is written to disk (a session hook is [[re-frida]]; an unsaved debugger edit is not a patch)
- Note: the patched build must be verified in the sandbox ([[re-sandbox]], the top rule in [[re-analyze/platform-tips]]). Back up the original file before editing (see pitfall 1)

## Tool setup

### Hex editor

- Linux: `apt install hexedit` / `dnf install hexedit` / `pacman -S hexedit`; check `hexedit --version` (interactive; F2 saves)
- Windows: HxD (official free download; the portable build needs no install); or 010 Editor (commercial, strong template parsing)
- macOS: `brew install hexedit`
- WSL: the Linux build inside WSL; edit a file that crosses the boundary with HxD on the Windows side (the WSL branch of [[re-analyze/platform-tips]])

### Debugger (by OS; locate the patch site / confirm branch direction)

- Linux / debugging a PE under Wine: [[re-gdb]] — `apt install gdb`; check `gdb --version`. **Wine direct read**: after `wine sample.exe`, attach with `gdb -p <pid>` (the Linux branch of [[re-analyze/platform-tips]])
- Windows: [[re-x64dbg]] — the official release zip; check: the sample loads and can single-step (attach needs administrator rights, the Windows branch of [[re-analyze/platform-tips]])
- macOS: [[re-lldb]] (`brew install lldb`); a Windows target uses Wine + gdb or a VM
- Role: break and confirm the real direction of the success / failure branch, so the wrong branch is not edited (see pitfall 2)

### rizin (`wx` writes bytes; the command-line patch workhorse)

- The install matrix is in [[re-radare2]] (it differs by distro: the Debian/Ubuntu distro repos have no rizin package, so `apt install rizin` fails; use an official release binary or `rz-pm`)
- Check: `rizin -v`
- Write syntax: `wx 90 @ 0x401234` (write one byte `0x90` at 0x401234), `wx 909090 @ 0x401234` (write three in a row)

### Patch-file tools (export a diff / patch)

- `rz-diff` (ships with rizin; binary diff) / `radiff2` (ships with radare2; command-compatible)
- `bsdiff` / `bspatch`: Linux `apt install bsdiff` / macOS `brew install bsdiff`; check `bsdiff -h`
- `xdelta3`: Linux `apt install xdelta3`; check `xdelta3 -V`
- Windows side: `llvm-objdump` (the LLVM suite) to compare the original byte range

## Steps

Run in order and record each result (original bytes → new bytes → offset; evidence paths are in [[re-triage]]). **Before editing, `cp sample.exe sample.bak` and archive `sha256sum`** (see pitfall 1).

1. **Locate the patch site (a failure jump → change jz / jnz)**:
   - Take the address from the check-site list in [[re-license]]. Decompile and confirm the instruction shape at that site: a **failure jump** (`jz fail` / `jnz fail` after a compare) is the branch that leaves immediately when the check fails
   - Confirm the direction dynamically (inside the sandbox): break on that branch in the debugger, run once with a wrong serial, and watch the jump and the flags ([[re-gdb]] / [[re-x64dbg]]) — confirm "which condition to change, and where it jumps" before treating it as the bypass (see pitfall 2)
   - Record: the patch address, the original bytes, and the target shape (for example `jz 0x401300` → `nop`)

2. **Byte edits (nop / jump rewrite)**:
   - Invert a conditional jump: `jz` ↔ `jnz` (x86 short jump `74` ↔ `75`, near jump `0F 84` ↔ `0F 85`); an unconditional jump `EB` (rel8) / `E9` (rel32) lands directly on the success path
   - Skip the check: `nop` the decision (`90`); or make the check function return success immediately: replace the opening `push ebp` with `mov eax,1; ret` (`B8 01 00 00 00 C3`, adjusted for stack balance)
   - rizin write mode:
     ```
     rizin -w sample.exe
     [0x00401000]> wx 90 90 @ 0x00401234            # nop 掉两个字节的失败跳转
     [0x00401000]> wx 0f 85 00 00 00 00 @ 0x00401230 # jz(0F84) 改 jnz(0F85)，注意 rel32 需重算
     [0x00401000]> q
     ```
   - hexedit direct edit: `hexedit sample.exe`, Ctrl+S to jump to the address → edit the bytes → F2 to save
   - **The jump-target offset must be recomputed**: after rewriting a conditional jump (especially rel8 → rel32), re-encode the target address (see pitfall 5)
   - Immediately after the edit, `sha256sum sample.exe` and archive the intermediate product

3. **Checksum / self-check handling**:
   - Symptom: the patched build exits on launch / pops "file is corrupt" (see pitfall 3)
   - Locate: a function that xrefs its own image base / the start of a data section, or a search for CRC32 / MD5 computation calls (import-table `CheckSumMappedFile` and similar); decompile and confirm what is compared (file bytes vs an expected value)
   - Handle: patch the self-check function to skip (same idea: change the decision branch / `mov eax,1; ret` to return early); or recompute the checksum from the new bytes and write it back
   - Note: patch the self-check first and then the target logic, or do both and then fix the checksum once — order does not change the result, but re-run in the sandbox after every step

4. **Export the patch (binary diff / patch file)**:
   - Build the patch: `bsdiff sample.bak sample.exe sample.patch` (at distribution time `bspatch sample.exe sample_patched.exe sample.patch`); or `xdelta3 -e -s sample.bak sample.exe sample.patch`
   - Record the patch inventory (address → original bytes → new bytes). `rz-diff -D sample.bak sample.exe` prints a byte-by-byte diff for the report (radare2 uses the equivalent `radiff2 -D`)
   - Cross-version fit: generate a separate patch per version and mark the version on the inventory (see pitfall 4)

5. **Other architectures (ARM `B` and the rest)**:
   - ARM32: unconditional `B` = `EA` followed by a 24-bit offset; conditional `BEQ` = `0A`, `BNE` = `1A` (swap them to invert); `NOP` = `00 00 A0 E1` (the condition prefix can be adjusted)
   - Thumb: a short `B` encodes from `E000`; invert a conditional branch by changing the high nibble of `cond` (`D0` EQ ↔ `D1` NE)
   - AArch64: `B` = `0x14000000 | (imm26 << 0)` (±128MB); `B.EQ` = `0x54000000 | (cond<<12)` (EQ is cond=0x0); `NOP` = `D503201F`
   - Disassemble with [[re-ghidra]] / [[re-radare2]] and confirm the original encoding of the target instruction before writing; after the edit, disassemble again and confirm the instruction still parses
   - Android packers / so-layer checks: unpack first ([[re-anti-analysis]] / [[re-memdump]]), then patch the unpacked product (see [[re-mobile]])

**Check**: record the product with `sha256sum` → re-run inside the sandbox ([[re-sandbox]]) — the patched build must pass **every** check site (the [[re-license]] list), and functional behavior must match the original sample; then statically decompile and confirm the instruction shape at the patch site.

## Cross-domain handoff

- [[re-cracking]]: this gateway is step 4 of the re-cracking workflow (the patch). Step 6 is the shared verification
- [[re-license]]: upstream — patch sites come from its check-site list (address + branch direction)
- [[re-keygen]]: alternatives — a reversible algorithm prefers a keygen; an irreversible check or a fast bypass uses this skill
- [[re-anti-analysis]]: unpack a packed sample first (locate the patch site after OEP); self-checks / anti-tamper often stack with the packer
- [[re-binary-core]]: the decompiler workbench (Patch Instruction in [[re-ghidra]] / [[re-ida]] / [[re-radare2]] can also write directly)
- Dynamic: [[re-gdb]] / [[re-x64dbg]] / [[re-lldb]] (confirm branch direction), [[re-frida]] (a session hook that is not written to disk)
- [[re-sandbox]]: re-run the patched build in the sandbox (the top rule in [[re-analyze/platform-tips]])
- [[re-ioc]]: patch-byte features / typical bypass patterns can be detection signatures

## Pitfalls

- **The wrong branch → broken behavior**: symptom — after the patch the startup check passes, but the program crashes / loops a dialog / misbehaves; cause — the edit was not the license decision (a business branch was changed), or the condition was inverted (a jump was written where a nop was required); fix — step 1 confirms the real branch direction dynamically first (run once with a wrong serial and watch the jump). Make the smallest edit (1-2 bytes). Verify each site before the next
- **A self-check detects the edit**: symptom — the patched build exits in the sandbox / pops "file is corrupt" / restarts forever; cause — the program compares its own bytes (CRC / file size / section checksum) and the patch no longer matches; fix — step 3 locates the self-check (xref the image base / search CRC calls) and patches it to skip, or recomputes the checksum. Keep the original bytes so you can roll back
- **A patch dies across versions**: symptom — the same patch does nothing or breaks the program on another version; cause — offsets moved between versions, or a version check; fix — step 4 exports a patch per version and marks the version. Before writing, confirm the bytes at the target address match the expectation (`xxd` / hexedit spot-check). A mismatch means the wrong version; do not force the write
- **Authenticode signature failure prompt**: symptom — Windows pops "publisher could not be verified / file is corrupt" when the patched build runs; cause — the patch broke the code-signing directory; fix — this is expected: the prompt can be ignored, or the signature can be removed. `pesign -S -i signed.exe` shows the signature count first (`-u N` selects the Nth). `pesign -r [-u N] -i in.exe -o out.exe` removes the signature and writes a new file (the original is kept). These are two different operations: `-r` rewrites the PE and removes the WIN_CERTIFICATE table entry; if the only goal is that the loader stops checking the signature, the PE Security data-directory entry (DataDirectory[SECURITY]) offset+size can be zeroed instead, and the certificate table stays in the file. Note that `-d` / `--digest-type` selects the digest algorithm for `--hash`; it does not delete a signature. A signature cannot be restored. Do not forge one
- **A wrong jump offset flies off**: symptom — the patched build crashes on launch / disassembly shows an undefined instruction; cause — a rewritten conditional jump (rel8 ↔ rel32) or `jmp` did not recompute the target offset (relative offset = target − address of the next instruction); fix — disassemble with rizin / Ghidra and confirm the instruction at the patch site parses and the jump target is correct. Prefer keeping the rel8 shape for a short distance; use rel32 only when it is out of range
- **A blind patch site / the entry shape was not checked**: symptom — writing a gadget at a fixed offset crashes or does nothing, even though the bytes are in place; cause — the entry word is not the standard prologue shape for that platform or runtime (for example a push-style function prologue), or the write landed outside the entry; an unverified constant slot or resource return value was used in place of an object return, and the type mismatch crashes natively; a BL was changed to NOP while the stack accounting on both sides is unbalanced (a push before, no pop after); fix — check the entry-word shape before landing a gadget, and never write blindly at offset 0. Land the gadget on the first conditional branch inside the function prologue, before the frame is allocated again. Prefer "return empty" when removing a component or object; do not return an unverified constant. Turning a call into NOP is safe only when the return value is overwritten afterward. Prefer a branch flip for boolean / gate logic (1 word, low risk). Use a return-empty rewrite only when removing a whole function (source: reverse-skills (inliver233), MIT)
- **Patch blast radius: shared callers / a hot entry / a shared flag**: symptom — flipping one condition blanks a whole page, hangs startup, or stacks dialogs, while the patch bytes are in place and the logic direction is correct; cause — the function that holds the condition is shared by several callers (a rendering load-bearing wall), and forcing the condition kills every caller at once; a hot entry (an async state machine / a startup controller) was emptied and starved the later callback graph; the flipped flag is dual-use (a display gate plus an anti-tamper signal) and cannot be told apart statically; the branch may consume a value reloaded from the stack later, so a patch at the first load has no effect; fix — prove the target caller is unique before flipping the condition, and do not touch a branch in a function shared by many callers. Patch an internal call or branch, not the hot entry. Do not patch a shared flag; change the render layer (opacity / off-screen / an empty child). A conditional branch should be patched at the last writer of the source register (the consume site), not at the first load. If three structurally different direct paths all fail (flip blanks the screen / a changed return crashes / a runtime flip cannot be made static), a runtime invariant is blocking it. Stop retrying and change the abstraction layer or the target (source: reverse-skills (inliver233), MIT)
- **NOP safety is per-function**: symptom — the same NOP technique works in function A and breaks startup in function B; cause — a call that can be NOP'd safely has an exact byte template (envelope: push → call → pop → the return value is overwritten → return). A blind NOP outside that template breaks stack balance or a type constraint, and safety differs per function, so A does not generalize to B; fix — mechanically classify call sites that match the byte template before treating them as safe to NOP, then verify one by one. Do not guess. Regression-test each function on its own (especially that startup still completes). If the symptom remains after NOP'ing every known orchestration call (for example it only appears very late), this is not that path; triage a different source. Shrink to the smallest patch surface — a controlled block that references only one non-critical resource is the ideal branch-flip target (source: reverse-skills (inliver233), MIT)
