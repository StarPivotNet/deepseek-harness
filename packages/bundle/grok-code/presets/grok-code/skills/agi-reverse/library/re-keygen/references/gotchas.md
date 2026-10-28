# Keygen-recovery methodology pitfalls and boundaries

## Reversibility-boundary group

- **A one-way function has no generator**: hash, RSA/ECC verify, and KDF-class checks are irreversible — forward generation is impossible; z3 has no solution on this kind of segment (unsatisfiable constraints are not a bad model); an honest report plus a handoff to [[re-patching]] is the correct path. Do not fake "recovery succeeded"
- **"Reversible" means the algorithm structure is reversible, not that every step is**: a mixed algorithm is often "reversible segment + one-way segment" — generate the reversible segment and skip the one-way segment (for example a check digit is computed on only one side); mark reversibility per segment
- **Server-side generation is a hard boundary**: when the serial is issued by the server (the local side only checks the response/signature), a complete local algorithm still cannot produce a valid serial — the generation logic is on the other end. Confirm ownership before starting (counterexample: treating response verification as the generation algorithm, and wasting the effort)
- **A second verification is a hidden boundary**: the program may also check the serial online / by activation count / by validity period — locally reversible ≠ fully usable. Do not conclude before a full-chain verification

## Number-theory and bitwise-pitfall group

- **When a modular inverse exists**: `pow(a, -1, m)` has a solution only when gcd(a,m)=1 — when they are not coprime, fall back to enumerating candidates or restate the constraint
- **32-bit overflow is the default semantics**: a 32-bit multiply/add in the decompilation overflows unsigned in C — a python implementation must `& 0xFFFFFFFF` (or 0xFFFFFFFFFFFFFFFF). A missing mask is a common cause of "off by one bit / even-right even-wrong"
- **Endianness and width**: little-endian/big-endian and BYTE/WORD/DWORD/QWORD mixed (common when a serial is processed in segments) — when struct-unpacking, check the width of each segment
- **Signed trap**: a compare that is signed (jge/jg) while generation is unsigned will be wrong — look at the decompiled jump (jg/jge vs ja/jae) to judge signedness
- **Carry and truncation**: an intermediate carry is discarded (an 8-bit operation in a 32-bit register) — during line-by-line comparison, watch the operand width of each instruction
- **CRC is linearly constructible**: CRC16/32 is a linear map over GF(2) — you can solve "append N bytes so the CRC equals the target" without brute force; but where the CRC participates (before/after the data) decides the solve direction

## Format and normalization group

- **The program normalizes before it compares**: tolower / strip spaces / strip separators / zero-pad / truncate to a fixed length — the generator must do the same normalization first, or the algorithm is right and the output is still rejected (confirm character by character against the compare code in [[re-license]] step 3)
- **Ambiguous charset**: easily confused characters (0-O, 1-I) are often excluded; a wrong charset judgment makes a generated serial "look valid but the program does not accept it"
- **Separator variety**: the program may accept with and without separators, and different separators (- / space) — list the format constraints in full first, and switch the output as needed
- **Check-digit order counterexample**: a check digit may participate in the next round (a rolling check). It is not a simple "data digits + trailing check" — walk the check process back digit by digit from a known-valid serial and confirm the order

## Verification-method group

- **Comparing intermediate values in a debugger is the tool that locates the error**: break at the compare instruction, record the program's internal intermediate values (registers/stack), and compare them digit by digit with the script's intermediate values — one comparison locates a one-step misalignment, faster than repeated trial and error
- **A known-valid serial is the test vector**: feed a serial the program already accepts back into the generator script — a mismatched output means the recovery is wrong; only a match may enter full-chain sandbox verification
- **Startup passing ≠ done**: a second check point such as a feature point / timer / upgrade check may fire later — verify point by point against the full [[re-license]] check-point list
- **Record the verification environment**: sandboxed program version, check-point coverage, OS differences (Wine vs native Windows behavior can differ) — annotate the conclusion with the environment

## Usage notes

- Generation and verification are entirely inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]); products are used only inside an authorized scope (your own software / testing / research). No crack procedure for a specific product is provided
- Mark analysis conclusions by the [[decision-tree]] evidence grades (A full chain closed / B self-check closed / C partial)
