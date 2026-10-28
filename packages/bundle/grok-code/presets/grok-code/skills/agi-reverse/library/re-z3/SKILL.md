---
name: re-z3
description: Z3 constraint solving: modeling, key/flag derivation. Triggers: z3, `约束求解`, solver, SMT
capabilities: [constraint-solving]
---

# Z3 constraint solving (modeling / key and flag derivation)

## When to use / when not to use

- Use: decompilation recovered a set of comparison chains / math equations that "a legal input must satisfy" (for example serial = f(username), or a flag satisfies a per-byte relation), and inverting it by hand is tedious, so you hand it to a solver
- Use: key / flag derivation for a CTF reverse challenge / crypto challenge (the check logic is pure deterministic computation, with no syscall dependency)
- Use: you already have a loop body expanded by hand (per-bit XOR / shift / add-sub) as constraints, and you want to check whether the constraint set is complete (see pitfall 4)
- Do not use: the input is checked byte by byte inside a long loop, and the loop is not expanded — use [[re-angr]] symbolic execution first, or expand it by hand first (this skill requires constraints to be restored as expressions first; see pitfall 2)
- Do not use: the constraints contain an irreversible operation such as a hash / asymmetric signature check — Z3 cannot do SHA / RSA signature verification (see pitfall 3)
- Do not use: you need the whole path condition rather than a constraint set — [[re-angr]] is a better fit
- Note: modeling must follow the decompiled pseudocode line by line ([[re-ghidra]] / [[re-ida]] / [[re-radare2]] products). Run the original program on the solved result to verify (sandbox, top rule in [[re-analyze/platform-tips]])

## Tool setup

Follow the top rule in [[re-analyze/platform-tips]] — solving itself does not execute the target, but running the target on the solved result to verify defaults to a sandbox.

### z3-solver (pip install)

- `pip install z3-solver` (Linux / macOS / Windows all provide a prebuilt wheel; a pure Python binding + a native library, simple to install)
- If mixing with the system package manager conflicts (the system z3 is old): `pip install --upgrade z3-solver` first, or install inside a separate venv
- Verify: `python3 -c "import z3; print(z3.get_version_string())"`
- No network: an offline wheel (`pip download z3-solver`, then copy it in) or the system package `apt install z3` (note that the system z3 Python binding differs in API from the pip build; the pip build is recommended)

### python3

- Linux: `apt install python3` (usually already present); macOS: `brew install python`; Windows: the official installer / `choco install python`
- Verify: `python3 --version`

### Decompilation product (the raw material for restoring constraints)

- Decompiled pseudocode of the check function from [[re-ghidra]] / [[re-ida]] / [[re-radare2]] — the comparison chain, each arithmetic / XOR / table-lookup transform, and the final compare (strcmp / check digit / per-bit compare). Export function-level pseudocode as the line-by-line modeling reference (see pitfall 4)
- Verify: the pseudocode fully covers every constraint that "a legal input must satisfy"

## Steps

Run in order. Record each step's result (constraint list / modeling script / solver output / verification result; evidence paths are in [[re-triage]]).

1. **Restore constraints from decompilation (comparison chain / math relation)**:
   - List **every** constraint that "a legal input must satisfy": input source (user input / file name / ciphertext), each transform (arithmetic / XOR / shift / table lookup), and the final compare (`if (a == b)` / check digits equal / per-byte strcmp)
   - Turn each one into a math expression and write a list (pseudocode line → constraint, one to one; see pitfall 4):
     - `if (x * 3 + 5 != 0x100) fail` → `x*3 + 5 == 0x100`
     - loop already expanded: `for (i=0;i<8;i++) out[i]=in[i]^key[i]; if(strcmp(out, s)) fail` → 8 constraints `in[i]^key[i] == s[i]`
   - **Do not skip any line** — a skipped line is a missed constraint (see pitfall 4). When you hit an irreversible stretch (a hash), mark it first; see pitfall 3

2. **BitVec / Int modeling**:
   - Mostly bitwise (XOR / shift / bitwise and) → use **BitVec**, with the width aligned to the decompiled semantics (a 32-bit operation uses `BitVec('x', 32)`; per-byte uses 8 bits)
   - Pure math relations (add/sub/mul, compare magnitude, no bitwise ops) → **Int** is faster (but overflow semantics differ from C; see pitfall 5)
   - Model by input structure: per-character processing → an array of 8-bit BitVecs, or slices of a large BitVec:
     ```python
     from z3 import *
     s = Solver()
     inp = [BitVec(f'inp_{i}', 8) for i in range(8)]      # 8-byte input
     ```
   - **A width mismatch fails immediately**: adding `BitVec(..., 8)` and `BitVec(..., 32)` directly raises TypeError / unsat — unify the widths; see pitfall 5

3. **solver.check / model**:
   - After every constraint is `s.add(...)`: `r = s.check()` — `sat` / `unsat` / `unknown`
   - `sat` → `m = s.model()` takes the solution; `unsat` → the constraint set contradicts itself (see pitfall 4 / pitfall 5); `unknown` → nonlinear / a complex expression (see pitfall 3)
   - Extract byte by byte: `''.join(chr(m[inp[i]].as_long()) for i in range(8))` (a BitVec value uses `as_long()`)
   - Solving is not one shot: add **bound constraints** before check (see step 4). On `unsat`, comment constraints out one by one with `s.assertions()` (see pitfall 4)

4. **Bound (length / charset) constraints**:
   - **Add bounds before solving** (an unbounded variable slows the solve or runs away; see pitfall 1):
     ```python
     for c in inp:
         s.add(c >= 0x20, c <= 0x7e)      # printable ASCII (flag scene)
     s.add(inp[0] == ord('f'))            # a known format head such as flag{ is fixed bit by bit
     ```
   - Length constraint: a fixed input length (`inp[7] == ord('}')`). Fill check-digit / separator format from the decompilation
   - Parts already known from the challenge clue / format (`flag{...}`) are **fixed directly as equalities**, which speeds the solve a lot
   - After the bounds are added, verify at small scale first: comment out some constraints, run once, and look at solve time and whether the solution is reasonable

5. **Emit the flag / key**:
   - Assemble the output: join the byte array in order into a string / hex, write it to `flag.txt` (or a key binary), and print repr at the same time (printability check)
   - Multiple solutions: `while s.check() == sat: take the solution → s.add(Or(each byte != the current solution))` enumerates them, and compare with what the challenge expects (see pitfall 4)
   - Verify: inside a sandbox ([[re-sandbox]]), feed the solved output to the target program unchanged (stdin / argument / file). The check must pass / the flag must print. Then cross-check against [[re-angr]] / a manual restoration

## Related skills

- [[re-ctf]]: this skill is the constraint-solving path of re-ctf gateway workflow step 3 ("a set of equations that, once satisfied, is the flag / key")
- [[re-binary-core]]: the decompiler workbench ([[re-ghidra]] / [[re-ida]] / [[re-radare2]]) — the raw material for restoring constraints. [[re-triage]] first look confirms architecture and bitness (the basis for width modeling)
- [[re-angr]]: the sister skill — a long loop that checks byte by byte uses angr symbolic execution. An already-expanded / loop-free constraint set is lighter and faster with this skill. When angr solves slowly, move a constraint subset to z3
- [[re-keygen]] / [[re-license]]: keygen scene — model and solve the equation set serial = f(username / machine code) (re-keygen Tool setup lists z3 as an optional approach; the re-cracking gateway uses it as the hard push beyond irreversible algorithms)
- [[re-crypto-id]] / [[re-crypto-decrypt]]: key / plaintext derivation for custom crypto (model the reversible part of the equations; a pure hash part is pitfall 3)
- [[re-sandbox]]: the sandbox that runs the solved result to verify (top rule in [[re-analyze/platform-tips]])
- [[re-patching]]: when the constraints are unsolvable (they contain an irreversible stretch), switch to a patch bypass to verify

## Pitfalls

- **Unbounded variables → a slow solve / runaway**: symptom — `s.check()` does not return for tens of minutes, or memory explodes; cause — symbolic variables have no value-range constraint, and the solver walks a huge space (especially mul/div / shift combinations); fix — **add bounds before solving** (step 4: length / charset / width upper bound). Fix known format bits (the `flag{` head) directly. If it is still slow, tighten the bounds and verify stretch by stretch
- **Width mismatch → unsat / an error**: symptom — `unsat` even though the constraints are obviously satisfiable by hand, or `TypeError: unsupported operand`; cause — BitVecs of different widths were mixed (adding 8-bit and 32-bit, inconsistent shift width), or C's implicit integer promotion was not modeled (`char` arithmetic promotes to `int` and is then truncated); fix — check the operation width against the pseudocode one by one (a 32-bit multiply whose result keeps only the low 32 bits = add `Extract(31,0)`). Restore the **smallest complete semantics** first, then relax (see pitfall 5)
- **Poor support for nonlinear operations → change approach**: symptom — `check()` returns `unknown`, or a solve that contains multiply / xor combinations is extremely slow; cause — nonlinear polynomials (mul/div, some bitwise combinations) are hard for an SMT solver; fix — simplify by hand first when you can (XOR symmetry, constant folding, eliminate with a modular inverse `pow(a,-1,m)`). Still unknown → switch to [[re-angr]] symbolic execution of the whole path, or brute force bit by bit (split the constraints into single-byte solves). **Give up modeling a hash / signature-check stretch** (irreversible), and switch to [[re-patching]] / an honest report
- **A missed constraint → a wrong solution**: symptom — an input that "satisfies" the solve is rejected when the program runs; cause — a line of decompiled pseudocode was not turned into a constraint (a length check, a charset allow-list, a boundary if branch, an extra check digit), or the solver gave one solution while the challenge wants a specific one; fix — check the constraint list against the pseudocode line by line (the one-to-one table from step 1), and add the missed if / check into `s.add`. When there are multiple solutions, enumerate every solution and run it on the target (step 5). When hunting `unsat`, comment constraints out one by one to locate the contradiction
- **Overflow / signed semantics were not modeled**: symptom — the solved numeric result does not match what the program actually computes (right on even cases, wrong on odd); cause — C's 32-bit signed overflow (`int` multiply wrap), shift direction (`>>` arithmetic / logical), and endianness (a big-endian target) were not aligned; fix — determine the target architecture and bitness ([[re-triage]]). Model signed operations with `BitVec(..., 32)` + sign extension, or switch to Int plus a range constraint that simulates wrap (`s.add(a == (b * c) % 2**32)`). Endianness follows the target (most CTF challenges are little-endian)
- **Forcing a long loop into z3 (a challenge that should use angr)**: symptom — a long per-byte check loop is expanded into constraints by hand, the expansion is wrong and causes unsat, or the solve is extremely slow after expansion; cause — loop-invariant extraction / the expansion method is wrong, and the expansion is large; fix — a long loop / a deep comparison chain uses [[re-angr]] symbolic execution first (it handles loops and paths automatically). z3 only takes over "no loop, a pure equation set" (a comparison chain extracted directly from Ghidra decompilation). Cross-check the two results
- **PRNG state-recovery problems may return a wrong model**: symptom — `check()` returns sat and the model numbers look reasonable, but substituting back into the original program (for example an xorshift128+ generator) does not match the output, or there is simply no solution; cause — some bit-vector problems (recovering PRNG internal state) are a known hard case for SMT solvers (Z3 4.12.x has a known failure recovering the dual 64-bit state of xorshift128+ from two outputs); fix — the result must be cross-checked: replay the model in the target program ([[re-sandbox]]), enumerate multiple solutions, or compare with [[re-angr]] / brute force (when the key space is small). sat does not guarantee correctness
- **Hard-coding an "observed value" as a constant assertion → a false unsat**: symptom — `unsat`, but a manual check shows the constraints are obviously satisfiable; cause — an experimentally observed intermediate value was asserted directly as an equality (for example `RNG(seed).next(26) == 57508594`, while the computation actually yields 14325532), so the equality is permanently false; fix — do not assert intermediate observed values first. Assert only the input-output relation and let Z3 infer the unknown. When an intermediate value really must be fixed, use `m.eval()` first to check that the observed value itself agrees with the model
