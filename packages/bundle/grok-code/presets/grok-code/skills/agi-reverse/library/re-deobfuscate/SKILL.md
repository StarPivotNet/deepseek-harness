---
name: re-deobfuscate
description: "Deobfuscation: junk instructions, control-flow flattening, and string encryption. Triggers: `反混淆`, `花指令`, `控制流平坦化`, `字符串解密`, obfuscation"
capabilities: [deobfuscation]
---

# Deobfuscation (junk instructions / control-flow flattening / string encryption)

## When to use / when not to use

- Use: decompiler output shows junk instructions (fragmented disassembly, identity jumps), control-flow flattening (if/while all become switch dispatch), or string encryption (static view shows only ciphertext arrays); you need to recover the algorithm / license logic
- Use: CTF deobfuscation challenges; samples that still have code obfuscation after unpacking ([[re-anti-analysis]] workflow step 5)
- Do not use: clean code (analyze directly with [[re-binary-core]])
- Do not use: you only need to bypass protection and do not care about the algorithm (dynamic patch / hook is cheaper; see [[re-gdb]] / [[re-frida]])
- Do not use: packer-layer obfuscation (that is the packer's decompression logic — unpack first with [[re-unpack-simple]] / [[re-unpack-advanced]])
- Note: deobfuscation is iterative — recover one layer, verify it, and back up the original file first

## Tool setup

### Decompiler output (the recovery workbench)

- [[re-ghidra]]: `apt install ghidra` / `brew install --cask ghidra` (an official release zip is also fine); verify with `analyzeHeadless -help`; or the decompiler view in [[re-ida]] / [[re-radare2]]. Produce decompiled code first, then work the obfuscation points

### idapython (batch scripting)

- Built into IDA (8.x/9.x ship Python 3); the headless executable name and usage are in [[re-ida]]
- Verify: inside IDA, `File > Script Command` can run Python

### rizin scripts (batch patch / query)

- Install matrix is in [[re-radare2]]; after install, verify with `rizin -v`
- Python driver uses the Rizin binding `rzpipe` (`pip install rzpipe`, rizinorg/rz-pipe)

### D-810 (IDA plugin, optional)

- Upstream GitLab `eshard/d810` (GitHub mirror `zhkl0228/d810`; the upstream README already notes the fork) release; copy into the IDA `plugins/` directory (requires IDA 7.5+ / Python 3.7+; source: official README)
- Function: automatic control-flow flattening recovery (Deobfuscate menu)
- Verify: the D-810 item appears in the IDA menu

### python3 (emulation / batch decryption)

- `apt install python3` (present on most systems); `pip install pefile rzpipe` as needed
- Verify: `python3 --version`

## Procedure

Run in order. Record each step (evidence path + sha256; see [[re-triage]]). **Back up the original file before modifying it** (see pitfall 1).

1. **Clear junk instructions (patch NOP / repair jumps)**:
   - Signatures: identity jumps (`jz`/`jnz` whose target is the next instruction), `call`+`pop` address tricks, inserted garbage (`xor eax,eax` followed by nothing meaningful), and fragments where the disassembler fell into junk bytes.
   - Clear: patch garbage instructions to NOP and repair scrambled jump targets —
     - rizin: `wx 90 @ 0x401000` (single-byte NOP); for batches, scan by signature and fill from a script
     - Ghidra: select the region and right-click Patch Instruction; IDA: `Edit > Patch Program > Assemble`
   - Repair function boundaries: in Ghidra, select the range and press `C` to force-mark code / right-click Create Function; manually define segments the disassembler missed.
   - After each patch, disassemble again and confirm there are no "undefined" instructions (see pitfall 1).

2. **Identify and recover control-flow flattening (D-810 / manual)**:
   - Signatures: many basic blocks converge on a single dispatcher (`switch` dispatch loop), a state variable (the dispatcher index) is rewritten at the tail of every block, and original if/while branch blocks are split into small blocks.
   - Automatic: IDA + D-810 → `Deobfuscate` menu → `Flattened code`; select the flattened function and recover it in one shot (fall back to manual on failure).
   - Manual: locate the dispatcher's switch variable → trace its write sites (each block tail) → reconnect each case target to the original control flow by state-variable value; export the dispatcher's target table with an idapython / rizin script to help the wiring.
   - **Picking the wrong state variable is the biggest risk** (see pitfall 2) — try D-810 first; when doing it manually, confirm the variable really participates in the dispatcher index.

3. **Locate and emulate the string-decryption loop**:
   - Static location: find ciphertext arrays in the data section (high entropy / no plaintext) → xref the function that references them (or the pointer before `memcpy`/`strcpy`) → analyze the decrypt loop (single-byte XOR / multi-byte key, table lookup, per-byte transform).
   - Dynamic read (needs a sandbox, [[re-analyze/platform-tips]] highest principle): break at the decrypt-function return in [[re-gdb]] / [[re-x64dbg]] and `x/s` the result.
   - Emulation: reproduce a small loop in python3 (using the reversed algorithm and key):
      ```python
      # 例：单字节 XOR 解密
      key, out = 0x7f, bytearray()
      for b in open('data.bin','rb').read():
          out.append(b ^ key)
      print(out[:64])
      ```
   - Compare the dynamic result with the emulation result; once they match, move on to the batch step.

4. **Batch scripting (decrypt every string)**:
   - idapython: walk xrefs to the decrypt function, and after the call write the result into a comment / output file:
      ```python
      import idaapi, idc
      # 例：枚举引用 sym_decrypt 的调用点，取参数地址后 idc.get_bytes 解密并打印
      ```
   - rizin / rzpipe: `rizin -A sample -c 'axt @ sym.decrypt'` lists references; a script loops the decryption and exports `strings_decrypted.txt` for [[re-ioc]] / manual analysis.
   - Output: a full decrypted-string table (address → plaintext), archived into the analysis record.

5. **Before/after verification**:
   - Record pre/post hashes with `sha256sum`; compare junk-instruction region bytes with `objdump -d`.
   - Disassemble again and confirm no "undefined" / no undefined jump targets (check after every step; do not batch this to the end).
   - Decompile the target function again and confirm control flow and call relationships look sane; run in a sandbox and confirm behavior matches ([[re-sandbox]]; see [[re-analyze/platform-tips]] highest principle).
   - Cross-check string decryption with a runtime check (dynamic decrypt value == script emulation value).

## Cross-domain joins

- [[re-anti-analysis]]: workflow step 5 (deobfuscation) always calls this skill (obfuscation remains after unpacking)
- [[re-analyze]] triage path "CTF challenge": re-ctf → re-deobfuscate (deobfuscation recovery)
- [[re-ctf]]: CTF deobfuscation challenges (junk instructions / flattening / string decryption)
- [[re-binary-core]]: deep static logic analysis (continue into [[re-ghidra]] / [[re-ida]] on the recovered clean artifact)
- Companions: [[re-gdb]] / [[re-x64dbg]] (dynamically read decrypt results), [[re-sandbox]] (dynamic verification sandbox), [[re-ioc]] (decrypted strings as a feature source), [[re-memdump]] (needed when ciphertext exists only in memory at runtime)

## Common pitfalls

- **Deleting the wrong instruction → control flow corrupted (back up first)**: Symptom — after the patch the function will not decompile / jumps land in junk bytes / the run crashes; cause — junk instructions are interleaved with real instructions, and a valid instruction was deleted by mistake; fix — **back up the original file before patching** (archive the sha256), patch in small steps and disassemble again after each step to confirm there are no undefined instructions; if it is damaged, start over from the backup
- **Wrong flattening state variable → scrambled recovery**: Symptom — after recovery, if/else branches are all out of order and the logic is absurd; cause — an ordinary data variable was treated as the dispatcher state variable; fix — first confirm the variable really is the switch index (value domain = branch count, rewritten at every block tail); prefer D-810 automatic recovery; when doing it manually, trace the variable lifetime to verify
- **Encrypted strings only appear at runtime (dynamic decrypt)**: Symptom — static analysis finds no plaintext, and may not even find a decrypt function; cause — strings are decrypted only at runtime (the decrypt loop may itself sit in obfuscated code); fix — break on the decrypt function in a debugger and read it dynamically (inside a sandbox), or recover the decrypt loop first and then emulate it; cold data (constants decrypted only at runtime) is taken from memory with [[re-memdump]]
- **Obfuscation is more than one layer**: Symptom — after flattening is recovered the strings are still ciphertext, or junk instructions contain more junk instructions; cause — stacked obfuscation layers are a common configuration; fix — recover layer by layer and run step 5 after each layer; do not try to finish in one shot
- **Opaque predicates (always-true / always-false branches)**: Symptom — after recovery there are many branches that "look conditional but are actually constant"; logic looks wrong after the patch, and symbolic execution ([[re-angr]]) stalls there / path-explodes; cause — an obfuscator (VMProtect family / Tigress and similar) inserted always-true / always-false conditions (such as `x*x-x>=0`, parity identities) to inflate paths and interfere with analysis; fix — once identified, fix the branch target directly (always-true takes the true edge, always-false takes the false edge) and simplify in batch; remove opaque predicates before flattening recovery and symbolic execution
- **Anti-CFF seven-step framework and tool choice (IDA microcode)**: Symptom — manual CFF recovery is trial-and-error; cause — there is no systematic procedure; fix — follow seven steps: a. find the dispatcher (a `BLT_2WAY` block with the most predecessors) b. find the real blocks c. find the state variable (the dispatcher tail is a jcond compared with a constant) d. which block assigns the state variable e. what the state variable equals at each block entry f. build the Block→Block map g. rewrite control flow; tool comparison: IDA built-in value-range analysis (has gaps; non-standard CFF cannot finish step e) < D810 (MicroCodeInterpreter simulates dispatcher logic; stronger; the framework is worth borrowing) < angr symbolic execution (no need to find the state variable explicitly; one-shot but heavy); IDA microcode API: `ida_hexrays` `mblock.npred()/pred()/tail/type`, and `mop_r/mop_S/mop_d` to recursively fetch variables
- **Telling VM obfuscation apart from flattening**: Symptom — treating virtual-machine obfuscation as flattening (looking for a state variable / constant handoff) never lines up; cause — the two mechanisms differ: flattening has a constant at the end of each basic block that links to another block, while VM obfuscation fetches bytecode and dispatches through a jump table (operands are encoded into the instruction); fix — identification points: the function prologue allocates an **abnormally large stack** (the VM context/memory; an uninitialized pointer is passed straight into the VM function), the data section has a bytecode region and a jump table, and the entry first fetches 4 bytes and splits bitfields (opcode / register index); once identified as a VM, follow the VM recovery flow
- **VM recovery method (bytecode + jump table + multi-level opcode)**: Symptom — the VM function's decompilation is unreadable (many parallel basic blocks + dispatch); cause — handlers are dispatched by bytecode index through a jump table; fix — (1) locate the bytecode region (data section; divide length by instruction width to get the instruction count, for example 0x2F4/4 = 189 instructions) (2) count opcode frequency (analyze high-frequency opcodes first) (3) jump table = base + opcode×4; analyze each handler (4) watch for **multi-level opcodes** (when op1=47, op2 selects a second-level jump table; count opcode bitfield width carefully, for example 6-bit op + 5-bit register = a 4-byte instruction) (5) map real register roles (virtual PC pointer, control variable, virtual-register array base) (6) control-variable mechanism (jump/call/exit is implemented by setting a control variable; both the shared block at the handler tail and the fetch head check it)
- **No need to fully recover a VM that only calls external functions**: Symptom — grinding through every VM handler to recover an encryption algorithm; cause — the VM may only call external crypto functions (AES/RNG and similar), and byte-level processing lives outside the VM; fix — first confirm whether VM handlers only "fetch arguments / call an external function / store the result" — if so, recovering argument passing and the call sequence is enough to debug out the algorithm; you do not need a byte-by-byte VM recovery; note that a signature algorithm in the same family (tt family) may put the crypto inside the VM, and then a full recovery is still required
- **CFF false positive → DSVM (domain-specific virtual machine) identification**: Symptom — an OLLVM detector reports many CFF functions (for example 49), but flattening recovery never lines up; cause — it is actually a custom VM that borrows the VMP architecture (jump-table dispatch + bytecode interpretation) but whose instruction set is fully domain-specific (DSVM, such as a UE4 traversal engine or a hardened so); fix — chase the anomalous signals: many syscalls inside the function (OLLVM only rewrites control flow and does not introduce syscalls), multiple dispatchers in one function (standard OLLVM has one dispatcher per function); VMP vs DSVM on four axes: processor semantics (general vs domain-specific 98%), loop structure (single-level flat vs recursive-descent parse), bytecode format (compact binary vs text-style magic + single-byte op), virtual stack (present vs absent); a DSVM is semantic-level obfuscation — understanding "what it is doing" (object traversal / protocol parse) matters more than "how it does it" (opcode dispatch)
- **PAC prologue misses function boundaries**: Symptom — function count / boundary analysis comes up short, and one giant function actually hides several functions; cause — ARM64 PAC (Pointer Authentication Code) protected functions use a non-traditional prologue, so detecting only `stp x29,x30` misses them; fix — extend detection to three prologue patterns; the function count can jump (238→291); PAC/BTI landing pads are actually precise markers of function boundaries and indirect-jump targets — use them, do not work around them
- **Jump-table entry validation (avoid string-region false positives)**: Symptom — jump-table parsing yields a pile of "targets" that point at data/string regions; cause — rodata holds both the jump table (16-bit offset array) and the C++ demangler name table, so an entry may point into the string region; fix — verify that each entry's target address is inside `.text`, and drop entries that point at the string region; **static jump-table extraction + Unicorn dynamic verification of the dispatch flow** (synthesize a bytecode input such as `"gs1a"` and trace the execution path) is a required static/dynamic pair for VM recovery
- **Removing indirect jumps/calls (BR/BLR X8)**: Symptom — pseudocode shows `__asm { BR X8 }` or `v278 = v277(...)` (no jump symbol), and the IDA control-flow graph is broken (the branch was not recognized into the function body); cause — OLLVM indirect obfuscation: the target address is computed by complex logic, stored in a register, then jumped to, so static analysis cannot determine the target; fix — **execute dynamically and read the register** (stop at the BR/BLR and read X8); computing the target by hand is too slow; once you have the target, keypatch it uniformly into a direct jump (`BR X9` → `B 0x153AF0`); **splitting a CSEL conditional**: `X8 = (X0>0) ? X8 : X9` is a ternary — compute both targets segment by segment and patch into a conditional jump; a multi-condition chain (EQ series) is split the same way, one at a time
- **Real instructions between CSEL and BR**: Symptom — after patching out the CSEL, control flow is scrambled / real instructions are missing; cause — there may be real instructions between the CSEL and the BR; if you patch between the CSEL and the next instruction, nothing after the B executes; fix — the patch site must be **between the CSEL instruction and the BR instruction** (keep the real instructions in between), not the instruction after the CSEL
- **New adversarial surface in the AI era: adversarial text that induces an AI to refuse analysis**: Symptom — code handed to an AI (ClaudeCode and similar) is stripped clean in seconds, and traditional obfuscation loses force; cause — LLM reversing ability is too strong; fix (defensive / research view): build an adversarial text suffix (GCG-class algorithms: an LLM is a discrete-vocabulary classifier, so a continuous gradient cannot be applied directly — treat the gradient as a heuristic signal, compute each position's token-replacement contribution to the loss, take a Top-K (for example 256) candidate set, and greedily pick with a forward check; in the black-box case use an approximate model / GA evolution / a distilled proxy) and combine it with obfuscated code to induce the AI to output a refusal to analyze; identify signals that an AI is analyzing and counter them (for example, once a reasoning chain is recognized, inject obfuscation to steer it); mind the compliance boundary (legitimate protection of intellectual-property code; must not be used to hide malicious code)
- **Custom DSL VM (pure JS virtual machine)**: Symptom — a large JS file is treated as WASM / ordinary obfuscation; cause — a custom interpreter loop + custom opcodes; fix — DSL VM in five steps: extract cases → classify opcodes → analyze the constant table → trace functions → extract exports; confirm it is a pure JS interpreter before choosing the toolchain
- **VM export functions are hidden**: Symptom — export function names cannot be found in the VM file; cause — export names are hidden by instruction encoding; fix — extract the real exports from the module registry (they are not exposed on the surface of the VM file)
- **Flow ready ≠ session established**: Symptom — the interface returns success but the flow never starts; cause — success is only a session acknowledgement; fix — judge real flow readiness by a specific status code / stage flag; do not treat a session acknowledgement as startup
- (Source: reverse-skill field-journal, MIT)
- **Z3 solving state-machine transitions hits a call boundary**: Symptom — while symbolically recovering flattening, continuing the solve across a call yields a wrong transition; when the solver times out / returns unknown, the edge is still rewritten and control flow is scrambled; cause — a call invalidates register and memory bindings and is a hard barrier by default; "unreachable path" and "unsolved" were conflated; fix — do bounded symbolic execution per case block and solve the state-variable value at the block end; a call is a barrier by default, and only private state explicitly proved not to escape may be kept across the call; on failure, distinguish "proved unreachable" (may discard) from "timeout/unknown" (fail-closed, do not touch the edge); set a solver timeout cap, and reuse translation results and the solution cache
- **Automated rewrite lacks a coverage threshold**: Symptom — after automatic flattening recovery, large parts of the function body are unreachable and decompilation is scrambled; cause — the CFG was rewritten when too few transition edges had been solved, and the rewrite left no rollback trail; fix — a whole-graph safety check before applying (source/target blocks legal, no self-loop, terminator shape matches successor count); if any edge fails, abandon the whole rewrite; if the number of solved transition edges does not meet the case-block floor (for example one third and at least 3), refuse the rewrite; byte-level edits go through a reversible patch that keeps the original bytes (never modify the input file); a complex rewrite plan is applied inside a transaction boundary — snapshot first, apply step by step, and roll the whole thing back if any step is rejected
- **Treating UNSAT as always-true / always-false and patching directly**: Symptom — a solver UNSAT is taken as proof the predicate is always true / always false and the edge is rewritten, or an opposite branch observed in simulation is used to reverse the conclusion; cause — the three evidence grades of a universal claim were not separated: a SAT model only shows some path exists, UNSAT can only corroborate, and the only thing that can refute a universal claim is "an opposite-branch observation from a concrete execution" (a counterexample); fix — a counterexample must be qualified before it has veto power (covers all dependent code and read-only data, no truncated trace, no summary stand-in, no permission violation, did not escape the image); when static analysis cannot prove always-true, keep the indirect operation and only record candidate targets; "cannot decide" (depends on input / timeout / backend lacks the capability) means do not touch it — missing information is unknown, not negative evidence
- **Survey and transform mixed on one channel**: Symptom — transforming the whole database up front, rebuilding cached microcode per function, and treating a whole-database scan as an ordinary query; cost runs away; cause — the survey channel and the transform channel were not separated, and calls were not graded by cost / side effect before invocation; fix — survey uses a read-only detection channel only (no cached microcode build, no transform component installed) to scan the whole database for candidates, and transform only the candidates; cost grades — pure query is zero cost and zero side effect, detection is one uncached build per function and does not land in the cache, only the transform class changes bytes and the AST (reversible patch), and a whole-database scan is both expensive and writes the database; explicit admission — only a requested function enters the transform pipeline, and admission and transform are two steps; exploratory operations are synchronous, bounded, and single-function: no polling, no background thread, no repeated whole-database scan
- **Detection flags reported as results**: Symptom — the report says "detected N obfuscation sites" while not one byte changed; repeating a transform on the same function has no effect, or pseudocode that does not change after a transform is treated as failure; cause — a detection flag is only a structural candidate; without a matching guarded rewrite it produces no change; cache and tracking were not managed, so a repeated transform was stopped by idempotence without anyone knowing; fix — report the actual processed count and the modifications actually applied; do not treat detection flags as results; iterate: detect → (optional) explore for evidence → transform → decompile again with no cache → detect again / compare pseudocode to confirm convergence; to rerun, clear function-level tracking and evidence first; handle failure by return value (numeric returns 0/-1, string returns empty), not by catching exceptions; before transforming, confirm auto-analysis has finished and the decompiler is available
- **Simulation evidence used out of bounds as universal evidence**: Symptom — an opposite branch observed by the simulation engine is used as a counterexample, an external call answered by a summary still supports a universal conclusion, or a function has already changed and an old observation is still cited; cause — simulation evidence has bounds (single function, bounded, limited run count); a summary stand-in means the host model partially compensates; the evidence carries a lineage that was not checked before use; fix — simulate only a single function, bounded (an image snapshot is memory context only); external calls use a summary stand-in but are marked exploratory and are not used for a universal proof; an unmodeled target is reported as an "environment boundary", not a decode fault; each observation carries a lineage (database, function-byte hash, image hash, function generation, seed); before use, compare the function blocks and the trace interval byte-for-byte with the current database, and discard stale evidence; dynamic observations have a minimum-run consumption floor (for example 2 different runs); a missing backend capability is reported as unknown, not as negative evidence
