# angr tool-specific pitfalls and boundaries

## Version and install pitfalls

- **Python version line**: **the current mainline is 10.x; from 9.3.0 it requires Python 3.12+** (measured from PyPI `requires-python`); **the 9.2.x floor rises with patch versions** (9.2.91 requires ≥3.8, 9.2.203 already requires ≥3.10), so you cannot judge the whole "9.2.x" line — before install, use the target version's PyPI `requires-python` (`pip index versions angr` lists available versions); installing 9.3 on 3.11 is refused outright or fails to compile, and an old 9.2 on 3.13 may have no wheel
- **API changes between major versions**: angr 9.1 (the migration doc has a dedicated page) changed details such as `SimState`/`state.posix`; old tutorials (the 8.x era) using `state.mem` and `simprocedures` may no longer work — follow the target version's docs, "Migrating to angr X"
- **binutils dependency**: when angr processes/rewrites a binary (the `angr.Project` back-end, or binary-rewriting operations unrelated to `angr.SimProcedure`) it calls `objcopy` — install `binutils` on Linux; if it is missing you get an `objcopy: command not found` class of error
- **Windows support boundary**: a pip win32 wheel works on Windows, but some cle/ELF backends and fork-class operations are limited; when you need ELF/arm target analysis, prefer the Linux build inside WSL
- **Multiple environments**: angr's dependency tree is large (pyvex/unicorn/claripy and others); do not drop it into the system interpreter — isolate with a venv, and before an upgrade check whether dependencies must rise together

## Load and address pitfalls

- **PIE base**: angr loads at 0x400000 by default, Ghidra displays at 0x100000 — find/avoid addresses must be converted (check the real base with `p.loader.main_object.mapped_base`)
- **auto_load_libs default**: newer versions default to `auto_load_libs=False` while older versions default to True — the behavior difference makes the same script produce different results; write the argument explicitly and do not rely on the default
- **Packed / statically linked targets**: unpack a packed target first ([[re-unpack-simple]]); a large statically linked binary explodes the state count after load — hook off unrelated library-function entries
- **Architecture / endianness**: angr supports arm/armeb/mips targets, but watch endianness (`archinfo` picks it from the ELF header); confirm with `file target` before creating a Project

## Solver-semantics pitfalls

- **Missing divide-by-zero constraint**: Z3 evaluates `a/b` with a zero denominator as all ones (4294967295) — for an expression that divides, add an explicit "denominator nonzero" constraint
- **Uninitialized registers/memory are automatically symbolic**: `entry_state` creates unconstrained symbols for uninitialized values, the solve space is bloated, and results contain garbage — use `ZERO_FILL_UNCONSTRAINED_MEMORY`/`ZERO_FILL_UNCONSTRAINED_REGISTERS` or set known initial values explicitly
- **float/NaN**: a floating-point path may disagree between Z3 and real hardware (FP rounding / NaN semantics) — for a floating-point check challenge, recover it by hand or model it separately with [[re-z3]]
- **eval return-value trap**: `eval(expr, cast_to=bytes)` returns a symbol whose width is not a whole number of bytes (for example a 6-byte length symbol) aligned to the bit width; when there are multiple solutions, take several with `n=` and replay each one
- **Solve timeout**: eval on a complex constraint set can return nothing for minutes — set an upper bound with `timeout=`, and shrink the search with `solver.min/max`
- **A constraint set ≠ path semantics**: the angr solver holds the path constraints accumulated on that state, not "all program behavior" — an input the solver produces must be replayed as-is inside the sandbox ([[re-analyze/platform-tips]] supreme rule)

## SimProcedure and hook pitfalls

- **Inaccurate summaries**: replacement implementations such as strlen/malloc have bugs or are incomplete, and results are counterintuitive (wrong return / a check bypassed) — when something looks wrong, suspect the summary first: disable that hook or customize it with `project.hook`
- **Hook not removed**: after the hook dispatcher runs, execution jumps back and re-enters the hook, looping forever — unhook immediately after jumping to the target block
- **hook_symbol vs library-call paths**: `hook_symbol` only affects calls resolved by symbol; an indirect call by address needs `project.hook(addr, ...)` attached by address
- **cmovxx does not split branches**: angr implements cmov by accumulating constraints rather than splitting into two states — when you need successor relationships, split manually with `state.copy()` and skip the cmov instruction

## Performance and path-explosion pitfalls

- **Symbolic range**: making the whole program symbolic is the main cause of explosion — symbolize only the bytes the check actually reads, and move the entry as far forward as you can (blank_state)
- **veritesting is double-edged**: merging paths saves states but can lose branch precision (results differ from not merging) — run both and compare
- **stash has no cap**: the default stash does not limit the state count — actively check `len(active)` inside a `simgr.step()` loop, or cap the step count
- **lazy_solves and prune**: when there are many paths, `simgr.prune()` first to drop unsatisfiable paths, or turn on `lazy_solves` to defer solving

## Usage notes

- Solving finishes inside the in-process emulator (sandbox not required); **running the target with a solved result defaults to the sandbox**
- Archive addresses / constraints / scripts / flags in full ([[re-triage]] evidence chain); conclusions go into [[re-analyze/analysis-contract]]
- Split with [[re-z3]]: when you need a precise constraint set rather than one path, z3 is lighter; when angr is slow, move a constraint subset to z3
