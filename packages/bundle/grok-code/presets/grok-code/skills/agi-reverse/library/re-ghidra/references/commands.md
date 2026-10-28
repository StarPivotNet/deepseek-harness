# Ghidra command cheat sheet and operation sequences

Two main lines: the GUI (interactive annotation / function-level deep analysis) and analyzeHeadless (headless batch / scripting). Script language is one of two: GhidraScript (Java / Jython 2.7, built-in interpreter) or ghidra-bridge (an external Python 3 driving the GUI). Every parameter name and API follows the target version's official docs (help/topics/) and javadoc.

## analyzeHeadless parameter family (headless batch)

| Parameter | Role |
|---|---|
| `-project <path>` | project directory (created automatically) |
| `<project name>` | project name (positional argument) |
| `-import <file\|directory>+` | import and analyze (several allowed; a directory needs `-recursive`) |
| `-process [<file in project>]` | rerun on an already imported file (mutually exclusive with `-import`) |
| `-preScript / -postScript <script name> [<arg>]*` | run a script before/after analysis; arguments may follow |
| `-scriptPath "<path1>[;<path2>...]"` | script search path (semicolon-separated) |
| `-propertiesPath` | script properties-file path |
| `-noanalysis` | skip auto-analysis (symbols/strings remain; import in seconds) |
| `-analysisTimeoutPerFile <seconds>` | per-file auto-analysis timeout |
| `-processor <languageID> / -cspec <compilerSpecID>` | force a language/compiler (when identification is wrong) |
| `-readOnly` | open the project read-only (do not write changes) |
| `-overwrite` | overwrite an existing file |
| `-recursive [<depth>]` | recursively import subdirectories |
| `-deleteProject` | delete the project when finished |
| `-log <file> / -scriptlog <file>` | run log / script log (look at them separately) |

Typical combination: `analyzeHeadless /tmp/p name -import a.bin -postScript X.java -scriptPath /s -deleteProject -log l.log`.

## GUI shortcut family (grouped by task)

| Task | Operation | Notes |
|---|---|---|
| Import | `File > Import File` | after selecting the sample, `Analyze`, and wait for the lower-left progress to finish |
| Jump | `G` | Go To an address/symbol |
| Cross-reference | `R` | with the cursor on a function/variable, press R to open References |
| Decompile | `Ctrl+E` (default; may differ by version/keymap) | open the Decompiler window; trust Help > Key Bindings |
| Function graph | `F` | Function Graph (branch/loop structure) |
| Rename | `L` | rename a function/variable (available in both Listing and Decompiler) |
| Set type | `y` | Set Data Type (such as `char *`, `DWORD`) |
| Define a struct | `Data Type Manager > right-click > New > Structure` | after defining it, a Decompiler reference improves decompilation |
| Force disassembly | `C` | mark selected bytes as code (expand an obfuscated segment by hand) |
| Create a function | `right-click > Create Function` | repair a function boundary |
| Undo | `Ctrl+Z` | annotation/rename can be rolled back |
| Export | `File > Export Program` | format C/C++ exports the **decompilation result** (not original source — variable names/type inference may be wrong; reading aid only; verify key logic against disassembly) |

## Script API family (GhidraScript, Jython 2.7 syntax)

```python
# 地址/函数
addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x401000")
fm = currentProgram.getFunctionManager()
f = fm.getFunctionAt(addr)
# 重命名/标注（USER_DEFINED 才进脚本可回滚）
from ghidra.program.model.symbol import SourceType
f.setName("decrypt_buf", SourceType.USER_DEFINED)
listing = currentProgram.getListing()
listing.setComment(addr, listing.PLATE_COMMENT, "decrypt loop start")
# 字节批量读写（比 getByte/setByte 逐字节快）
mem = currentProgram.getMemory()
buf = bytearray(0x100)
mem.getBytes(addr, buf)
mem.setBytes(addr, buf)
# 反编译单函数
from ghidra.app.decompiler import DecompInterface
dec = DecompInterface()
dec.openProgram(currentProgram)
res = dec.decompileFunction(f, 60, monitor)   # 超时给足
print(res.getDecompiledFunction().getC())
# 遍历函数
for g in fm.getFunctions(True):
    print(g.getName(), hex(g.getEntryPoint().getOffset()))
```

## Operation sequences (combined patterns)

### 1. Headless batch decompile-export pipeline (many samples)

```
Write a collector script CollectC.java first (walk functions → decompileFunction → write a .c file)
analyzeHeadless /tmp/p name -import dir/ -recursive \
  -postScript CollectC.java -scriptPath /tmp/s -deleteProject -log l.log
Archive products by sample name; the script log is -scriptlog (separate from -log)
```

### 2. Script a decrypt loop (an XOR routine produces plaintext directly)

```
Statically locate the decrypt loop ([[re-crypto-decrypt]]) → confirm the XOR constant and the range
Script: mem.getBytes reads the ciphertext → xor inside python → write back or export a new file
Verify: compare the exported plaintext sha256 with a real sandbox run ([[re-sandbox]])
```

### 3. Expand a large binary in segments (prevent auto-analysis from hanging)

```
Import with -noanalysis first (seconds) → the script takes the symbol table/strings/entry point
Run a small-range analysis on the key segment alone (or turn off RTTI/indirect-call options in the GUI)
Advance single-function decompilation, and expand step by step — see the large-file analysis group in [[gotchas]]
```

### 4. ghidra-bridge remote drive (Python 3 environment)

```
In the GUI, Script Manager runs ghidra_bridge_server.py (prints the port)
External: b = ghidra_bridge.GhidraBridge(); b.remote_scope(); b(getFunctionManager())
Suited to numpy/modern Python capability; the script and the GUI session stay in sync (annotation changes are visible immediately)
```

## Lessons internalized

- Bulk byte operations use `mem.getBytes/setBytes`, not `getByte/setByte` byte by byte (a large range is an order of magnitude slower)
- The built-in interpreter is Jython 2.7: use `xrange`, and do not use f-strings; for Python 3 capability, use ghidra-bridge
- The second argument of `decompileFunction` is a timeout in seconds; give a large function 60+; judge failure with `res.decompileCompleted()`
- Address arithmetic uses `addr.add(i)` / `addr.subtract(i)`; you cannot write `addr + i` directly
- Annotation source uses `SourceType.USER_DEFINED` (distinguishable from analyzer auto-annotation; rollback-safe)
- On a script exception, look at `-scriptlog` first; headless print goes only into the script log, not into `-log`

## Usage notes

- Static analysis skips the sandbox ([[re-analyze/platform-tips]] static-first); archive the sample sha256 and export products ([[re-triage]])
- Write conclusions into [[re-analyze/analysis-contract]]; lock scripts and the project by version (the version group in [[gotchas]])
