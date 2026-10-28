---
name: re-emulation
description: >
  Emulated execution: Unicorn/Qiling frameworks. Triggers: Unicorn, Qiling, `模拟执行`, emulate, `无硬件运行`
capabilities: [emulation]
---

# Emulated execution (Unicorn / Qiling)

## When to use / when not to use

- Use: the target cannot run on this machine (architecture/OS mismatch, no hardware, missing dependencies); unpack assist (extract the in-packer decrypt routine and emulate it to get plaintext); anti-debug bypass (an emulator has no debugger mark; see the exception in pitfall 2); isolated execution of a single function/code segment for verification
- Use: a deterministic task that does not need full OS semantics (no process/thread/network-stack dependency)
- Do not use: you need a full OS environment (multi-thread, network stack, full API semantics) → use QEMU full-system ([[re-fw-emulate]]) or a real sandbox run ([[re-sandbox]])
- Do not use: you only need dynamic debugging ([[re-gdb]] / [[re-x64dbg]] / [[re-windbg]])
- Do not use: the target can already run on this machine — running it directly in a sandbox is more real ([[re-analyze/platform-tips]] highest principle); save emulation for scenes where the environment cannot be produced

## Tool setup

Emulated execution is dynamic execution; default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle); the three tools in this skill are all pip packages, common to Linux/macOS/Windows, and usable directly inside WSL (the [[re-analyze/platform-tips]] WSL branch).

### unicorn

- Install: `pip install unicorn` (Python 3)
- Verify: `python3 -c "import unicorn; print(unicorn.__version__)"`
- Version: 2.x is the current line (2.1.4 in 2025-09); 2.x hook callback signatures match 1.x (`(uc, address, size, user_data)`); pip installs 2.x by default; 1.x→2.x differences are in [[gotchas]]

### qiling (depends on unicorn / capstone / pefile, installed automatically)

- Install: `pip install qiling` (currently 1.4.x)
- Verify: `python3 -c "import qiling; print(qiling.__version__)"` (pure import verification, zero extra dependency; the pip wheel does not include examples/ or rootfs; running examples requires a git clone of the official repo)

### capstone (for disassembly/decode output)

- Install: `pip install capstone`
- Verify: `python3 -c "import capstone; print(capstone.__version__)"`

## Procedure

Run in order. Record each step; archive emulation products (memory snapshot/plaintext segment) with sha256 (the [[re-triage]] evidence approach).

1. **Judge the scene**:
   - What is the target, and what problem does emulation solve — unpack assist (the packer's decrypt routine is a single function; emulating that routine yields plaintext without running the whole packer)? Anti-debug bypass (the sample detects a debugger but may not detect an emulator; see pitfall 2)? Run with no environment (architecture mismatch / missing OS)?
   - Pick the tool: code segment/single function only → Unicorn (smallest, controllable); need file/syscall semantics → Qiling (handles syscalls automatically); need a full OS → hand off to [[re-fw-emulate]]

2. **Unicorn minimal frame**:
    ```python
    from unicorn import *
    from unicorn.x86_const import *
    CODE = bytes.fromhex("b8 2a 00 00 00 c3")      # mov eax, 0x2a; ret
    mu = Uc(UC_ARCH_X86, UC_MODE_32)
    mu.mem_map(0x1000, 0x1000)                    # 先映射一页（地址页对齐）
    mu.mem_write(0x1000, CODE)
    mu.reg_write(UC_X86_REG_ESP, 0x2000)          # 设好栈（不设 ESP 会崩）
    mu.emu_start(0x1000, 0x1000 + len(CODE))      # 执行到结束地址
    print(hex(mu.reg_read(UC_X86_REG_EAX)))       # 0x2a
    ```
   Points: memory must `mem_map` (page-aligned) before `mem_write`; the stack register must be set; `emu_start(begin, until)`'s until must cover the code end address, or it runs into an illegal address

3. **Qiling full-program emulation**:
    ```python
    from qiling import Qiling
    ql = Qiling(["rootfs/x8664_linux/bin/x8664_hello"], "rootfs/x8664_linux")   # 文件名以实际 rootfs 为准；examples/ 与 rootfs 需 git clone 官方仓库获取（pip 不含）
    ql.run()
    ```
   - rootfs: pip does not include examples/ or rootfs; git clone the official qiling repo and take `qiling/examples/rootfs/` (x8664_linux, arm_linux, x86_windows, and similar); when building your own rootfs, copy the target program's libc/ld-linux and runtime files into it
   - Files/syscalls are taken over by Qiling (open/read/write map into the rootfs), which is less work than Unicorn (the fix for pitfall 1)
   - Windows program: `Qiling(["sample.exe"], "rootfs/x86_windows")` (that rootfs includes a wine base environment; heavy but usable)

4. **Hooks (hook_code / hook_mem)**:
    ```python
    def hook_code(uc, address, size, user_data):
        if address == 0x401234:
            print("hit target", hex(address))
    mu.hook_add(UC_HOOK_CODE, hook_code)          # 每指令回调
    mu.hook_add(UC_HOOK_MEM_WRITE, hook_mem)      # 内存写回调（脱壳记解密落点）
    mu.hook_add(UC_HOOK_MEM_UNMAPPED, hook_bad)   # 未映射访问回调
    ```
   - Qiling equivalents: `ql.hook_address(fn, addr)` (address breakpoint), `ql.hook_mem_read/write/unmapped` (memory class)
   - Common for unpacking: hook_mem_write pauses/counts when the target region is hit — that gives the decrypt loop's write timing and the plaintext

4.5. **State save/restore and dumping memory to disk**:
   - Qiling (1.1.x+): `ql.save(snapshot="stage1.qsave")` / `ql.restore(snapshot="stage1.qsave")` — checkpoint a multi-stage decrypt flow, then return and continue emulation
   - Unicorn: a snapshot is manual `mem_read` of every relevant segment + a register table dumped to disk (`.json` + `.bin`); restore with `mem_map` + `mem_write` + `reg_write`; if you do not want a full save, use a hook to `mem_read` the target region at a key point and save it to a file (dumping unpack plaintext is this idea)
   - Archive dumped products with sha256 (the [[re-triage]] evidence approach)

5. **Unpack scene combined with [[re-anti-analysis]]**:
   - Extract the decrypt routine from the packer (located by [[re-unpack-simple]] / [[re-unpack-advanced]]) → Unicorn loads that routine's code segment + an input snapshot → execute → read the output region = plaintext data (strings/key segments)
   - Or Qiling emulates the packer program end to end, hooks the OEP, and dumps memory (emulator memory is the snapshot; archive it with the [[re-memdump]] approach)
   - Anti-debug bypass: an emulator has no debugger mark, but the sample may have environment detection (pitfall 2) — confirm detection points statically first, then decide which path to hook
   - Verify: emulation-product sha256 + a rerun check inside a sandbox ([[re-sandbox]]), then return to the [[re-anti-analysis]] flow

## Cross-domain joins

- [[re-anti-analysis]]: unpack assist (emulate the decrypt routine) is a fixed scene
- [[re-binary-core]]: emulation verification of a decompiler product / single-function logic
- [[re-fw-emulate]]: need a full OS / firmware boot → QEMU full-system; this skill only emulates a single program/code segment and does not take that domain
- [[re-sandbox]]: emulation is dynamic execution and defaults to a sandbox ([[re-analyze/platform-tips]] highest principle)
- [[re-deobfuscate]]: emulate a deobfuscation result to verify it
- [[re-crypto-decrypt]]: evaluate a decrypt algorithm by emulation instead of a hand-written script
- [[re-memdump]]: dump an emulator memory snapshot to disk and analyze it later

## Common pitfalls

- **Unhandled syscall → crash**: Symptom — Unicorn stops or errors at `syscall`/`int 2e` while running a real program; cause — Unicorn does not emulate a kernel; a bare execution fails at a syscall; fix — switch to Qiling (forwards syscalls automatically, less work); in a non-Qiling scene, hook the target syscall and return a fake value (hook_code detects the syscall instruction, changes registers, and skips it)
- **A self-check / environment-detection sample notices the emulation**: Symptom — the emulation result does not match a real run (wrong branch, self-destruct); cause — the sample detects a non-real environment with CPUID/rdtsc timing or an API probe (such as a special `GetModuleHandleA` return); fix — locate detection points statically first ([[re-triage]] / [[re-deobfuscate]]), hook that path to return real-environment values, or patch past the hard check directly; the conclusion must be cross-checked against a real sandbox run
- **Wrong memory permissions**: Symptom — execution reports `Invalid memory read/write/fetch`; cause — an unmapped page was accessed, or a read-only page was written; fix — check the `mu.mem_map` coverage and `mu.mem_protect(addr, size, UC_PROT_ALL)` against the reported address; map extra stack pages and set `UC_PROT_READ|UC_PROT_WRITE`
- **Emulation ≠ real execution**: Symptom — a program that depends on time/threads behaves oddly; cause — Unicorn is single-threaded, `rdtsc` timing is unreliable and needs a hook, and some API semantics are incomplete; fix — use emulation only for deterministic tasks (solve an algorithm, decrypt, extract a function for unpacking); timing/multi-thread/network tasks go to QEMU or a real sandbox; compare the emulation conclusion with a real trace using [[re-tracing]]

- **Prefer unidbg for an Android so**: Symptom — a bare Unicorn/Qiling run of an Android .so lacks JNI/syscall semantics and will not run; cause — the so depends on a JNI environment (Java callbacks, DVM objects); fix — use unidbg (Java, emulates Android JNI + syscall); after loadLibrary, start by calling JNI_OnLoad
- **Iterative pattern of filling JNI callbacks one by one**: Symptom — emulation reports `UnsupportedOperationException: class->method(signature)`; cause — the so called an unimplemented Java callback; this is a **normal iteration signal, not a dead end**; fix — implement callbacks one by one from the error signature (logging class / config class / field read-write), one round per run; same-family projects often have a complete callback set that can be ported; **a normal emulation product is not correctness** — the environment may have been detected and returned a decoy; verify against a real environment / server response
- **Black-box calls of an iOS so use Chomper**: Symptom — an algorithm in a hardened/obfuscated iOS so (signature class) is hard to recover statically, and you want to call it directly on a PC and take the result; cause — the so depends on the Objective-C runtime and a specific initialization (Token/context); fix — Chomper (a Unicorn wrapper that emulates an iOS environment) black-box call flow: frida-trace first to map the init functions and the algorithm call logic → **initialize after dlopen** (hook the dlopen timing; frida-trace can see the call but not the init values) → build argument objects (NSMutableURLRequest and similar; use pyobj2nsobj to turn a dict into an Objective-C object) → call proactively and take the result; initialize Token/context first, then call the algorithm function; build argument objects from the complete structure frida-trace printed; if the target accesses an external file (such as the security config `yw_1222.jpg`) and reports ENOENT → copy the file from the original package into the sample's directory, and after loading the module call `forward_path` to map the access to the specified path; for an instance method, take the instance with `+[Class instance]` first, then call
- **HTTP-service wrapping of a device-side function (r1rpc pattern)**: Symptom — the capability depends on a real-device environment (DeviceCheck/App Attest, device state, SDK context, anti-tamper checks), a pure algorithm cannot be extracted, and emulation is also hard; cause — these functions are essentially "device-side functions" and do not work outside the environment; fix — engineer a black box: **HTTP entry/exit + WebSocket device-side communication + a resident real-device client that executes**: the backend still sends an ordinary HTTP request, the server picks an online device by group, WebSocket delivers the task, the real device executes and returns, and the caller still gets a standard HTTP response; applies to: iOS device capabilities, in-app signatures, capabilities that must run on a real device / a specific SDK — much cheaper than forcing an algorithm extraction or moving the backend
- The API cheat sheet (Unicorn/Qiling command families and constants) and combined patterns are in [[commands]]; version differences and memory/architecture boundaries are in [[gotchas]]
