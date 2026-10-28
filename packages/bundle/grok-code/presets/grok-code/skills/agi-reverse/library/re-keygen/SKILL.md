---
name: re-keygen
description: Keygen algorithm recovery. Triggers: `注册机`, keygen, `算法还原`, `序列号生成`
capabilities: [license-analysis]
---

# Keygen algorithm recovery (keygen)

## When to use / when not to use

- **Boundary (inherited from [[re-cracking]])**: limited to your own software / authorized testing / a CTF or research environment; unauthorized software unlock and commercial-software bypass are forbidden; keygen products must not be spread or distributed
- Use: you already have the check algorithm from [[re-license]], and the algorithm is reversible (a compare / transform / table lookup can be inverted into generation steps)
- Use: you need to generate a valid serial for an arbitrary input (username / machine code) (distribution, testing, verification scenarios)
- Use: a distribution plan that does not modify the target file (cleaner than [[re-patching]]; it does not trigger a self-check / signature problem)
- Do not use: the check points / check algorithm have not been located yet (do [[re-license]] first)
- Do not use: the algorithm contains an irreversible part (hash / asymmetric verify) — forward generation is impossible. Switch to [[re-patching]] (see pitfall 1)
- Do not use: the serial is a random value generated on the server and then delivered (the generation logic is on the server; the local side only checks)
- Do not use: the program also does a second server-side verification of the serial (reversible generation logic is still useless; confirm the full check-point list first)
- Note: a generated serial must be verified inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]); cross-check it against a legitimate serial (see pitfall 4)

## Tool setup

### Decompiler output (the raw material for algorithm recovery)

- Decompiled pseudocode of the check function from [[re-ghidra]] / [[re-ida]] / [[re-radare2]] (from [[re-license]] step 3); export function-level pseudocode and the compare chain (`pdf @ sym.check_license` and similar) as the line-by-line translation cross-check (see pitfall 4)
- Verify: the decompiler view fully shows the check function's compare / transform statements

### python3 (keygen implementation)

- Linux: `apt install python3` (usually already present); macOS: `brew install python`; Windows: `choco install python` / the official installer
- Verify: `python3 --version`
- The python standard library is enough (argparse/struct/hashlib/re); for bit-width arithmetic watch the mask (`& 0xFFFFFFFF` simulates 32-bit unsigned overflow)

### z3-solver (optional, constraint solving)

- `pip install z3-solver`
- Verify: `python3 -c "import z3; print(z3.get_version_string())"`
- Fits: the check is a "compare chain / mathematical relation" (for example the serial satisfies several equations), and modeling a solve is easier than inverting by hand (the modeling idea is in [[re-z3]])
- Note: z3 models only the reversible part; a pure hash / signature part has no solution (see pitfall 1)

### Debugger (optional, intermediate-value comparison)

- [[re-x64dbg]] (Windows) / [[re-gdb]] (Linux / Wine) / [[re-lldb]] (macOS) — break at the compare instruction and look at the program's internal intermediate values, and compare them one by one with the script's intermediate values (the method in pitfall 4)

## Procedure

Run in order and record each step (algorithm pseudocode / generation script / verification result; evidence paths in [[re-triage]]). **The input/output list comes first**: inputs (username / machine code / fixed constants), output (serial format), compare method (equal digit by digit / check digit).

1. **The check algorithm obtained from [[re-license]]**:
   - Take the algorithm pseudocode from the check-point list: input source (read the registry / user input / machine code), transform steps (each arithmetic / XOR / table lookup), and the final compare method (strcmp / check digit / signature verify)
   - List every constraint a "valid serial must satisfy" (format length, charset, check digit, relationship to the input) and write it into the algorithm document

2. **Serial-format analysis (before the algorithm)**:
   - Length / charset (digits / uppercase / mixed) / separators (`XXXX-XXXX-XXXX`) / case sensitivity / check-digit position (trailing / a fixed position)
   - Example: `ABCD-1234-EFGH-5678` may be 4 groups × 4 characters + a check group — the format constraints decide the generator's output frame. Generate a candidate in that format first and then fill in the algorithm result. That errs less than finishing the algorithm and then forcing a format
   - Format and algorithm are coupled: confirm whether separators participate in the check (two common classes: compare digits only / compare the whole string). Whether they participate changes the generator's segmentation logic

3. **Algorithm classification and reversibility judgment**:
   - **Equality-compare type** (`serial == f(name)`): directly `serial = f(name)` — reverse the compare direction
   - **Transform type** (arithmetic / XOR / shift): XOR is symmetric and inverts directly; modular arithmetic uses a modular inverse (`pow(a, -1, m)`, needs gcd(a,m)=1); LCG walks backward (`state = a^{-1}(state' - c) mod m`)
   - **Table-lookup type**: invert the map (input→output becomes output→input); when the table is not bijective, list every candidate
   - **Check-digit type** (Luhn / CRC16/32 / mod 97 / mod 11): compute the data digits first, then fill the check digit; CRC is linear over GF(2), and you can solve for suffix bytes that "make the CRC equal the target"
   - **Encrypt/decrypt type** (XOR / base64 / a custom symmetric transform): reusing the decryptor inverted is the generator (the [[re-crypto-id]] / [[re-crypto-decrypt]] idea)
   - **One-way type** (hash / RSA / ECC verify): irreversible — report that part honestly and go to [[re-patching]] (see pitfall 1)
   - Write each class's conclusion into the algorithm document: the type judgment + the inversion basis (which step is reversible, which is not)
   - Mixed types are common: a transform plus a check digit stacked (data digits go through the transform, then a check is added to the whole) — invert layer by layer, "transform layer → check layer", and verify each layer alone

4. **Invert into a generation algorithm (forward / constraint solving)**:
   - **Forward**: reverse the check direction — turn a compare into a generation (`if (x == f(name)) ok` → `serial = f(name)`); a symmetric XOR inverts directly; a table lookup produces an inverse map; modular arithmetic uses a modular inverse (`pow(a, -1, m)`)
   - **Constraint solving**: model a compare chain / mathematical relation in z3, with symbolic variables + constraints (length / charset / bit width), then solve any valid input:
     ```python
     from z3 import *
     s = Solver()
     c = BitVec('c', 32)                      # the 32-bit part of the serial
     s.add(c ^ 0xDEADBEEF == c * 3 + 0x55)    # a constraint from the decompilation
     s.add(c & 0xFF == 0x5A)                  # a check-digit constraint
     print(s.check(), s.model() if s.check() == sat else '')
     ```
   - Align bit width and endianness with the decompiled semantics (unsigned / signed, little-endian / big-endian; see pitfall 4)
   - When constraints are incomplete, add them first: length / charset / bit width each cut the solution space — when z3 is unsat, relax them one by one to locate the contradictory constraint (modeling detail is in [[re-z3]])

5. **Implement the keygen in python**:
   - Write `keygen.py`: `argparse` takes the input (username / machine code), generates the serial internally by the inverted steps, and prints it in the format (with / without separators)
   - Cross-check the decompiled pseudocode line by line (each transform line corresponds to a piece of the implementation, with a comment). Do not "rewrite by feel"
   - A built-in unit test: generate → run the check algorithm again and it must pass (also write the check logic into the script as a self-check function)

6. **Handling boundaries (check code / check digit)**:
   - Common check digits: Luhn (bank-card class), CRC16 / CRC32, mod 97 / mod 11, a length digit, a separator format (`XXXX-XXXX-XXXX`); compute the data digits first → fill the check digit
   - Charset: uppercase / digits / drop easily confused characters (0-O, 1-I); the output length must match what the program requires exactly
   - Normalization: before generating, run the program's preprocessing on the input (strip spaces, toUpper, zero-pad) so it matches the check side (see pitfall 3)

7. **Multi-platform output (a CLI script)**:
   - Pure python3 standard library (argparse is enough; avoid platform differences); Linux / macOS / Windows can all `python3 keygen.py --name Alice`
   - Optional output formats: with / without separators, batch generation (for several test groups)
   - The script carries a verify mode: `--verify` runs the check logic backward on an input serial and prints only if it passes (a self-check loop)

**Verification**: inside a sandbox ([[re-sandbox]]), run the target program with the generated serial — it must pass **every** check point on the [[re-license]] list (startup + feature points); then cross-check the script output against a serial the program already accepts (see pitfall 4). File the conclusion and the algorithm document in [[re-analyze/analysis-contract]].

**Black-box regression**: batch-generate and batch-verify several different inputs (a long username / digits only / an empty string / boundary characters) — cover normalization and boundary branches, and avoid passing on only one input.

## Cross-domain

- [[re-cracking]]: this gateway is re-cracking workflow step 5 (keygen). Step 6 is the unified verification
- [[re-license]]: upstream — the check algorithm and the input source (machine-code binding is its step 5) come from the caller of this skill; this skill's product can also re-check that re-license's algorithm recovery is correct
- [[re-patching]]: alternatives — an irreversible algorithm / a quick bypass uses a patch; check points this skill cannot cover (the irreversible part) are handed to the patch
- [[re-binary-core]]: the decompiler workbench ([[re-ghidra]] / [[re-ida]] / [[re-radare2]])
- [[re-crypto-id]] / [[re-crypto-decrypt]]: identification and recovery ideas for the serial encrypt/decrypt stage (XOR / table lookup / a custom transform)
- [[re-sandbox]]: the sandbox that verifies a generated serial (top principle in [[re-analyze/platform-tips]])
- [[re-ioc]]: keygen features / serial-generation algorithm fingerprints can be detection features

## Common pitfalls

- **The algorithm contains an irreversible part (hash / asymmetric)**: symptom — the check algorithm contains SHA1 / MD5 / RSA verify, and the keygen cannot generate forward; cause — a one-way function is irreversible, and the serial comes from a private key / an irreversible hash; fix — report it honestly: that part switches to [[re-patching]] (skip the verify / change the branch); z3 models only the reversible part. Do not force the irreversible segment into the constraints
- **Username binding → the generation logic must include the input**: symptom — the generated serial is valid on one machine / one username and invalid when the input changes; cause — the algorithm input contains a machine code / username (machine-code binding in [[re-license]] step 5); fix — the keygen must parameterize the input: the CLI requires a username / machine code, and generation derives from the input (reserve `--name` / `--machine` in the template)
- **Case / format checks**: symptom — the algorithm recovery is correct but the generated serial is rejected by the program; cause — the program normalizes before comparing (tolower / strip separators / zero-pad / a required length), or it requires a specific charset; fix — put the program's normalization steps into the generation logic (normalize the input first, then generate), and confirm character by character against the compare code in [[re-license]] step 3; verify each format (with / without separators) separately
- **The algorithm recovery is off by one bit (overflow / carry / endianness)**: symptom — the hand-written implementation and the program output are always off by one, or even-right and even-wrong; cause — unsigned / signed overflow, carry, endianness differences (especially 32-bit multiply / shift); fix — cross-check the decompiled pseudocode line by line (the comment-comparison method in step 5); use a known-valid serial as the test vector: inside the sandbox, break the check function in the debugger, feed one input, record the program's internal computed values, and compare them one by one with the script's intermediate values to locate the difference
- **A second-layer check was missed**: symptom — the startup check passes and a specific feature still rejects; cause — there are several check points (besides the format check there are feature points / activation count / validity period); fix — verify point by point against the full [[re-license]] check-point list. Do not verify only the startup path
- **Check-digit order / radix confusion**: symptom — the check-digit algorithm is right but it is always off by one digit; cause — the order in which the check digit participates is wrong (data first then check, vs the check digit also counted into the next round), or the radix is wrong (base 10 vs base 16 vs base36); fix — walk the check process back digit by digit from a known-valid serial, confirm the participation order and the radix, and only then implement

Depth methodology (algorithm classification tree / evidence grading / pitfall boundaries): [[decision-tree]] and [[gotchas]]
