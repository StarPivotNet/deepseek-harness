---
name: re-ctf
type: gateway
description: >
  CTF practice gateway. Orchestration: identify the challenge type → a simple challenge goes straight to [[re-binary-core]] →
  automation needed uses [[re-angr]]/[[re-z3]] → obfuscation uses [[re-deobfuscate]].
  Sub-skills: [[re-angr]] [[re-z3]] [[re-pwn]], [[re-stego]].
  Triggers: CTF, `赛题`, `逆向题`, pwn, babyre, `自动解题`, `符号执行`, angr, z3, solver, `找flag`.
capabilities: [constraint-solving, stego-detection, shellcode-analysis]
---

# CTF practice (challenge-type identification / automated solving / constraint solving)

## Full workflow

Run in order; record an evidence path + sha256 for each step's artifacts (challenge-type conclusion / key function address / constraint model / flag) (see [[re-triage]] (capability: `triage`)) so the writeup can cite them.

1. **Identify the challenge type** — do not rush onto a tool; read the prompt + survey to fix the type (see pitfall 1):
   - A reversing challenge (rev / babyre): you are given a binary and must recover an algorithm / find an input / find the flag — follow steps 2-4
   - A crypto / algorithm challenge: you are given an encryption function / ciphertext and must recover the plaintext or invert the algorithm — involves [[re-crypto-id]] (capability: `crypto-identification`) / [[re-crypto-decrypt]] (capability: `crypto-decryption`); constraint solving uses [[re-z3]] (capability: `constraint-solving`)
   - A serial / registration challenge: recover the check function → a keygen (see [[re-license]] (capability: `license-analysis`) / [[re-keygen]] (capability: `license-analysis`); force a comparison chain with [[re-z3]] (capability: `constraint-solving`))
   - A pwn / stack-overflow challenge: introductory exploitation goes to [[re-pwn]] ([[re-gdb]] (capability: `debugging`) / [[re-radare2]] (capability: `decompilation`) dynamic debugging, running in [[re-sandbox]] (capability: `sandbox-setup`))
   - Survey commands: `file` / `checksec` / entropy / strings ([[re-triage]] (capability: `triage`)), identifying the architecture, whether it is packed, and whether it is statically linked
2. **A simple challenge goes straight to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`)** — when the challenge does not need automation, use generic analysis (survey → format parsing → decompile → debug): [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`) decompile the main logic, and recover the flag / registration algorithm by hand. **Estimate complexity first**: a challenge of a few comparisons / a simple XOR is 15 minutes by hand, and angr is slower (see pitfall 2)
3. **Automation needed → [[re-angr]] (capability: `symbolic-execution`) / [[re-z3]] (capability: `constraint-solving`)**:
   - The input is checked byte by byte inside a long loop / a deep comparison chain (reversing it bit by bit by hand is slow and easy to get wrong) → **[[re-angr]] (capability: `symbolic-execution`)** symbolic execution (symbolize the input → find the target address → solve)
   - The check is "a set of mathematical equations / a comparison chain" (satisfying the constraints is the flag) → **[[re-z3]] (capability: `constraint-solving`)** model and solve (lighter, faster, and more stable than angr)
   - Dispatch details are in the "selection tree"
4. **Obfuscation → [[re-deobfuscate]] (capability: `deobfuscation`)** — the decompile has junk instructions / control-flow flattening / string encryption: **recover first, then automate**. Running angr directly on an obfuscated function path-explodes / does not solve (see pitfall 3); after [[re-deobfuscate]] (capability: `deobfuscation`) recovers it, return to step 2/3
5. **Verify and produce**:
   - Running the original program with the solved input (inside the sandbox, [[re-analyze/platform-tips]] supreme rule) must print `flag{...}` (see pitfall 4: flag format / consistency with the solved result)
   - Record: challenge type, key function address, constraint model, solve script, flag, reproduction command — the writeup and [[re-ioc]] (capability: `threat-intel`) features (such as automated-solving features)

## Which atomic skill to use (selection tree)

Branch by challenge-type features / goal:

- **You just received the challenge and have not fixed the type** → step 1: a [[re-triage]] (capability: `triage`) survey + a glance at the main logic in the decompiler, and judge by hand first (most simple challenges are doable by hand; do not rush to automate)
- **A simple XOR / shift / table-lookup transform (≤ one screen of pseudocode)** → recover it by hand with [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) ([[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`)), or model a small constraint set directly with [[re-z3]] (capability: `constraint-solving`)
- **A byte-by-byte / character-by-character long-loop check (every byte must satisfy a condition, and reversing it by hand is tedious)** → [[re-angr]] (capability: `symbolic-execution`; symbolize the input + find the address where the check passes)
- **"Satisfying a set of equations / a comparison chain is the flag / key" (no loop, or the loop was already unrolled by hand)** → [[re-z3]] (capability: `constraint-solving`; BitVec modeling + solver)
- **The input location is complex (argv / file / standard input / network)** → [[re-angr]] (capability: `symbolic-execution`; symbolize any input point; [[re-z3]] (capability: `constraint-solving`) needs you to locate the variable source by hand first)
- **Junk instructions / flattening / string encryption are visible** → recover with [[re-deobfuscate]] (capability: `deobfuscation`) first, then follow the challenge type to angr / z3 / by hand (pitfall 3)
- **A packed challenge** (uncommon in CTF, common as an "unpack challenge") → [[re-anti-analysis]] first (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`; packer-id → unpack-*), then return to this gateway after unpack
- **A crypto / cryptography challenge** (AES / RSA / custom encryption + ciphertext) → [[re-crypto-id]] (capability: `crypto-identification`) identifies it → [[re-crypto-decrypt]] (capability: `crypto-decryption`) recovers it; a custom mathematical relation is solved with [[re-z3]] (capability: `constraint-solving`)
- **A pwn challenge** → [[re-pwn]] (capability: `exploit-development`; introductory exploitation: stack overflow / format string / ret2libc) → [[re-gdb]] (capability: `debugging`) / [[re-radare2]] (capability: `decompilation`) + [[re-sandbox]] (capability: `sandbox-setup`) dynamic debugging (this gateway is mainly reversing challenges; pwn is handed to the debug domain as an adjacent type)
- **The flag was solved but the format is wrong** → check case / newline / encoding (pitfall 4)

## Cross-domain joins

- **Entry dispatch**: this gateway is called by the [[re-analyze]] triage path "CTF challenge" (re-ctf → identify the type → re-angr / re-z3 / deobfuscate with re-deobfuscate → the base re-binary-core)
- **A CTF challenge = an application of core skills (spec 2.4 joint scenario)**: a CTF challenge is essentially a combination of core skills → a simple challenge / the decompiler workbench goes straight to [[re-binary-core]] ([[re-triage]] / [[re-ghidra]] / [[re-ida]] / [[re-radare2]]); the [[re-binary-core]] gateway also states "a CTF reversing challenge → this gateway is the base"
- **Automated solving**: [[re-angr]] (symbolic execution), [[re-z3]] (constraint solving) — the two atomic skills of this gateway, dispatched by workflow step 3; step 1 of the [[re-deobfuscate]] workflow also produces a clean binary that angr can consume
- **Obfuscation countermeasures**: an obfuscated challenge is recovered by [[re-deobfuscate]] first (its "cross-domain joins" state that a CTF deobfuscation challenge always cites this gateway)
- **Crypto-class challenges**: [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]] (algorithm identification, key location, decrypt recovery); key derivation is modeled with [[re-z3]]
- **Serial-class challenges**: [[re-license]] / [[re-keygen]] (check location and a keygen); forcing a comparison chain uses [[re-z3]]
- **pwn / dynamic**: [[re-gdb]] (debug / a breakpoint to see the check branch), [[re-radare2]] (a fast CLI attack), [[re-sandbox]] (the sandbox for running and verifying the flag, [[re-analyze/platform-tips]] supreme rule)
- **Output**: automated-solving script features / challenge-type fingerprints can enter the [[re-ioc]] list

## Common pitfalls

- **Running angr without reading the challenge**: symptom — a simple XOR challenge / a plaintext-compare challenge was put on symbolic execution, and the solve takes forever or has no solution; cause — the challenge type was misjudged, and the automation tool instead introduced path explosion / modeling error; fix — step 1 surveys + estimates complexity from the decompile first: a challenge you can recover by hand within one screen goes straight to [[re-binary-core]], and automation is reserved for a long loop / a deep comparison chain
- **Blindly reversing a long loop by hand**: symptom — a byte-by-byte check of hundreds of iterations, the hand reversal goes wrong halfway, and time runs away; cause — the scale of mechanical computation was underestimated; fix — dispatch per step 3: a byte-by-byte long loop uses [[re-angr]], and a set of equations uses [[re-z3]]; write the solve script and verify as you go (test a small input first)
- **Automating before obfuscation is recovered**: symptom — angr runs a flattened / junk-instruction function directly, path explosion never finishes, or the solved "input" fails on the original program; cause — obfuscation distorts the constraint model and inflates the state space; fix — recover with [[re-deobfuscate]] first (D-810 / by hand), then symbolic execution or manual analysis; on angr, confirm the symbolized function decompiles clearly before running (see [[re-angr]] pitfall 1)
- **Flag format / boundary mismatch**: symptom — the solved input looks correct, but the program prints non-flag content or errors; cause — the flag has a prefix/suffix format (`flag{...}`), case / newline / encoding (ASCII vs wide characters) do not match, or the input length is fixed and must be aligned; fix — break at the print with [[re-gdb]] and look at the actual output; the solve script replays the input channel the program expects (stdin / argv / file) and the format as-is, and runs the original program inside the sandbox to verify
- **A packed / statically linked challenge was missed**: symptom — strings are all garbage, xrefs are all packer code, and the decompile has no thread to pull; cause — the challenge is packed (an unpack challenge) or statically linked (no import-table clues); fix — the [[re-triage]] survey checks for a packer first (entropy / section names / EP); a packed one goes to [[re-anti-analysis]]; a statically linked challenge locates the logic start from main / entry features / strings (the library-fingerprint approach of [[re-imports]])
- **A PyInstaller challenge: an entry script with no behavior ≠ unpack failure**: symptom — after unpack, `main.pyc` is only `sys.exit(0)`, and it does not match the challenge prompt at all; cause — the real logic is not in the entry script: it may hide in a runtime hook, a **frozen module** (the `_frozen` array, such as a modified `os` module), a modified Python runtime library (a recompiled python313.dll), bootloader logic in front, or a code object generated at runtime; fix — **competing hypotheses + the smallest experiment**: hypothesis 1 = a modified frozen module, hypothesis 2 = bootloader logic in front; first run the experiment with the lowest cost and the highest discrimination (download the official DLL of the same version and compare); **frozen-module hash diff**: parse the PE export table and read the `_frozen` array (code/size), marshal.loads, then SHA-256-compare one by one with the official 29 frozen modules, compressing a 7MB runtime library down to a single 47KB marshal object; note that the marshal format and bytecode are **strongly version-dependent** (you must use the Python version the challenge corresponds to, such as the 3.13.1 magic)
- **Periodic XOR + known plaintext recovers the key**: symptom — ciphertext of a 6-character key periodic XOR, and a brute-force search of non-printable candidates; cause — a key slot cannot be solved when the plaintext does not cover it enough times; fix — use naturally known plaintext (such as a plaintext success message inside the program), `ciphertext ^ plaintext` yields the keystream, and **count the coverage of each slot** (a slot is trustworthy only when it agrees ≥2 times); after recovery, decrypt the success message as a cross-check
