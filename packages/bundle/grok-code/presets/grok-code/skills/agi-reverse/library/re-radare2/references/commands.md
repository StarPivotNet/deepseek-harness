# rizin/radare2 command lookup and operation sequences

rizin (rz) and radare2 (r2) share a command ancestry: the interactive prompt is `[0x...]>`, and a command is a short letter plus arguments plus an `@ address` scope. A batch uses `-q -c 'cmd1; cmd2; quit'` (`-q` quiet mode removes the prompt output). The commands below follow current rizin syntax, and r2 differences are marked. Official docs: rizin.re/book (the Rizin Book).

## Command families

### Startup and analysis

- `rizin [-A] [-d] [-q -c '...'] sample`: `-A` = automatic analysis, `-d` = debug mode, `-q` = quiet, `-c` = run commands and exit
- `aaa` is a full analysis (functions / references / strings); `aa` is light (functions + string references; preferred for a large file); `aac` builds only the call graph
- `afl` lists functions; `afi @ function` is the function detail; `af @ address` defines a function by hand; `afn name @ address` renames
- `s address/symbol` seeks; `f name @ address` defines a flag
- `iI` is file info; `iS` lists sections; `ie` is the entry point; `il` is linked libraries

### Disassembly

- `pdf @ function` disassembles a function; `pd N` is N instructions; `pdr` disassembles with references; `pdc` is pseudo-C (the built-in lightweight decompiler)
- `pdg @ function` is Ghidra-style pseudo-C (needs the rz-ghidra plugin)
- `p=` is the entropy / printable / character-distribution bars (Rizin Book: entropy/printable/chars bars) — a high-entropy span suggests encrypted or compressed data
- `e asm.pseudo=true` is pseudo-assembly mode (register names are simplified, which is easier to read)

### Cross-references and strings

- `axt @ address/symbol` is who references it (to); `axf @ address` is what it references (from); `axg` is the reference graph
- `izz` is every string (including the data section); `iz` is strings in the current section; `izz~keyword` filters
- Strings are named `str.xxx` automatically — `axt @ str.xxx` finds the reference site directly

### Search

- `/x hex` searches bytes; `/v value` searches a value by width (`/v4` forces 4 bytes); `/w string` searches text
- `/r symbol` is a reference search (find a pointer aimed at the target); `/a assembly` searches by instruction (for example `/a jmp`)
- Hits become `hit0_...` flags. Jump through them with `s hit0_0`

### Memory and patches

- `px N` is a hex read (`pxw` by word, `pxr` annotated with references — for finding pointers); `p8 N` is raw bytes
- `wx byte-string @ address` writes hex; `wv value @ address` writes a value; `wa assembly @ address` assembles and writes (for example `wa nop @ 0x401000`)
- Saving a patch: `Ps project-name` saves the project (annotations go with it); `zo` / `zr` are undo / redo (confirm undo works before a write)

### Debugging (built-in rz)

- Start: `rizin -d sample`. Attach: `rizin -d -p PID`
- `db address` is a breakpoint; `db` lists them; `db- address` deletes; `db address:eax==1` is a conditional breakpoint
- `dc` continues; `ds` single-steps; `dso` steps over; `dcu address` runs until an address
- `dr` is registers; `dr eax=0` changes a register; `drr` is every register (including flags)
- `px @ rsp` looks at the stack; `dbt` is a backtrace; `dt type @ address` dumps by type
- `dm` is the memory map (the module base — a PIE target's address changes after relocation; see gotchas)

### Projects and file tools

- `Ps name` saves a project / `Po name` opens one / `Pj > out.json` exports JSON
- `rz-bin -I/-z/-i/-E/-l sample`: info / strings / imports / exports / linked libraries (r2's counterpart is `rabin2`)
- `rz-pm -ci rz-ghidra` installs a plugin; `rz-pm -l` lists them

## Common sequences

### 1. Locate a check or license compare (string → reference → disassembly)

```
rizin -A sample
izz~fail|错误|invalid        # 找提示字符串
axt @ str.<提示串>           # 谁引用
s <引用地址>; pdf            # 向上看比较指令与调用链
```

### 2. Recover the main logic of a symbol-less (stripped) target

```
rizin -A sample
ie                          # 入口地址
s <入口>; af                # 定义入口函数
afl                         # 看函数列表（找大函数=主逻辑候选）
pdf @ <大函数>               # 逐函数分析，afn 重命名
```

### 3. Bypass a check (change a register or patch in debug mode)

```
rizin -d sample
db 0x401000:eax==0          # 条件断点命中比较点
dc                          # 跑到断点
dr eax=0                    # 改返回/比较值
dc                          # 继续，观察是否绕过
# 持久化方案: wa / wx 打补丁 → Ps 保存项目
```

### 4. Batch-analyze a set of samples (a script file)

```
# analyze.r2: aaa; afl; pdf @ main; quit
for f in samples/*; do rizin -q -i analyze.r2 "$f" > "$f.out"; done
```

### 5. Locate a decrypt loop (a write breakpoint watches the write)

```
/w 可疑字节模式             # 或 axt 定位解密函数
db <解密循环写地址>         # 对写入点下断
dc; px @ <地址>             # 命中后看解密输出
```

## Lessons (internalized)

- Every command can take `@ address` as its scope — in a batch, put the address in the command. Do not depend on seek state
- Before output goes into a pipe or a file, turn color off with `e scr.color=0` (`-2` only silences stderr warnings; it does not remove color). ANSI color codes pollute a parse
- `izz` vs `iz`: the whole-binary string search is `izz`. `izz~xxx` filtering is the fastest way to a prompt string
- Confirm function boundaries before `pdf` (`af` / `afl`) — with no boundary, pdf output is misaligned
- A full `aaa` is slow on a large file: `aa` for the function list first, then `af @ address` to complete the important functions
- A project `Ps` is the only correct way to persist annotations (renames / comments / breakpoints are all saved). Do not depend on terminal history

## Notes

- Run everything inside the sandbox (the top rule in [[re-analyze/platform-tips]]). `rizin -d` debugging is dynamic execution
- File analysis conclusions against the [[re-triage]] first-look values, and write [[re-analyze/analysis-contract]]
- Unpack a packed target with [[re-anti-analysis]] before analysis. A batch job watches `-q` quiet mode and the exit code
