---
name: re-radare2
description: >
  rizin/radare2 workflow: command-line analysis, pdf, V mode.
  Triggers: radare2, rizin, rz, r2
capabilities: [decompilation]
---

# rizin/radare2 command-line analysis

## When to use / when not to use

- Use: command-line or scripted analysis; memory under 4GB or a remote environment (a GUI decompiler will not run); a quick disassembly and cross-references; exploring with `pdf` / `V` mode; scripted analysis of firmware or a batch of samples
- Use: an SSH/CI environment with no GUI (rz is a pure terminal; `-q -c` is a one-line batch)
- Do not use: a mature GUI decompiler and type propagation are needed (use [[re-ghidra]])
- Do not use: only a first-look conclusion is needed ([[re-triage]])
- Do not use: Windows user-mode debugging is the main task ([[re-x64dbg]] / [[re-windbg]] are smoother; the rz debugger is limited on Windows)

## Tool setup

See [[re-analyze/platform-tips]] — a command-line tool fits a remote or low-memory environment. The Wine/QEMU user-mode emulation experience of the platform branch applies here too.

### rizin (the active fork of radare2)

- macOS: `brew install rizin`
- Arch: `pacman -S rizin`
- Fedora/RHEL (EPEL 8+): `dnf install rizin` (current supported Fedora versions and EPEL 8/9/10 all have a package). An EOL Fedora checks the distro repo first; if there is no package, use an official release or `rz-pm`
- Debian/Ubuntu: **the repos have no rizin package, so `apt install rizin` fails** — use an official release binary (GitHub rizinorg/rizin releases: a static tar.xz / a Windows zip / a macOS pkg) or `rz-pm`
- Kali: `apt install rizin` (Kali's own repo has the package, provided the official Kali sources are in use)
- Windows: extract the official release zip and use it (`rz-bin.exe`)
- Check: `rizin -v`, `rz-bin -V`
- Note: distro package status changes over time. Check the target distro's repo before installing. Success is whatever `rizin -v` says. When another skill needs the rizin install steps, cite this matrix. Do not copy the distro commands into each skill

### The radare2 compatibility layer (the old command set)

- Linux: `apt install radare2` / `dnf install radare2` / `pacman -S radare2`
- macOS: `brew install radare2`
- Windows: `choco install radare2`
- Check: `r2 -v`
- Note: rz and r2 commands are mostly compatible (`pdf` / `axt` / `V` are the same), but plugin names and a few commands differ (marked below)

### The rz-ghidra decompiler plugin

- All platforms: `rz-pm -ci rz-ghidra` (the rizin package manager; needs a network and a compiler toolchain)
- Check: inside rizin, `pdg @ main` prints pseudo-C

## Steps

1. **`rizin -A` full automatic analysis**:
   ```sh
   rizin -A sample
   ```
   Wait for the analysis-complete prompt (on a large file, watch it paged with `p`). `-A` is the same as `aaa` (full automatic analysis: functions / cross-references / string references). For a shallow pass, use an on-demand flag such as `-a x86`. Quit: `q`.
   - Enter interactive mode with no flags and then analyze: `aaa`. The light version is `aa` (functions + string references; preferred for a large file)
   - Function list: `afl`. One function: `afi @ main`. Define a function by hand: `af @ 0x401000`

2. **`pdf` disassembles a function**:
   ```
   [0x00001040]> pdf @ sym.main
   ```
   - With no symbols (stripped), find the entry first: `izz~entry`, or `af @ 0x401000` to define the function by hand and then `pdf @ 0x401000`
   - `pdf` = print disassembly function; `pd 20` = print 20 instructions; `pdr` prints with references
   - When analysis noise is mixed in, filter calls with `pdf @ <addr> | grep call`
   - Rename: `afn new-name @ address`. Comment: `CCu comment @ address`

3. **`axt` cross-references**:
   ```
   [0x00001040]> axt @ 0x403000     # 谁引用 0x403000
   [0x00001040]> axf @ sym.main     # main 引用了谁
   ```
   String references: `izz` lists every string, and `axt @ str.<name>` finds the reference sites (strings were named automatically).
   - The location chain: `izz` finds the key string → `axt @ str.xxx` → jump to the referencing function with `s <address>` → `pdf` — the same idea as Alt+T → x → F5 in [[re-ida]]

4. **Visual `V` mode**:
   ```
   [0x00001040]> V
   ```
   - `p` switches the view (disassembly / hex / graph)
   - `s` followed by an address or a symbol seeks (`s sym.main`); `f` defines a function; `d` toggles disassembly
   - The graph view (function flow): inside `V`, press `p` until the graph view, and navigate with the arrow keys — for sorting out control flow
   - Leave V: `q`. Leave rizin: `q` again

5. **Scripts and rz-ghidra decompilation**:
   ```sh
   # 一行命令批处理
   rizin -q -c 'aaa; pdf @ sym.main; axt @ 0x403000; quit' sample
   ```
   ```sh
   # 反编译
   rz-pm -ci rz-ghidra
   rizin -c 'aaa; pdg @ sym.check' sample
   ```
   `pdg` = Ghidra-style pseudo-C. With no plugin, fall back to `pdf` plus a manual recovery.
   - A script file: `rizin -i script.r2 sample` (or `. script.r2` from the prompt). One command per line in the script, ending in `quit`

6. **Debug mode (the built-in rz debugger)**:
   ```sh
   rizin -d ./sample            # 以调试模式启动
   rizin -d -p 1234             # attach pid
   ```
   ```
   [0x7f...]> db 0x401000       # 断点（db = debugger breakpoint，与 r2 相同）
   [0x7f...]> dc                # 继续（continue）
   [0x7f...]> ds / dso          # 单步 / 步过
   [0x7f...]> dr eax=0          # 改寄存器（绕过校验常用）
   [0x7f...]> px @ rsp          # 看栈内容
   [0x7f...]> drr               # 全部寄存器
   ```
   - The breakpoint table: `db` (no argument lists them). Delete a breakpoint: `db- address`. A conditional breakpoint: `db address:condition` (for example `db 0x401000:eax==1`)
   - Differences from gdb are in [[gotchas]]. The gdb-family flow is in [[re-gdb]]

7. **Search and memory operations**:
   ```
   [0x00001040]> /x 5548             # 十六进制搜索
   [0x00001040]> /v 0xdeadbeef       # 32 位值搜索（小端）
   [0x00001040]> /w "password"       # 字符串搜索
   [0x00001040]> /r sym.check        # 引用搜索（找谁引用了符号）
   [0x00001040]> wx 9090 @ 0x401000  # 写字节（NOP 补丁）
   [0x00001040]> px 32 @ 0x401000    # 读 32 字节
   ```
   - File info: `rz-bin -I sample` (architecture / entry / sections), `rz-bin -z sample` (strings), `rz-bin -i sample` (imports) — the r2 equivalents are `rabin2 -I/-z/-i`

8. **Projects and export**:
   ```
   [0x00001040]> Ps project_name     # 保存项目（含分析结果与标注）
   [0x00001040]> Po project_name     # 打开项目
   [0x00001040]> Pj > out.json       # 导出 JSON 项目（供脚本二次处理）
   ```
   - Analysis annotations (renames / comments) persist with the project — the next `Po` continues from there

## Cross-domain handoff

- [[re-binary-core]]: the low-memory / command-line alternative at step 5 of the workflow (`RE_DECOMPILER=radare2`)
- [[re-firmware]]: scripted batch analysis of firmware ELF (an environment with no GUI)
- [[re-ctf]]: a command-line fast path for a CTF challenge
- Continues at [[re-format-elf]] to read structure. When a GUI decompiler is needed, switch to [[re-ghidra]]
- Dynamic debugging complements [[re-gdb]] (the gdb ecosystem and plugins are fuller; the built-in rz debugger is lightweight)

## Pitfalls

- **Little information before `-A`**: with no analysis there are no function boundaries and no cross-references — `-A` (or `aaa`) first, then look at symbols
- **A large file analyzes slowly**: a full `aaa` is extremely slow on a huge firmware image — use `aa` (light) or `aa~` to limit it, or analyze only the target section by hand with `af @ addr`
- **The r2/rz command sets differ**: tutorials on the web are mostly radare2 (r2). rizin (rz) is mostly compatible, but plugin install (`r2pm` → `rz-pm`) and a few command names differ — `rz?` for help before running
- `pdf` depends on function boundaries — with no symbols, `af` defines them first, or the output is empty or misaligned
- Piped output with color or pager marks pollutes a script parse — a batch turns color off with `e scr.color=0` (`-2` only silences stderr warnings; it does not remove color)
- Version differences, and the debugger and PIE address pitfalls, are in [[gotchas]]
