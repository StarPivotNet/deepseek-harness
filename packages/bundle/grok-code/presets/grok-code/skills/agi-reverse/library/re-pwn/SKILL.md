---
name: re-pwn
description: >
  CTF pwn introduction: stack overflow, format strings, ret2libc.
  Triggers: pwn, `栈溢出`, `格式化字符串`, ret2libc, ROP, `shellcode 注入`
capabilities: [exploit-development]
---

# CTF pwn introduction (stack overflow / format string / ret2libc)

## When to use / when not to use

- Use: a CTF pwn challenge — a stack overflow (overwriting the return address), a format string (a leak / an arbitrary write), ret2libc (leak libc and get a shell)
- Use: the challenge binary plus a matching libc are in hand, and an exploit script that gets a shell or prints the flag must be written
- Use: introductory ROP (the first levels of ret2win / ret2shellcode / ret2libc / ret2csu)
- Do not use: engineering a complex ROP chain / heap exploitation (fastbin / tcache) → [[re-exploit]]
- Do not use: a pure reversing challenge (recover an algorithm and find the flag) → the reversing branch of [[re-ctf]] ([[re-binary-core]])
- Do not use: a Windows target ([[re-x64dbg]] / [[re-windbg]]); a macOS target ([[re-lldb]])
- Note: exploit verification is dynamic execution and runs inside the sandbox by default (the top rule in [[re-analyze/platform-tips]]; see [[re-sandbox]]). Verify locally inside the sandbox first, and only then consider the remote (pitfall 4)

## Tool setup

See [[re-analyze/platform-tips]] — exploit verification defaults to the sandbox. Static analysis first (disassembly / checksec), then dynamic debugging, which matches the "static first" idea.

### pwntools (a pip install) — the exploit-script workhorse

- `pip install pwntools` (the official PyPI; the current stable release is 4.15.0; 64-bit systems are supported best)
- **Python compatibility matrix (this library keeps only this copy, inside re-pwn; other skills cite it here)**: 4.15.0 supports Python 3.8+, but the official release has declared that **this is the last version that supports Python 2 and Python <3.10** — later versions are prepared for Python >=3.10. To run on 3.8/3.9, pin `pwntools==4.15.0`
- Distro packages (the version may lag; the features match): Debian/Ubuntu `sudo apt install python3-pwntools`, Fedora `sudo dnf install python3-pwntools`, Arch `sudo pacman -S python-pwntools` (the official package in Extra)
- **Python 3.12+ (for example the 3.12 shipped with Ubuntu 24.04) fails a direct pip install with PEP 668 `externally-managed-environment`** — fix: create a venv (`python3 -m venv ~/venvs/pwn && source ~/venvs/pwn/bin/activate`, then pip install), or use the distro apt package, or `pip install --break-system-packages` (system-wide; mind the risk)
- Check: `pwn --version` / `python3 -c "import pwn; print(pwn.version)"`

### checksec — protection checks (built into pwntools)

- Usable as soon as pwntools is installed: `pwn checksec --file ./target`
- pwndbg has a built-in `checksec` command (usable as soon as pwndbg is installed; see [[re-gdb]])
- Check: `pwn checksec --file ./target` prints the Arch/RELRO/Stack Canary/NX/PIE lines

### gdb + pwndbg/gef (see [[re-gdb]]) — dynamic verification

- gdb: Debian/Ubuntu `sudo apt install gdb`, Fedora `sudo dnf install gdb`, Arch `sudo pacman -S gdb`, macOS `brew install gdb` (lldb is preferred)
- **A 32-bit target**: Debian/Ubuntu needs `sudo apt install gdb-multiarch` (a 64-bit gdb debugging a 32-bit target needs it). Running a 32-bit dynamically linked program also needs the 32-bit runtime `sudo apt install libc6-i386`
- pwndbg or gef, one of the two (the install follows [[re-gdb]]: pwndbg uses the official portable install script, gef uses curl into `~/.gdbinit`). Check: entering gdb shows a pwndbg/gef banner

### one_gadget (optional) — one-shot libc RCE

- `gem install one_gadget` (a Ruby gem; one_gadget 1.10.0 requires Ruby ≥ 3.1, as the gemspec declares). Debian/Ubuntu first `sudo apt install ruby`. macOS ships Ruby; `sudo gem install one_gadget`
- Arch: `sudo pacman -S one_gadget` (the official package in Extra). Fedora has no package → install with gem
- Check: `one_gadget /lib/x86_64-linux-gnu/libc.so.6` (lists candidate one_gadgets and their constraints)

## Steps

Run in order. Record an evidence path + sha256 for each step's product (the checksec output, the offset, the libc base, the flag) (the evidence method is in [[re-triage]]), so the writeup can cite it.

1. **Identify the bug (checksec protections / disassemble and find a dangerous function)**:
   ```sh
   file target && sha256sum target > target.sha256
   pwn checksec --file target        # NX / PIE / Canary / RELRO —— 决定利用路线（见坑 1）
   ```
   - Disassemble or decompile and find **dangerous functions and input sites** (the [[re-binary-core]] base, [[re-ghidra]] / [[re-ida]] / [[re-radare2]]):
     - A stack overflow: `gets` / `strcpy` / `scanf("%s")` / a manual `read(fd, buf, a large length)` / `sprintf` — look hard at whether the buffer size and the input length are limited (`read(fd, buf, 0x40)` against a 0x20 buf is the overflow site)
     - A format string: `printf(user_input)` / `sprintf(buf, user_input)` (the first argument is not a constant string)
     - A backdoor / flag function: strings contains `/bin/sh`, or a function name contains win/backdoor/flag, and an xref confirms it is reachable
   - Record: the bug class, the dangerous function's address, the input channel (stdin / a remote socket), and the protection state (this decides which route step 2 takes)

2. **A stack-overflow exploit (compute the offset, overwrite the return address)**:
   ```sh
   # 偏移计算：cyclic 生成模式串，崩溃后定位返回地址在输入中的偏移
   python3 -c "from pwn import *; print(cyclic(200, n=8))" > /tmp/patt
   # 本地崩溃（沙箱内）→ gdb/pwndbg 看 $rsp，或直接 pwntools 一体化：
   ```
   ```python
   from pwn import *
   p = process('./target'); p.sendline(cyclic(200, n=8)); p.wait()
   core = p.corefile  # 需开启 core dump
   print("offset:", cyclic_find(core.pc, n=8))   # 64 位 rip 在 core.pc
   ```
   - Overwrite the return address with a backdoor function (ret2win): `offset * b'A' + p64(win_addr)`
   - **64-bit note**: before a function is called, arguments go into registers (rdi/rsi/rdx), not the stack — a `pop rdi; ret` class gadget is needed to pass them (pitfall 5)
   - NX off (`pwn checksec` shows NX disabled) → the shellcode can sit on the stack, and the return address points at it (ret2shellcode). NX on follows step 3
   - Each round, gdb ([[re-gdb]]) breaks at the return point and confirms the return address is really controlled (`x/10gx $rsp`)

3. **ret2libc (PLT/GOT, identifying the libc version)**:
   - Prerequisite: the overflow is controllable but the stack is not executable (NX on), and there is no backdoor — the goal is to call libc's `system("/bin/sh")`:
   ```sh
   objdump -d target | grep -E '<puts@plt>|<printf@plt>|<system@plt>'   # PLT 可调函数
   objdump -R target | grep puts                                          # GOT 存 libc 实际地址
   ```
   - Leak a libc address: the first ROP stage calls `puts@plt(puts@got)` (rdi = puts@got; see pitfall 5) → it prints the real address of `puts` inside libc → return to main and send the second stage
   - **Identifying the libc version**: if the challenge gave a libc file, compute the offsets locally. If it did not, use the leaked low 12 bits (the in-page offset does not change) plus an online database (libc.rip / libc-database; see pitfall 2):
     ```sh
     one_gadget ./libc.so.6    # 若有 libc 文件：直接列 one_gadget
     # 或用泄露的 puts 地址后 3 位 hex 查 libc-database: ./find puts 7a0
     ```
   - Compute: `libc_base = leaked_puts - puts_offset`; `system_addr = libc_base + system_offset`; `binsh_addr = libc_base + binsh_offset` (`readelf -s libc.so.6 | grep system` and `strings -tx libc.so.6 | grep /bin/sh`)
   - The second ROP stage: `pop rdi; ret` → binsh_addr → system → finish (alignment, pitfall 5)

4. **A format string (leak / write)**:
   ```sh
   # 泄露：把输入原样做 format 的参数，%p 逐个试偏移
   python3 -c "print('%p.'*20)" | ./target
   ```
   ```python
   from pwn import *
   p = process('./target')
   p.sendline(b'%6$p %7$p')      # %N$ 是逻辑参数列表第 N 个参数: format 占 rdi，%1$–%5$ 来自 rsi/rdx/rcx/r8/r9，%6$/%7$ 即调用者栈上第 1/2 个 8 字节
   print(p.recvline())
   ```
   - A leak: `%N$p` reads the Nth argument of printf's logical argument list, not the Nth stack slot. Under SysV AMD64 the format occupies RDI, the first 5 integer/pointer varargs come from RSI/RDX/RCX/R8/R9, and the 6th onward come from the stack. With no matching real argument, what is read is leftover from the call site, and the offset must be probed (a few round trips locate the flag / the return address / a libc address; see the environment differences in pitfall 4)
   - An arbitrary write: `%N$n` writes the number of bytes already output to the address pointed at by the Nth argument — the payload layout is the target address (the first 8 bytes) + the offset to that address + a split write of `%<len>c%N$n` (small first, then large, or `%hhn` writes a byte at a time and saves bytes)
   - The classic target: a GOT entry (when RELRO is partial) changed to the address of system / a win function; or the return address changed to a one_gadget
   - A pwntools helper: `fmtstr_payload(offset, {got_addr: win_addr}, write_size='byte')` (offset comes from a measurement, not an ABI constant that can be copied)

5. **Local verification (a pwntools script)**:
   ```python
   from pwn import *
   context.binary = './target'            # 自动取架构/位数/保护
   context.log_level = 'debug'
   p = process('./target')                # 本地（沙箱内）；远程: remote('host', port)
   payload = b'A'*offset + p64(win_addr)
   p.sendline(payload)
   p.interactive()                        # 拿到 shell 后 cat flag
   ```
   - Verification discipline: it works locally → record the sha256 of the flag and the payload → then connect to the remote (pitfall 4). On failure, locate it with gdb first (a breakpoint at the return point, and see whether the return address hits)
   - Product: exploit.py (the commented version) + the run output (the flag) + the flag sha256 — the writeup cites them

## Cross-domain handoff

- [[re-ctf]]: this skill is the pwn-branch child of the CTF practice gateway — after step 1 of the gateway identifies a pwn challenge, it always dispatches this skill
- [[re-binary-core]]: disassembly and decompilation locate the dangerous function, the backdoor function, and PLT/GOT ([[re-ghidra]] / [[re-ida]] / [[re-radare2]]). The import-table idea in [[re-imports]] locates puts/system
- [[re-gdb]]: dynamic verification (break at the return point / check format-string arguments / take rip from a core file). pwndbg's `checksec` command
- [[re-angr]]: when the overflow offset is uncertain or the check logic is complex, symbolic execution helps (symbolize the input and find the constraint that overwrites the return address). [[re-z3]] is used for a small amount of checking the address math of a format-string write
- [[re-exploit]]: the advanced continuation — complex ROP (SROP / ret2dlresolve), heap exploitation, a seccomp bypass
- [[re-vuln]]: a pwn challenge is a simplified vulnerability — the challenge's exploit idea maps onto real vulnerability hunting (crash analysis is [[re-crash-triage]] / finding bugs is [[re-fuzzing]])
- [[re-sandbox]] / [[re-analyze/platform-tips]]: every dynamic execution and exploit verification runs inside the sandbox by default (the top rule). A remote target is for verification only, and is not pointed at a real system

## Pitfalls

- **Every protection on (an NX/PIE/Canary combination) needs a combined exploit**: symptom — a single ret2shellcode or ret2libc will not run: NX on means the stack is not executable, PIE on means the binary address changes every run, and a Canary is a random canary in front of the return address that aborts as soon as it is overwritten; cause — a combination of modern protections is normal, and one route cannot solve every protection; fix — combine from the checksec result: Canary → leak the canary with a format string first and then overflow (payload = pad + canary + pad + ret); PIE → leak one binary address first and compute the base (a format string or a puts leak), and a gadget or backdoor address = base + offset; NX+PIE+Canary all on = two leaks first (canary + libc/binary base) and then ROP. The last 12 bits of a leaked value, the in-page offset, do not change, and the base is computed by joining them (the same idea as pitfall 2)
- **The libc version does not match (every offset is wrong)**: symptom — the local exploit works, and the `system` / `/bin/sh` offsets computed from the leaked address crash the remote immediately, or a base computed from the leaked address with the local libc does not line up at all; cause — symbol offsets differ between libc versions (the puts offset of glibc 2.27 and 2.31 differs a lot), and the local `/lib/x86_64-linux-gnu/libc.so.6` does not match the remote environment; fix — if the challenge gave a libc file, use it (`strings -tx` / `readelf -s` for the offsets). If it did not, match the version with the leaked low 12 bits + libc-database (`./find puts 7a0`) or the online libc.rip, and then compute every offset from the matched libc. Before hitting the remote, confirm the remote libc matches the local one (leak the `__libc_start_main` address with a format string and compare)
- **It works locally and hangs remotely (an environment difference)**: symptom — the exploit works in the local sandbox, and the same payload fails after connecting to the remote (a segfault / no output / a timeout); cause — the local and remote environments differ: the libc version (pitfall 2), the binary bitness/architecture, pwntools `context` settings (the wrong bitness or endianness makes every p64 wrong), stdin interaction timing (the program prints late / a prompt), a remote flag path that is read-only; fix — pair `context.binary` first. Locally, run the same libc version and system the challenge gave (`patchelf --set-interpreter` + `--replace-needed` to swap in that same local libc) until it works. The remote script uses `remote()` uniformly plus timing handling with `sleep` / `recvuntil`. The local check adds a `setvbuf` / prompt-difference simulation. In the end the remote libc file the challenge gave is the authority
- **64-bit argument passing (rdi)**: symptom — a 64-bit ROP "puts the arguments on the stack" directly (a 32-bit habit), and `system` segfaults or calls an address that does not exist; cause — the x86-64 SysV ABI passes the first 6 arguments in registers (rdi/rsi/rdx/rcx/r8/r9), not on the stack. ROP needs `pop rdi; ret` to pop a stack value into rdi and then ret to the target function. A second cause — when `$rsp` is not 16-byte aligned after `call`, a `movaps`-class instruction crashes immediately (common on newer glibc); fix — `ROPgadget --binary target | grep 'pop rdi'` or ropper `--search "pop rdi"` finds the gadget (see [[re-exploit]]). The gadget chain before each call is `pop rdi; ret` → the argument → the target address. Before `system`, the stack address is `+8` first (an aligning ret) or adjusted with a `ret` gadget. Only a 32-bit target passes arguments purely on the stack
- **A wrong format-string offset / a write that crashes**: symptom — the value `%6$p` reads does not match the expected stack layout, or the program crashes immediately after a `%n` write; cause — the offset count is wrong (argument positions differ by compiler and platform, and the input itself also occupies a place on the stack). The write target is not writable (GOT full RELRO is read-only, or the write lands on an illegal address). The split-write order is wrong (writing a large value and then a small one loops forever); fix — dump the whole stack with `%p` first and line up the layout (`python3 -c "print('%p.'*30)"`), and record which argument slot the input itself lands in (it is often the offset baseline). Before writing, `pwn checksec` confirms whether the GOT is writable (only partial RELRO). `%hhn` writes a byte at a time, ordered from small to large. Each step uses gdb to confirm the target address's contents really changed
