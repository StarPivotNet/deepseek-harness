# rizin/radare2 tool pitfalls and limits

## r2 / rz differences (a migration radar)

- **The project forked**: rizin is a fork of radare2 (from 2021, the r2 5.x era). The command sets are mostly compatible but they evolve independently — confirm a command from an r2 tutorial or blog with `rz? command-name` before running it
- **The plugin systems differ**: `r2pm` (r2) vs `rz-pm` (rz). Plugins are not interchangeable. rz-ghidra is rz's decompiler plugin; r2's counterpart is `r2ghidra` (installed with r2pm)
- **The binary names differ**: `r2` / `rabin2` (r2) vs `rizin` / `rz-bin` (rz). `rz-bin` flags mostly match `rabin2` (`-I/-z/-i/-E/-l`)
- **A few command names differ**: rz 0.7+ keeps the string commands `izz` / `iz`. Some analysis commands were renamed (the r2 `axt` family is fully kept in rz, and the `axg` output format differs) — trust the current syntax in commands.md of this skill
- **Release pace**: the radare2 main line is currently 6.2.x. The Rizin main line is currently 0.9.x (trust the latest official Releases; do not pin a patch number) — they evolved independently after the 2021 fork, so command / API / plugin ABI must not be inferred from a shared-version habit. Check with `r2 -v` / `rizin -v` before running. From Rizin 0.9 the new analyzer is on by default (RzAnalysis 2.0-style behavior; a few command outputs changed). After a major upgrade, run the commands once and check them

## Analysis pitfalls

- **Looking before analysis means empty data**: without `-A` / `aaa` there are no function boundaries and no cross-references — empty or misaligned `pdf` / `axt` output is normal. Analyze first
- **A full `aaa` is extremely slow on a huge file** (tens of MB of firmware can take minutes): use `aa` or `aa~` first, and `af @ address` only on the important sections. Ctrl+C mid-analysis keeps the part already analyzed
- **`pdf` depends on function boundaries**: a stripped target must `af @ address` first. With no boundary the output may print only one instruction, or it may be misaligned
- **String search uses `izz`, not `iz`**: `iz` looks only at the current section, so strings outside `.rodata` (`.data` after decryption) are missed — the full set is `izz`
- **PIE/ASLR address drift**: addresses from `-A` change after a debug run (the load base differs) — in a debug session, `dm` shows the real base. Set breakpoints on symbol names, or convert from the `dm` result. Addresses during static analysis are file-image addresses. Do not compare them directly with debug memory addresses

## Debugger pitfalls (built-in rz vs gdb)

- **The command set is not gdb**: gdb's `b` / `c` / `si` are rz's `db` / `dc` / `ds` — coming from [[re-gdb]], do not type `b main` out of habit
- **Conditional-breakpoint syntax is `db address:condition`** (a colon), not gdb's `b ... if ...`
- **attach is limited by permissions and YAMA**: on Linux a `ptrace` restriction (`/proc/sys/kernel/yama/ptrace_scope`) makes `rizin -d -p` fail — relax it temporarily, or switch to gdb started with the same privileges
- **The built-in debugger is limited**: no kernel debugging, and it is less mature than gdb on threads and signal handling — a complex debug case switches straight to [[re-gdb]]
- **The debug target has anti-debug**: `ptrace`-detection anti-debug interferes — locate the check statically (search `ptrace` calls with `/a`) and then handle it; see [[re-anti-analysis]]

## Output and batch pitfalls

- **Color and paging pollute a pipe**: command output through a pipe or a redirect carries ANSI color and the interactive prompt — add `-q` for quiet, `e scr.color=0` to turn color off, and `e scr.interactive=false` when needed
- **A batch does not echo errors**: a command error inside `-c 'cmd; quit'` prints only to stderr — use `-e bin.cache=true`, or a script file with `-i`, so it is easier to debug. Check the exit code
- **A large output floods the screen**: `pdf` on a huge function prints thousands of lines — `pdf @ function | less`, or look at it in pieces with `pd 50`
- **`Po` opens an old project whose version does not match**: after an rz upgrade an old project may fail to load — project files are bound to the version. Rebuild the analysis after an upgrade

## Notes

- Run everything inside the sandbox (the top rule in [[re-analyze/platform-tips]]). `rizin -d` debugging is dynamic execution and defaults to the sandbox
- Command details follow the actual behavior of the target version (`rz -v` for the version). For differences between versions, check the Rizin Book first
