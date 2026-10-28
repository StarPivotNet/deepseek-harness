# IDA shortcuts and IDAPython command cheat sheet

IDA has two entries: GUI shortcuts (main window) and IDAPython (`File > Script command` / headless scripts). Mix them — script what a script can do and verify it first; the GUI is for interactive confirmation. Command meaning follows the official docs (docs.hex-rays.com) and the idapython module sources.

## Shortcut cheat sheet (grouped by task)

| Task | Shortcut | Notes |
|---|---|---|
| Text search | Alt+T | Search strings/keywords in the current IDB (prompt copy, error strings) |
| Binary search | Alt+B | Byte-pattern search (supports `?` wildcards) |
| Jump | G | Jump to an address / symbol / expression |
| Go back | Esc | Walk back along navigation history |
| Cross-references | x | Who references the selection; double-click an xref list item to jump |
| Rename | n | Rename a function / variable / global |
| Change type | y | Calling convention / parameters / return type |
| Comment | ; / : | Ordinary comment / repeatable comment (shown with the address) |
| Decompile | F5 | Open Hex-Rays pseudocode |
| Switch view | Tab | Pseudocode ↔ assembly |
| Segment list | Alt+E | segments window |
| Functions window | Shift+F3 | Function list (name / address / length) |
| Debug run | F9 / F2 / F8 / F7 | Continue / toggle breakpoint / step over / step into |
| Debug restart | Ctrl+F2 | Restart the debug session |
| Script command | Shift+F2 | Open the Script command dialog |

## Headless batch commands

- `idat -A -S"script.py" sample`: run a script in auto mode (`-A` exits after analysis; without `-S` it only analyzes)
- `idat -A -S"script.py log.txt" sample`: the script argument `log.txt` is passed in `sys.argv` (argv[0]=script path, argv[1:]=remaining arguments)
- `idat -A -S"script.py" -L"ida.log" sample`: write IDA's own log to a file (required for debugging; problems often hide in the log)
- The IDA 9.x headless executable is `idat` (one binary handles 32/64-bit, no 64 suffix); on Windows add `.exe` (`idat.exe`). Only IDA ≤8.x splits `idat` / `idat64`
- Fixed skeleton for a headless script:

```python
import ida_auto, ida_pro, idc
ida_auto.auto_wait()          # wait for auto-analysis, or the function list is empty
# ... body (try/except per function; on failure record it and do not abort) ...
idc.qexit(0)                  # = ida_pro.qexit(0); must exit or the process hangs
```

## Common IDAPython functions (by family)

- Bytes / addressing: `idc.get_byte(a)` / `ida_bytes.patch_byte(a, v)`; `idc.get_name_ea(0, "name")` (failure returns `BADADDR`)
- Functions: `ida_funcs.get_func(ea)` (returns None; check it), `idc.get_func_name(ea)`, `ida_funcs.func_size(ea)`
- Cross-references: `idautils.XrefsTo(ea, 0)` / `idautils.XrefsFrom(ea, 0)` — walk and take `.frm` / `.to` / `.type`
- Decompile: `ida_hexrays.decompile(ea)` (returns cfunc; `.body` is the ctree; on failure it throws, so try/except first)
- Types: the `ida_typeinf.tinfo_t` system (recommended on IDA 9); the old `get_struc` / `get_member` were removed in IDA 9
- Output: `print()` goes to the output window; writing batch results to a file is more stable than flooding the output window

## Common operation sequences (combined playbooks)

### 1. Locate check / registration logic: string → xref → function

```
Alt+T search prompt copy ("Invalid key" / error string) → x for references → F5 on the function at the reference
Walk up the call chain in pseudocode → find the compare (strcmp / check call) → n to rename → write the conclusion as a comment with ;
```

### 2. Headless batch decompile export (read-only first)

```
idat -A -S"dump.py" -L"ida.log" sample
# dump.py: auto_wait() → walk idautils.Functions() and filter FUNC_LIB
# → per function try: decompile(ea) and save a .c file; except: record (ea, name, reason)
# → at the end print total/exported/failed, two-channel verification (plus ida.log keywords)
```

### 3. Batch-patch a decrypt loop (run a read-only check before writing the database)

```
Run a read-only script first: print byte stats for the target segment (read 0x100 bytes + entropy / first-byte distribution) and confirm address and algorithm
Then run the write script: ida_bytes.patch_byte(base+i, get_byte(base+i) ^ key)
Run it on a copy of the .i64; finish with idc.qexit(0)
```

### 4. Library-function comparison after FLIRT identification fails

```
idb2pat builds a .pat from a known library → sigmake converts it to a .sig → apply it to the sample
# or first File > Produce file > Dump typeinfo and export types for other tools
```

## Lessons internalized

- A headless script runs in parallel with auto-analysis — any function walk before `auto_wait()` is empty
- APIs that return an address always check `BADADDR`; APIs that return an object check None; on failure print the scene and continue
- Database writes (patch/rename) are poorly reversible — run on a copy first, and the script verifies read-only first
- `idc.qexit(0)` is the only reliable batch exit; verify results on two channels, the `-L` log and print output
- Batch export is ordered cheap to expensive (strings → imports → exports → memory → decompile). A single failure is recorded and does not abort

## Usage notes

- Static analysis needs no sandbox; IDA debugger dynamic debugging runs inside a sandbox under the top principle in [[re-analyze/platform-tips]]
- Before dynamic analysis, survey with [[re-triage]] (hash / packer identification). FLIRT only works on libraries after unpacking
- Write conclusions into the [[re-analyze/analysis-contract]] data contract; a packed target goes to [[re-anti-analysis]] first
