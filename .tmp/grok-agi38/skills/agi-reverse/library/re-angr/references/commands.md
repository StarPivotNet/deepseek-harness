# angr command cheat sheet and operation sequences

angr is a Python library and has no CLI — a "command" is an API call. All usage follows the official docs (docs.angr.io) and the target version's source; version differences are in [[gotchas]].

## Load family (Project)

```python
import angr, claripy
p = angr.Project("./target", auto_load_libs=False)   # disable library load: faster and more stable (the default differs by version)
p.loader.main_object.mapped_base                     # actual load base (check this first on a PIE target)
p.loader.main_object.entry                           # entry point
p.factory                                             # state/block factory
p.factory.block(addr).vex                             # take VEX IR (assembly-level cross-check)
```

## State family (State)

```python
s = p.factory.entry_state()                          # from the entry
s = p.factory.full_init_state(stdin=claripy.BVS('in', 32*8))            # symbolic standard input
s = p.factory.full_init_state(args=["./target", claripy.BVS("arg1", 64*8)])  # symbolic argv
s = p.factory.blank_state(addr=0x401000)             # start at an arbitrary address (common for a check-function entry)
s.regs.rax = claripy.BVS('rax', 64)                  # set a symbolic register
s.mem[0x601000].int32 = ...                          # symbolic memory write
s.posix.dumps(0)                                     # current stdin contents (common in a find condition)
s.solver.eval(...) / s.solver.add(...)               # this state's solver
# state options (behavior of uninitialized memory/registers)
opts = {angr.options.ZERO_FILL_UNCONSTRAINED_MEMORY, angr.options.ZERO_FILL_UNCONSTRAINED_REGISTERS}
s = p.factory.entry_state(add_options=opts)
```

## Filesystem family

```python
s.fs.insert('/tmp/in', angr.SimFile('in', content=claripy.BVS('in', 32*8)))  # symbolic file
# after the program fopen('/tmp/in'), reads are symbolic; fd operations go through s.posix.fd[0] (0=stdin; 1/2 are stdout/stderr — do not mix them)
```

## SimManager family (path exploration)

```python
simgr = p.factory.simgr(s, veritesting=True)         # veritesting merges paths (common on long-loop challenges)
simgr.explore(find=0x401100, avoid=[0x401200, 0x401300], num_find=1)  # illustrative addresses: replace with the target's real entry/branches; stop when found
simgr.found / simgr.deadended / simgr.active         # each stash
simgr.move('deadended', 'active')                    # stash operation
simgr.run(n=100)                                     # manual step cap
simgr.prune()                                        # drop paths that are already unsatisfiable
```

## Solve family (claripy / solver)

```python
inp = claripy.BVS('inp', 32*8)                       # symbolic variable (bit width = byte count * 8)
claripy.BVV(0x41, 8)                                 # concrete value
solver = found.solver
solver.add(inp.get_byte(0) == ord('f'))              # add a constraint (byte by byte)
flag = solver.eval(inp, cast_to=bytes)               # evaluate
solver.satisfiable()                                 # satisfiability check
solver.min(inp) / solver.max(inp)                    # extrema (common for a length constraint)
for c in flag_sym.chop(8): solver.add(0x20 <= c, c <= 0x7e)   # printable-character constraint
# eval timeout and count: solver.eval(expr, n=..., cast_to=bytes, timeout=...) as needed
```

## Hook family (response to path explosion)

```python
project.hook(addr, angr.SIM_PROCEDURES["stubs"]["ReturnUnconstrained"]())  # replace at an address
project.hook_symbol("sleep", angr.SIM_PROCEDURES["libc"]["sleep"])          # replace by symbol
project.hook_symbol("rand", angr.SIM_PROCEDURES["libc"]["rand"])            # pin a random value
project.unhook(addr) / project.unhook_symbol("sleep")                        # restore
# SIM_PROCEDURES categories: "stubs" generic stand-in / "libc" / "linux_kernel" / "posix" and others
```

## Analysis family (other built-in analyses)

```python
p.analyses.CFGFast()              # fast control-flow graph (find key functions / loop bounds)
p.analyses.CFGEmulated()          # emulated CFG (heavy / slow)
p.analyses.BackwardSlice(...)     # backward slice (locate input bytes that affect the output)
p.analyses.VariableRecovery(...)  # variable recovery
```

## Operation sequences (combined playbooks)

### 1. CTF find/avoid standard template (argv variant)

```python
import angr, claripy
p = angr.Project("./target", auto_load_libs=False)
arg = claripy.BVS("arg1", 64*8)
s = p.factory.full_init_state(args=["./target", arg])
simgr = p.factory.simgr(s, veritesting=True)
simgr.explore(find=0x401100, avoid=[0x401200, 0x401300])   # illustrative addresses: replace with the target's real entry/branches
if simgr.found:
    print(simgr.found[0].solver.eval(arg, cast_to=bytes))
```

### 2. Symbolic file input (fopen-read style)

```python
s = p.factory.full_init_state()
s.fs.insert('/tmp/in', angr.SimFile('in', content=claripy.BVS('in', 0x40*8)))  # length follows the read cap
simgr = p.factory.simgr(s)
simgr.explore(find=..., avoid=...)
sol = simgr.found[0].solver.eval(s.fs.get('/tmp/in').content, cast_to=bytes)
open('flag.bin','wb').write(sol)     # verify inside the sandbox: ./target < flag.bin
```

### 3. blank_state starting at the check-function entry (skip unrelated code)

```python
# locate the check-function entry and the argument convention in the decompiler ([[re-ghidra]])
s = p.factory.blank_state(addr=check_entry, add_options={angr.options.ZERO_FILL_UNCONSTRAINED_REGISTERS})
s.regs.rdi = claripy.BVS('inp', 32*8)     # place arguments per the calling convention
s.mem[s.regs.rsp] = 0x0                   # minimal stack frame (return address)
simgr = p.factory.simgr(s)
simgr.explore(find=success_addr, avoid=fail_addr)
```

### 4. Speed up a loop challenge (hook + veritesting + stages)

```
hook unrelated calls (sleep/memset/rand) → simgr(veritesting=True)
still slow: explore to the loop-boundary address → symbolically unroll the loop body alone (locate the loop invariant by hand)
still exploding → switch to [[re-z3]] and model the already-unrolled constraints
```

## Implementation lessons (internalized)

- `auto_load_libs=False` is the default recommendation: loading libraries is both slow and bloats the solve space; unpack a packed sample first ([[re-deobfuscate]]), then run symbolic execution
- Fill find/avoid addresses **in angr's load base** (a PIE target differs from Ghidra's displayed base by a fixed offset); comment the conversion at the top of the script
- `repr()` a solved value before replaying it: non-printable characters usually mean the symbolic length is shorter than the length actually read
- For an expression that divides, add an explicit "denominator nonzero" constraint (Z3 evaluates a/0 as all ones) — see [[gotchas]]
- On an explore timeout, set a seconds-scale cap with `simgr.explore(..., timeout=...)` or `s.solver.eval(..., timeout=...)`; do not wait forever
- `eval(expr, cast_to=bytes)` is meaningful only for symbols whose width is a whole number of bytes; per byte, use `get_byte(i)`/`chop(8)`
- When one target needs several solve rounds, parameterize the script (put find/avoid/length/channel in a header comment) and vary one parameter at a time; do not rewrite the whole script for one change

## Usage notes

- Solving finishes inside the in-process emulator and needs no sandbox; **running the target to verify a solved result defaults to the sandbox** ([[re-analyze/platform-tips]] supreme rule)
- Archive results (addresses / constraints / solve script / flag) with sha256 + path ([[re-triage]] evidence chain); conclusions go into [[re-analyze/analysis-contract]]
