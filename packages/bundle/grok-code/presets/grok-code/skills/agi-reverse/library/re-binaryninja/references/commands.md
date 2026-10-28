# Binary Ninja shortcuts and Python API cheat sheet

Binary Ninja has two entries: the GUI (shortcuts + panels) and the Python API (`File > Python` panel / headless scripts / plugins). Shortcuts follow the official docs (docs.binary.ninja) and the default keybindings; the API follows `binaryninja` module help.

## Shortcut cheat sheet (grouped by task)

| Task | Shortcut | Notes |
|---|---|---|
| Switch disassembly/decompile | Space | assembly view ↔ decompile view |
| IL cycle | i | cycle disassembly / LLIL / MLIL / HLIL |
| IL-level menu | bottom-right Options | graphically pick Lifted LLIL/LLIL/MLIL/HLIL |
| Rename | n | function/variable/global symbol |
| Change type | y | enter a C type string; type propagation takes effect automatically |
| Set a pointer reference | o | create a pointer at the current position |
| Set a character array | a | a character array up to the next NUL |
| Cycle integer width | d | cycle 1/2/4/8-byte integers (number keys 1/2/4/8 set them directly) |
| Build an array | * | turn several selected variables of the same kind into an array |
| Signed/unsigned | - | toggle integer display |
| Hexadecimal/decimal | 0 | toggle the integer display base |
| Comment | right-click Comment | add a comment (no fixed default shortcut; reachable from the right-click menu) |
| Decompile one function | double-click the function | the default HLIL view |
| Jump | g | jump to an address/symbol |
| Back | Esc | return to the previous position |

## Common Python API (by family)

- Load and analyze: `binaryninja.load(path)` → `bv`; `bv.update_analysis_and_wait()` (required headless); `bv.save()` writes back
- Functions: `bv.functions`; `bv.get_function_at(addr)`; `f.medium_level_il` / `f.high_level_il` / `f.llil`; `f.get_callers()` / `f.callees`; `f.name = "new_name"` (assign directly to rename)
- Data/strings: `bv.get_strings()`; `bv.get_data_var_at(addr)`; `bv.get_data_refs(addr)` (who references that data)
- References: `bv.get_code_refs(addr)`; `bv.get_data_refs(addr)` — the scripted entry for a location chain
- Types: `bv.parse_type_string("int (*)(void*, size_t)")`; after defining a struct in the `Types` panel, apply `tinfo_t`
- Comments: `f.set_comment(addr, "text")`; `f.get_comment(addr)`
- Read/write memory: `bv.read(addr, n)` / `bv.write(addr, data)` (used by patch/decrypt loops); `bv.get_length()` is the file size
- Log: `bv.log_info("...")` / `print()` (the GUI console)
- Headless: there is no `binaryninja-headless` CLI — after `install_api.py` registers it, a script runs `binaryninja.load(path)` + `update_analysis_and_wait()` directly; a headless license uses the official standalone download package (`download_headless.py`)

## Common operation sequences (combined playbooks)

### 1. Locate check logic (string → reference → MLIL)

```
Find the prompt string in the Strings view → double-click into disassembly → right-click Show References
→ jump to the referencing function → double-click into the decompile view → i to switch to MLIL and read the data flow
→ n to rename key functions/variables → write the conclusion as a comment
```

### 2. Headless batch export (functions + HLIL)

```python
import binaryninja, json
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
out = {}
for f in bv.functions:
    if f.analysis_skip_reason is not None:
        continue
    out[hex(f.start)] = {"name": f.name, "hlil": str(f.high_level_il)[:2000]}
with open("out.json", "w") as fp:
    json.dump(out, fp, indent=1)
```

### 3. Batch-patch a decrypt loop

```python
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
base, key = 0x401000, 0x55
for i in range(0x100):
    bv.write(base + i, bytes([bv.read(base + i, 1)[0] ^ key]))
bv.save()   # confirm you are operating on a copy before writing back
```

### 4. Batch-annotate call sites (comment every function that calls check)

```python
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
target = bv.get_symbol("check_license")   # take it by symbol name
for ref in bv.get_code_refs(target.address):
    bv.get_function_at(ref.address).set_comment(ref.address, "calls check_license")
bv.save()
```

## Implementation lessons (internalized)

- Any walk before `update_analysis_and_wait()` in a headless script is an empty result — wait for analysis first
- Renaming / changing a type by property assignment (`f.name = ...`) is more direct than an API call; but every change is persisted only by `bv.save()`
- Before writing memory, `bv.read` and record the original bytes; a patch operates on a copy of the file
- The IL level affects the conclusion: HLIL is the most readable but may drop detail; when MLIL does not match the disassembly, drop to LLIL and cross-check
- `get_code_refs`/`get_data_refs` are the core of a scripted location chain — the batch replacement for clicking xrefs by hand

## Usage notes

- Run everything inside the sandbox ([[re-analyze/platform-tips]] supreme rule); a script that triggers dynamic execution defaults to inside the sandbox
- Write conclusions into [[re-analyze/analysis-contract]]; file them against the [[re-triage]] survey values
