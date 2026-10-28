---
name: re-whitebox
description: >
  White-box cryptography analysis: identify a white-box implementation, extract the key.
  Triggers: `白盒`, whitebox, `白盒加密`, `密钥隐藏`
capabilities: [crypto-identification, key-extraction]
---

# White-box cryptography analysis

## When to use / when not to use

- Use: a crypto implementation where "the key is not visible" — no standard-library API, and the key is not explicitly in the file/memory/resources (the key is hidden inside the implementation itself)
- Use: decompilation shows a large read-only lookup table (starting at a few hundred KB) plus a function body that is almost entirely table lookups, with no standard algorithm structure (no Crypt* calls, no standard S-box constants, no OpenSSL symbols)
- Use: DRM/license/in-app crypto, or a firmware authorization check, where a white-box implementation is suspected (Chow-class white-box AES, white-box SM4, and similar)
- Do not use: an ordinary crypto implementation (the regular chain [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]])
- Do not use: both the algorithm and the key are already known (decrypt directly)
- Prerequisite check: unpack and deobfuscate a packed/obfuscated sample first ([[re-anti-analysis]]). White-box tables and code cannot be analyzed while a packer layer pollutes them

## Tool setup

Mostly static (no sandbox). When "the table is encrypted and decrypted at runtime", the table must be taken dynamically (default sandbox, top rule in [[re-analyze/platform-tips]]). Verify every tool before use.

### python3 — table extraction and key-derivation scripts

- Install and verify are in [[re-proto-rev]] Tool setup (python3). numpy is recommended for large tables (`pip install numpy`)

### Decompiler — locate table-lookup code and table addresses

- [[re-ghidra]] (default: import → auto-analysis → decompile). [[re-ida]] / [[re-radare2]] follow the `RE_DECOMPILER` session variable
- Verify is in the matching skill's Tool setup. Table address/size follow the decompiler's Data view

### [[re-angr]] — optional (symbolic execution helps solve index relations)

- All platforms: `pip install angr`
- Verify: `python3 -c "import angr; print(angr.__version__)"`
- Use: when the table-lookup code is obfuscated / the index relation is complex, symbolic execution solves the "input byte → table entry" correspondence directly

### [[re-memdump]] — take the table dynamically when the table is encrypted (decrypted at runtime)

- Default dump first (gcore; see the "direct read vs dump" decision table in [[re-analyze/platform-tips]])
- Verify is in [[re-memdump]] Tool setup

## Steps

Run in order. Archive each step's products (table file / script / recovered key) with sha256 + path, for the report ([[re-ioc]]).

1. **Identify a white-box implementation (lookup-table features, a long stretch of table-lookup code with no standard-library calls)**:
   ```sh
   # Static side: look for table-lookup candidates in .rodata/.data — 256 entries of 4/8 bytes, contiguous, values spread evenly
   objdump -h sample.bin | grep -E 'rodata|data'
   # Decompile to confirm: whether the function body is "state xor constant → table lookup → combine", and whether Crypt* / OpenSSL symbols exist
   ```
   - Feature list: (1) a large read-only table (white-box AES has 4 tables of 256×4 bytes per round; a Chow-class encoded table set can reach 700KB-1MB+) (2) the function body is mostly table lookups, with no standard round-function shape (3) no standard constants (the AES S-box/Rcon fingerprints in [[re-crypto-id]] do not hit) (4) no cryptography API imports ([[re-imports]] is clean)
   - Decompile to confirm: xref the table address (Ghidra `Ctrl+Shift+F`) and look at the shape of the referencing function — "table lookup + combine" rather than "round function + constant table" is a white-box candidate
   - Split with [[re-crypto-id]]: a normal fingerprint hit → the standard-algorithm chain. No fingerprint hits but there is a large table → the white-box hypothesis (see pitfall 4)

2. **Extract the tables**:
   - Ghidra: select the table data and right-click Export (or a script `getBytes` dumps the whole range). IDA: export with `ida_bytes.get_bytes(start, size)`
   - Parse script (by entry width / endianness):
     ```python
     import struct
     data = open('tables.bin','rb').read()
     for off in range(0, len(data), 4):        # 4-byte entries (AES T table): each entry [S(x)<<24 | ...]
         v = struct.unpack_from('<I', data, off)[0]
         # record the value distribution / per-byte bit pattern; output for step 3
     ```
   - Record: each table's address, size, entry width, and which functions reference it — the table ↔ function ↔ round-count correspondence is the map for key recovery

3. **Key recovery (table reversal → key derivation, or a known-plaintext attack)**:
   - **Approach A, table reversal**: the key is embedded in the white-box tables — the first-round table `T0[x]` encodes `S(x) ^ k0` (x is an input byte), and the last-round table encodes the last-round key. When the encoding layer (affine / byte map) is simple, solve `k0` directly
   - **Approach B, known plaintext**: look up a fixed input byte and get the output, build "input → output" pairs, and solve when the encoding layer can be modeled (an affine encoding solves a linear system; a byte map looks for collisions)
   - **Approach C, take the table dynamically**: the table itself is encrypted (see pitfall 3) → after a runtime [[re-memdump]] dump, search memory for table features, take the decrypted table, then use approach A/B
   - **Approach D, DCA (differential computation analysis)**: a complex encoding layer (full Chow encoding) is not realistic to invert by hand → use daredevil from SideChannelMarvels to run DCA (differential computation analysis) on the white-box execution trace and recover the key
   - Check the key hypothesis: compare a recovered candidate key with a standard implementation's output first (step 4). Do not trust it directly

4. **Compare with a standard implementation (same algorithm, different implementation)**:
   ```python
   from Crypto.Cipher import AES           # pip install pycryptodome
   key = bytes.fromhex('<candidate key>')
   c = AES.new(key, AES.MODE_ECB)
   print(c.encrypt(b'hello whitebox!!').hex())
   # compare output with the sample's white-box implementation on the same plaintext/ciphertext
   ```
   - Confirm by comparison: (1) algorithm and parameters (AES-128/192/256, 16-byte block, ECB/CBC mode, round count) (2) candidate-key correctness (3) how the white-box tables correspond to the standard T tables / round function
   - Variant check: SM4 (32 rounds, 8-bit block bytes) / DES white-box / custom — decide the family from block size and round count first, then apply the matching structure (see pitfall 4)

5. **Report (key / algorithm / impact)**:
   - Contents: the key (16/24/32-byte hex), algorithm and variant, extraction method (table reversal / known plaintext / DCA / dynamic), impact assessment (a leaked key → all data/traffic can be decrypted, DRM can be forged), evidence (table address, sha256, comparison output)
   - After the key is extracted, hand off to [[re-crypto-decrypt]] to decrypt the target data/traffic. The key and the table hash go into [[re-ioc]]

## Related skills

- [[re-protocol]]: this skill is the white-box branch of that gateway's crypto chain — hand off when the identify/key/decrypt trio meets "table-lookup crypto"
- [[re-crypto-id]]: prerequisite — "table-lookup crypto" whose constant-table fingerprints (S-box/Rcon/CRC) all miss → this skill. A white-box table can also be misidentified by a fingerprint tool (see pitfall 4)
- [[re-crypto-keys]]: the white-box branch when the ordinary key-extraction path (hard-coded / memory search) fails — the key is in the tables, not at an explicit location
- [[re-crypto-decrypt]]: downstream — decrypt data/traffic after the key is recovered
- [[re-binary-core]]: decompilation base ([[re-ghidra]] / [[re-ida]] / [[re-radare2]])
- [[re-angr]]: optional — symbolic execution helps solve table indexes / the encoding layer
- [[re-deobfuscate]]: when white-box and obfuscation are combined, restore control flow first (pitfall 2)
- [[re-memdump]]: take the table dynamically when the table is encrypted (decrypted at runtime) (pitfall 3)
- [[re-malware]]: white-box implementation analysis of malicious-sample communication crypto / ransomware
- Cite the static-first principle in [[re-analyze/platform-tips]] and the "direct read vs dump" decision table (when to take the table dynamically)

## Pitfalls

- **White-box tables are huge (memory/time)**: symptom — after dumping/parsing a table of several hundred MB the script hangs and memory blows up, and analysis drags on for days; cause — a Chow-class white-box table set is 700KB-1MB+, and encoding/obfuscation on top makes it larger; fix — process in chunks (read slices by table-address range), parse with numpy vectorization, and filter with xref first ("analyze only tables that are referenced"). Compress and archive the table file before analysis
- **Obfuscation + white-box combined**: symptom — the table is found, but the lookup code is wrapped in control-flow flattening / junk instructions, and the index relation cannot be read; cause — white-box and code obfuscation are stacked ([[re-anti-analysis]] domain techniques, to block automated analysis); fix — [[re-deobfuscate]] restores control flow first, then do the index analysis. Or skip static restoration and use [[re-angr]] symbolic execution to solve the "input byte → table entry" correspondence directly. If both paths fail, move to DCA (it does not depend on code semantics)
- **Table encryption (a second layer of protection)**: symptom — a statically dumped table has high entropy / is all ciphertext, but decompilation shows a prefix loop that decrypts the table; cause — the white-box table itself is encrypted and is decrypted only at runtime (to block static extraction); fix — [[re-memdump]] dynamic dump, with the dump timed after the decrypt loop runs ([[re-memdump]] pitfall: dumping too early does not get the table; save as soon as decrypted data is visible). After the plaintext table is in hand, go to step 3
- **Misjudging an algorithm variant**: symptom — tables extracted as a white-box AES structure do not fit at all, and the effort is wasted; cause — the implementation is white-box SM4/DES or a custom variant, with a different encoding / round structure; fix — step 4 decides the family first (block size, round count, output compared with a standard implementation), confirms the algorithm, then extracts tables by the matching structure. When a different encoding layer (affine / byte map) makes table reversal hard, use DCA instead of inverting by hand
- **A table fingerprint hits by mistake**: symptom — a search "finds" a suspected S-box/constant inside a table, misjudges a standard algorithm, and takes the wrong chain; cause — a table after white-box encoding may happen to contain fragments of standard constants (or be polluted by unreferenced code from a static library); fix — after a hit, xref must confirm it is referenced by the crypto path ([[re-crypto-id]] has the same pitfall), then compare round count and block size
- **Three schools of white-box implementation (decide the school before choosing the attack)**: symptom — you have a white-box target and do not know which attack to use; cause — white-box AES has three implementation classes, and the attacks differ: (1) **Chow lookup tables** (broken by the 2004 BGE algebraic attack, generalized by Michiels in 2008, and Lepoint in 2013 recovered the key at 2^22 complexity); (2) **Bringer perturbations** (extra perturbation equations plus linear encoding; the Xiao-Lai implementation was broken by Mulder in 2010); (3) **Biryukov ASASA** (alternating Affine-Sbox layers; algebraic / statistical / decomposition attacks); fix — identify the school first: Chow features = a lookup-table set (TBoxes = SubBytes+AddRoundKey merged, TyiTableBoxes = MixColumns precomputed, ioInvTable random mixing, shiftTab embeds ShiftRows into table generation). ASASA = alternating affine and nonlinear layers. Extracting a key from a Chow structure uses an algebraic attack (merge specific lookup tables to remove the nonlinearity). DFA (differential fault analysis) starting from MixColumns is the classic attack entry
