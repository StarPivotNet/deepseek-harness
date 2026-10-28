# Keygen-recovery decision tree and evidence grading

## Scenario decision tree (entry → branches)

### 1. Prerequisite judgment (level 1)

```
You have the check algorithm (from the re-license check-point list)
├─ Are all check points local?
│  ├─ No (server-side verification / activation-count records) → handle the online/server part first, or report it honestly (follow [[re-license]] step 4)
│  └─ Yes → continue
├─ Does the algorithm contain a one-way part (hash / RSA / ECC verify)?
│  ├─ Yes → the irreversible segment goes to [[re-patching]]; model only the reversible segment
│  └─ No → enter classification (section 2)
└─ Is the input source clear (username / machine code / constants)? No → return to [[re-license]] and finish input tracing
```

### 2. Algorithm classification tree (reversibility judgment + generation strategy)

```
Check method
├─ Equality compare (serial == f(name)) → directly serial = f(name) (the compare inverts into generation)
├─ Transform type
│  ├─ XOR / bitwise        → symmetric, invert directly
│  ├─ Modular arithmetic   → modular inverse pow(a,-1,m) (when gcd(a,m)≠1, fall back to enumerating candidates)
│  ├─ LCG / linear recurrence → state = a^{-1}(state'-c) mod m
│  └─ Shift / mix          → invert bit by bit; watch carry and masks (32/64-bit)
├─ Table-lookup type
│  ├─ The table is bijective → inverse map
│  └─ The table is not bijective → list every candidate (constraint filter)
├─ Check-digit type
│  ├─ Luhn / mod 97 / mod 11 → data digits first, check digit after
│  └─ CRC16/32           → linear over GF(2); you can solve "pad so the CRC matches"
├─ Encrypt/decrypt type (symmetric) → reuse the decryptor as the generator ([[re-crypto-id]] identify → [[re-crypto-decrypt]] recover)
└─ One-way type (hash / signature) → irreversible → go to [[re-patching]]
```

### 3. Implementation-strategy branches (level 2)

```
After classification
├─ Few transform steps and they are clear → forward (invert line by line)
├─ Compare chain / several equations → z3 constraint solving (symbolic variables + length / charset / bit-width constraints)
├─ Many steps but mechanical → forward is primary, line-by-line against the decompilation (comment-comparison method)
└─ Generate-and-check self-test → the generator embeds the check logic, and the output must pass the check again
```

### 4. Verification branches (close-out)

```
Generator output
├─ Run every check point of the target program inside the sandbox → pass → done; the conclusion goes into [[re-analyze/analysis-contract]]
├─ Rejected
│  ├─ Normalization difference (case / separators / zero-padding) → fix normalization and retry
│  ├─ Check-digit order / radix wrong → walk back digit by digit from a known-valid serial
│  ├─ Overflow / endianness wrong → break at the compare in a debugger and look at intermediate values
│  └─ Still rejected and it is not a format problem → look for a second check point (a missed multi-check-point)
└─ Regression on several inputs (different usernames / machine codes) → done only when all of them pass
```

## Evidence grading table

| Level | Evidence form | Example | Use |
|---|---|---|---|
| A strong | The generate-to-program chain closes | The generated serial passes every check point of the sandboxed program, and a known-valid serial walks back consistently | You may conclude "the recovery is correct" |
| B medium | Generate-to-self-check closes | The script's self-check function passes but it was not verified in the real program (the program environment is missing) | Mark "pending program-side verification" |
| C weak | Partial recovery | Only some transforms were recovered, and constraints are still unmet | Do not publish it as a usable generator |
| Counterevidence | Difference located | An intermediate-value comparison shows one step does not match | Record the difference point, fix it, and re-verify |

- The conclusion must name the verification environment (sandboxed program version, check-point coverage). Passing only the startup check ≠ passing every check point

## Lessons internalized

- Format before algorithm: list the serial-format constraints in full first (length / charset / check-digit position). The generator's output frame comes first, and the algorithm result is filled into the frame
- Classification decides the tool: an equality compare does not need z3, and a one-way type should not be forced into constraints — classify first, then pick the implementation strategy, and cut wasted work
- Line-by-line comment comparison is the most stable recovery method: "rewriting by feel" is the first source of misalignment
- A known-valid serial is the golden test vector: break the check function in the program, record intermediate values, and compare them digit by digit with the script's intermediate values. One comparison locates the misalignment
- Multi-check-point awareness: after startup passes, verify point by point against the full [[re-license]] list (feature points / activation count / validity period)
- Overflow and endianness are hidden sources of difference: 32-bit multiply/shift, big-endian vs little-endian, unsigned vs signed — make the semantics of each transform explicit before writing code

## Usage notes

- All verification is inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]); the generator is used only inside an authorized scope (your own software / testing / research)
- Report irreversible parts honestly. Do not fake "recovery succeeded". This skill only describes algorithm structure and method. It does not cover a crack procedure for a specific product
