---
name: re-crypto-keys
description: >
  Key and passphrase extraction: hardcoded, memory search, resources.
  Triggers: `找密钥`, `硬编码`, key extraction, `口令`
capabilities: [key-extraction]
---

# Key and passphrase extraction

## When to use / when not to use

- Use: you need to decrypt data/traffic but do not know the key (static first: hardcoded → resources → import table; dynamic: a memory dump)
- Use: confirm whether the sample hardcoded a key/passphrase (configuration extraction)
- Use: the key is derived at runtime (PBKDF/HKDF) and you need to recover the derivation
- Do not use: the algorithm is not confirmed yet (do [[re-crypto-id]] first)
- Do not use: the key is delivered by external configuration / a server (there is no local key to extract — tell the user honestly; see pitfall 2)
- Do not use: static format analysis only ([[re-triage]] / [[re-format-pe]])

## Tool preparation

Verify every tool before use. A static search can skip the sandbox; a memory dump / dynamic step follows [[re-memdump]] dump-by-default + the [[re-analyze/platform-tips]] supreme rule (a running sample goes into the sandbox).

### strings — a fast scan of printable strings (all platforms)

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils` (usually present)
- macOS: the system `/usr/bin/strings`
- Windows/WSL: the Linux build inside WSL; on native Windows use Ghidra or `strings.exe` (Sysinternals)
- Verify: `strings --version` (the GNU build has --version)

### ghidra / rizin — decompile and cross-reference search (install: see [[re-ghidra]] / [[re-radare2]])

- Cross-references of constants/strings are the key to finding "who used this key"
- Verify: `ghidra` (GUI) or the `rz-ghidra` plugin is usable; `rizin -v`

### Dump artifact — the raw material for a memory search ([[re-memdump]] dump by default)

- Dump with `gcore -o out <pid>` per [[re-memdump]] step 1; time the dump by plaintext/code materialization (near the OEP is usually appropriate for a single-layer packer; the OEP is not a universal criterion; see [[re-analyze/platform-tips]] key experience)
- Verify: `file out` confirms an ELF core, and `eu-stack -e out` can run

### python3 — entropy-block / pattern scan scripts

- Install and verify: see [[re-proto-rev]] tool preparation (python3)

## Procedure

Run in order and record each step. Strategy order: **static first, then dynamic** (see pitfall 3). Record each step's artifact (key/passphrase + source evidence: offset, function name, dump path) for [[re-crypto-decrypt]].

1. **Static: strings / cross-references find hardcoded material**:
   ```sh
   strings -n 6 sample.bin | grep -iE 'key|secret|pass|token|crypt|iv' | head -50
   strings -el sample.bin | grep -iE 'key|secret|pass' | head -20     # UTF-16LE (common on Windows)
   strings -n 8 sample.bin | head -100                                # a full scan, reviewed by hand once
   ```
   - Look up a suspicious string (a fixed string that looks like a key) in the decompiler by cross-reference: [[re-ghidra]] / [[re-ida]] right-click Find References — see which function reads it and how it participates in the computation (it goes straight into a crypto parameter → it is a key; it participates in a table lookup/compare → it is a passphrase or a salt)
   - Search constants in the decompiler (`Search > Memory` / `:> /v 0x...`): a 32-byte hex string, a repeated random data section
   - Hex side: after the script in [[re-crypto-id]] step 1 finds a constant table such as the AES S-box, memory data near the table is often key material

2. **Memory: after the dump, search key patterns (16/32-byte entropy blocks, printable passphrase strings)**:
   ```sh
   gcore -o out <pid>                      # dump by default ([[re-memdump]]); time it by materialization
   ```
   ```python
   data = open('out','rb').read()
   import collections, math
   # 16/32-byte high-entropy blocks (AES-128/256 key candidates)
   def ent(blk):
       c = collections.Counter(blk); n = len(blk)
       return -sum((v/n)*math.log2(v/n) for v in c.values())
   for base in range(0, len(data)-32, 32):
       blk = data[base:base+32]
       if ent(blk) > 7.0 and 16 <= len(set(blk)) <= 24:
           print(f"0x{base:x}: 32B high-entropy block")
   # passphrase / printable string
   import re
   for m in re.finditer(rb'[ -~]{8,64}', data):
       s = m.group()
       if any(k in s.lower() for k in (b'key', b'pass', b'secret', b'pwd')):
           print(f"0x{m.start():x}: {s}")
   ```
   - Too many high-entropy-block hits (the whole heap is one) → use the maps/offsets from [[re-memdump]] to shrink to near the crypto context, or first locate the function with the import table in step 4 and then take the arguments
   - The key may be fragmented on the heap/stack or XOR-obfuscated (see pitfall 1) — after you find it, verify it once in the decrypt script ([[re-crypto-decrypt]] step 4)

3. **Resource files (.rsrc / embedded blob)**:
   - PE: use `llvm-objdump -s -j .rsrc sample.exe` or look at the resource section in Ghidra; `7z x sample.exe` can extract embedded icon/version/custom resources
   - ELF: find an embedded blob in `.rodata` (`objdump -s -j .rodata`); combined with [[re-firmware]] experience — a key in firmware is often in a config file / a default certificate
   - An embedded blob may be a serialized config (a key field encoded as JSON/INI); parse it as text first, then dig as binary; if the blob is encrypted (high entropy) → go back to [[re-crypto-id]]; the outer layer may have another decrypt

4. **Import-table clues (near Crypt* functions)**:
   - `objdump -p sample.exe | grep Crypt` / the Ghidra Imports window looks for `CryptEncrypt`/`CryptDecrypt`/`BCrypt*`/`RSA*`/`EVP_*` (OpenSSL)
   - After you find it, decompile that function: the key argument (a handle / KEYEXCHANGE structure) usually comes from "a fixed value set somewhere earlier" — walk the data flow upward from the function: a constant assignment, global-variable initialization, the `pbKeyData` argument of `CryptSetKeyParam`
   - Watching arguments at a breakpoint is more direct ([[re-gdb]] / [[re-x64dbg]]): after `b CryptSetKeyParam`, look at the memory `pbKeyData` points at — but note the [[re-analyze/platform-tips]] supreme rule: running goes into the sandbox

5. **Recover a key-derivation function (PBKDF)**:
   - Recognize a `PBKDF2`/`scrypt`/`bcrypt`/`EVP_BytesToKey` call in the decompile → key = KDF(passphrase, salt, iteration count); extract the arguments one by one: the passphrase (a hardcoded string or user input), the salt (fixed bytes or context), the iteration count (a constant)
   - Write a recovery script (`pip install cryptography` / `hashlib` includes PBKDF2):
     ```python
     import hashlib
     key = hashlib.pbkdf2_hmac('sha256', b'passphrase', b'<salt>', 100000, dklen=32)
     print(key.hex())
     ```
   - Verify: the derived key matches the high-entropy block in memory from step 2 (the key after the KDF finished is there), or try a known ciphertext directly with [[re-crypto-decrypt]]
   - Dynamic supplement: Frida-hook the KDF function and watch the return buffer (inside the sandbox, [[re-sandbox]]), and compare it with the static recovery

## Cross-domain joins

- [[re-protocol]]: step 3 of this gateway's workflow (the key) — the middle of the encrypted-communication decrypt chain (crypto-id → crypto-keys → crypto-decrypt)
- [[re-malware]]: C2 configuration extraction (a hardcoded C2 key/passphrase) — the key step of re-malware step 4; a malware sample's key is often buried in configuration ([[re-behavior]] behavior confirmation + extraction by this skill)
- [[re-firmware]]: mining a hardcoded passphrase/key inside firmware — re-firmware step 3 (rootfs configuration / default certificates)
- [[re-memdump]]: the default dump is the raw material for this skill's memory search (the [[re-analyze/platform-tips]] direct-read vs dump decision table)
- [[re-crypto-decrypt]]: downstream — the extracted key is handed to the decrypt script for verification and use
- [[re-anti-analysis]]: a key inside a packer is unpacked first (set the dump point by materialization; see [[re-memdump]] dump timing)
- [[re-ioc]]: an extracted hardcoded key/passphrase can be a YARA feature and an IOC

## Common pitfalls

- **The key is stored in fragments / XOR-obfuscated**: symptom — the single "key" block you extracted does not decrypt to plaintext, or strings/memory have no complete key; cause — the sample splits the key into several pieces (fragments) or stores it XORed with a constant, and reassembles it at runtime; fix — decompile and find the reassembly logic: key bytes come from several offsets / several XORs (in the "check hardcoded first" flow of pitfall 3, when you confirm it is hardcoded you must look at the arithmetic at the reference); after recovering candidates, try them one by one in [[re-crypto-decrypt]]
- **A truly random key ≠ extractable statically**: symptom — static/memory search finds nothing, and the user still wants the key; cause — the key is generated by `RAND_bytes` at startup or delivered by a server, and is simply not in the sample (no solution outside a white-box attack); fix — report honestly: there is no locally extractable key; switch to intercepting key derivation (hook `RAND_bytes` / KDF inputs), an algorithm-side attack (if the decrypt result can be verified by known plaintext), or go back to [[re-malware]] to see whether the key is delivered by C2
- **Check whether it is hardcoded before going dynamic**: symptom — the sample hardcoded the key, but you run a sandbox + Frida for half a day first; cause — you did not follow the static-first order; fix — step 1 strings/cross-references is a 30-second check, and a static hit skips dynamic work; go dynamic only when static work found nothing and you need runtime material (KDF inputs, reassembly logic) (see the static-first approach and the supreme rule in [[re-analyze/platform-tips]])
- **Dumping too early misses the runtime key**: symptom — a memory search finds no high-entropy block, or the ones it finds do not match; cause — you dumped before packer decryption / key initialization (what you got is the packer's initial state; see [[re-memdump]] pitfall 2); fix — confirm the plaintext/key has materialized (a classic single-layer packer is after the OEP and has executed the crypto call; multi-stage / on-demand decrypt is judged by "write → execution transfer + payload header/import recovery") and then gcore; when needed, trigger a breakpoint on the crypto function and then dump (with [[re-gdb]])
- **A memory key-candidate pattern misses AES-192**: symptom — high-entropy blocks are searched only at 16/32 bytes, a 24-byte key is missed, and decryption does not match; cause — 16/32 bytes for AES-128/256 is a common assumption, and an AES-192 key is exactly 24 bytes (12 rounds); fix — the high-entropy-block search window covers the three sizes 16/24/32 (paired with the 10/12/14 round-count judgment in [[re-crypto-id]] to fix the parameters), and after a candidate hits, try it in [[re-crypto-decrypt]] first
- **A ransomware-class sample uses the key and then destroys it; a dump after the fact is necessarily empty**: symptom — you confirmed the sample executed encryption, but no memory dump contains key material; cause — ransomware zeroes the key immediately after encryption finishes (wipe), and the key exists in memory only briefly during the encryption phase (NotPetya/BadRabbit/Phobos experiments can draw a key-lifetime timeline); fix — take several snapshot dumps during the encryption phase (while business logic is running) and compare them to build a timeline, or with [[re-gdb]] break before the crypto function returns and capture the arguments; that is more reliable than a single after-the-fact dump
- **Key plaintext appears only at a specific execution instant, and a dump must miss it**: symptom — a dump search finds nothing, but dynamic tracing can see the key appear; cause — some samples' master key exists in plaintext in memory only in a very short window (for example a browser v20_master_key appears only at the decrypt instant, and VoidStealer catches exactly that point with a hardware breakpoint); fix — first locate the key-use point (the crypto function / derivation point), set a hardware breakpoint on it ([[re-gdb]]/[[re-x64dbg]], not depending on a breakpoint instruction) and capture the plaintext live; that is more efficient than "dump and then search a haystack"
