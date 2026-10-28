---
name: re-blockchain
description: >
  EVM smart-contract reversing: bytecode decompilation, vulnerability analysis.
  Triggers: `智能合约`, EVM, Solidity, `字节码`, `合约漏洞`, ABI, Solana, Move, BPF
capabilities: [blockchain-analysis]
---

# EVM smart-contract reversing (cast / panoramix / web3.py)

## When to use / when not to use

- Use: you have contract bytecode (an on-chain address or a .bin/.hex file) and need to recover the logic — ABI recovery, decompilation, storage-layout rebuild
- Use: contract vulnerability analysis (reentrancy / integer overflow / permissions) or audit location before exploitation
- Use: forensics of a malicious contract / a token-scam contract (on-chain data retrieval, read-only pulls)
- Do not use: Solidity source is available and not obfuscated — reading the source is more accurate (the audit approach matches [[re-vuln]]); this skill is for no source / bytecode only
- Do not use: a non-EVM chain this section does not cover (for example a WASM-family chain, whose instruction set differs); WASM goes to [[re-wasm]]
- Note: on-chain interaction is mainly read-only (`cast call`/`cast code`/`cast storage`); any write-to-chain / deploy / dynamic verification defaults to a local anvil or an isolated network ([[re-analyze/platform-tips]] sandbox supreme rule); contract analysis is mostly static and follows "static first"

## Tool preparation

### python3 — the base for scripted analysis

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: `brew install python3`; Windows: `choco install python`
- Verify: `python3 --version` (every script in this skill is Python 3)

### cast (foundry) — the primary on-chain interaction / bytecode / storage tool

- The official installer (all platforms, installs to `~/.foundry/bin`, including forge/cast/anvil/chisel): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- macOS: `brew install foundry` (the official Homebrew formula, including the four-piece set)
- Arch: the official repo has **no** foundry — use the AUR `foundry-bin` (`yay -S foundry-bin` and similar); **note that `pacman -S foundry` is an unrelated GNOME Builder toolkit; do not install the wrong one**; Debian/Ubuntu/Fedora have no official package — use the official installer
- Verify: `cast --version && anvil --version`

### web3.py (pip, Python >=3.10) — scripted on-chain analysis

- `pip install web3` (official PyPI; current 8.x requires **Python >=3.10**, and PyPI `requires-python` is `<4,>=3.10` — only 7.x supports 3.8. A Python 3.8/3.9 environment must pin 7.x)
- Verify: `python3 -c "import web3; print(web3.__version__)"`

### panoramix (pip, Python 3.9–3.11) — an EVM decompiler (disasm → flow)

- `pip install panoramix-decompiler` (official PyPI 0.6.x, requires Python 3.9–3.11); the more actively maintained fork is `panoramix-decompiler-abi`; both provide the `panoramix` command
- Verify: `panoramix --help` (or `python3 -m panoramix --help`)
- Usage: pass raw bytecode directly, `panoramix <hex> --abi`, to decompile; passing a contract address needs the `WEB3_PROVIDER_URI` environment variable (pull bytecode from chain); pseudocode `.pan` / disassembly `.asm` is written to the cache directory

### pyevmasm (pip, Python 3) — EVM disassembly

- `pip install pyevmasm` (official PyPI); verify: `pyevmasm -d 0x6001600101` prints instruction lines
- Alternative: `cast disassemble <hex>` (ships with foundry, same purpose)

### hevm / echidna (optional, formal / fuzz verification)

- echidna: a prebuilt binary from GitHub releases (crytic/echidna) or `cargo install --locked echidna` (the official repo has no distro package; Arch has an AUR package); verify: `echidna --version`
- hevm: GitHub releases (ethereum/hevm) or a cargo build; verify: `hevm --version`
- Both are optional — finish the static analysis of steps 1-5 first, and bring them in only when you need behavioral verification

### solc / solc-select (optional) — storage-layout cross-check

- `pip install solc-select` (Python 3) + `solc-select install 0.8.28` (official PyPI / compiler-artifact download); or the official solc-bin binary (a Linux x86 static package)
- Verify: `solc --version`
- Not needed for a sourceless contract; used to cross-check the authoritative storage layout when you "have a same-source compile artifact" (pitfall 2)

## Procedure

Run in order. Archive each step's artifacts (bytecode / selector table / pseudocode / asm) with sha256 + path ([[re-ioc]] evidence chain).

1. **Obtain contract bytecode (on-chain / file)**:
   ```sh
   # on-chain (an RPC node; a public RPC or your own node)
   cast code 0xDEAD... --rpc-url https://eth.llamarpc.com > code.hex
   # a file (.bin/.hex text or binary)
   xxd -r -p code.hex > code.bin && file code.bin && xxd code.bin | head -2
   sha256sum code.bin > code.sha256
   ```
   - Distinguish **creation code** (includes initcode + runtime; the front is deploy logic) from **runtime code** (pure business logic; the first instruction is often `0x6080...` PUSH1 0x80 to allocate memory) — Etherscan's Bytecode page is creation, and the Deployed Bytecode page is runtime; analyze business logic on runtime
   - On-chain data-retrieval discipline: `cast call`/`cast code`/`cast storage` are read-only and safe; write-to-chain / transaction operations default to a local `anvil` test chain

2. **Recover the ABI (function selectors / signatures)**:
   ```sh
   # extract PUSH4 selector constants from the bytecode (4 bytes = keccak256(signature)[:4])
   cast disassemble "$(cat code.hex)" | grep -E 'PUSH4' | awk '{print $NF}' | sort -u > selectors.txt
   # cross-check a signature database (4byte.directory / the etherface online service)
   while read s; do echo -n "$s "; cast 4byte "$s"; done < selectors.txt
   # compute a known signature locally (the signature must be canonical; see pitfall 1)
   cast sig "transfer(address,uint256)"
   cast sig "balanceOf(address)"
   ```
   - Event topics are the same: log topic0 (the first 32 bytes) = keccak256(event signature), queried against etherface/4byte
   - When there are many candidate signatures, disambiguate with argument length (a CALLDATASIZE compare), fallback logic, and storage-access patterns (pitfall 1)

3. **Decompile (the panoramix approach: disasm → flow)**:
   ```sh
   panoramix "$(cat code.hex)" --abi > contract.pan    # pseudocode (readability first)
   cast disassemble "$(cat code.hex)" > contract.asm   # the precise instruction stream (cross-check ground truth)
   # decompile by address (needs a node): WEB3_PROVIDER_URI=<rpc> panoramix 0xDEAD...
   ```
   - Workflow: disasm (instruction-level ground truth) → locate function boundaries (the dispatch table: the `PUSH4 sel EQ PUSH2 off JUMPI` pattern, in the ~0x00-0x1f region at the start of the bytecode) → a rough read of the pseudocode → a precise read of key functions back in asm
   - Rough output is normal (pitfall 4); every decompile conclusion is cross-checked against asm

4. **Recover the logic (storage layout / state variables)**:
   ```sh
   # on-chain storage reads (state variables start at slot 0, 32 bytes per slot)
   cast storage 0xDEAD... 0 --rpc-url <rpc>
   cast storage 0xDEAD... 1 --rpc-url <rpc>
   # a dynamic-array / mapping slot = a keccak256 derivation (see the formula in pitfall 2)
   cast call 0xDEAD... "owner()(address)" --rpc-url <rpc>   # a public-variable getter
   # no source: infer semantics from SSTORE/SLOAD constants and getters in the decompile
   grep -E 'SSTORE|SLOAD' contract.asm | head
   ```
   - Layout rules: inheritance merges invariants by C3 linearization, each variable is 32 bytes (`bool/uint8/address` and similar can pack into the same slot), a dynamic array is `slot = keccak256(slot_index)`, a mapping is `slot = keccak256(key ++ slot_index)`; when source exists, `solc --storage-layout` emits authoritative JSON to cross-check
   - Cross-check with ABI getters: a public state variable automatically generates a getter, and the `cast call` result infers the variable type and slot backward

5. **Vulnerability analysis (reentrancy / integer overflow / permissions)**:
   ```sh
   grep -cE 'CALL|DELEGATECALL|CALLCODE' contract.asm     # the external-call surface (reentrancy / interaction boundary)
   grep -E 'ADD|MUL|SUB' contract.asm | head               # arithmetic (before 0.8 there is no built-in overflow check)
   grep -E 'CALLER' contract.asm | head                    # caller checks (onlyOwner permission)
   ```
   - Reentrancy: state is changed only after an external call (CALL to a user-controlled address) (the SSTORE order is after the CALL) — check whether effects happen before interactions
   - Overflow: Solidity before 0.8 has no built-in check — see whether there is an overflow branch after ADD/MUL; on 0.8+ look for an `unchecked` block
   - Permissions: the pattern that compares CALLER with the owner slot; a writable owner slot / no check means arbitrary calls (initializing owner only in the constructor is a common missing-rights case)
   - Optional behavioral verification: echidna property tests (invariants / reentrancy / overflow patterns), hevm symbolic execution, `anvil` locally reproducing an attack sequence
   - Conclusion discipline: a vulnerability decision needs "path reachable" evidence (the call chain + state conditions); an instruction pattern alone is a weak signal (pitfall 4)

## Non-EVM chains (Solana / Move)

The flow is isomorphic to EVM (bytecode decompile → vulnerability analysis); the instruction set and the resource model differ — identify the runtime first, then follow the matching path.

- **Solana (BPF bytecode)**: identification features — an ELF file + a .text section of BPF instructions (an eBPF-class instruction set); the decompile path — `llvm-objdump -d` (BPF disassembly) or a dedicated decompiler; analysis focus — program accounts and instruction dispatch (the CPI cross-program call chain), account-data layout (struct offsets)
- **Sui / Aptos (Move bytecode)**: identification features — module / resource / function-table structure; decompile — the move disassembler (`move disassemble`); analysis focus — how the resource model (objects / capabilities) affects the vulnerability surface (transfer / ownership logic), the module dependency graph
- **DeFi/NFT cases**: pool contracts (the AMM constant-product formula), token-standard variants (SPL and similar), locating authorization and withdrawal logic
- Vulnerability analysis continues: logic vulnerabilities (reentrancy / permissions) reuse the EVM approach, and resource/account-model differences are judged separately

## Cross-domain joins

- [[re-managed]]: after this gateway's "identify the runtime" step recognizes EVM bytecode (.bin/hex), it always calls this skill (contract bytecode is the "managed bytecode" branch)
- [[re-vuln]]: contract vulnerabilities join the vulnerability-discovery gateway — echidna's coverage-guided / corpus approach matches [[re-fuzzing]], and assertion-crash analysis matches [[re-crash-triage]]; the vulnerability-report structure is the same (entry / conditions / impact / fix)
- On-chain data retrieval: cast/web3.py read-only over RPC (a public RPC, your own node, the Etherscan API); write-to-chain and dynamic verification default to a local anvil (an isolated network)
- [[re-wasm]]: a non-EVM Wasm contract / an on-chain Wasm module (the same domain, a different instruction set)
- Cites the [[re-analyze/platform-tips]] static-first (large samples) and sandbox-isolation branches (isolate write-to-chain / dynamic verification)

## Common pitfalls

- **Selector collision**: symptom — `cast 4byte` returns several candidate signatures, or a `cast call` with a guessed signature fails to decode / the result is misaligned; cause — a selector is the first 4 bytes of keccak256(signature), collisions exist (malicious variants / known collision cases), and a large number of signatures are not in the database; fix — `cast sig` holds only for a canonical signature (no spaces between arguments, `uint256` is not written `uint`, addresses are lowercase and complete); disambiguate candidate signatures with a CALLDATASIZE compare (argument-length dispatch), fallback logic (fallback handling), and storage-access patterns; finally confirm by comparing the full-signature keccak256
- **Storage layout vs source mapping is hard**: symptom — a sourceless contract inferred as "declaration order = slot order" is wrong, and the values you read have the wrong type / mixed slots; cause — the layout is affected by the compiler version, optimization switches, inheritance order (C3), and struct/array packing rules, and without source there is no authoritative map; fix — with source: `solc --storage-layout` emits JSON to cross-check (the compiler version must match); without source: infer types from SSTORE constants in the decompile + getter behavior + value size, and mark confidence rather than guessing; compute dynamic-array / mapping slots by the keccak256 formula (step 4), and do not add one linearly
- **A proxy contract (delegatecall logic lives elsewhere)**: symptom — decompiling the main contract shows only a fallback + a delegatecall forward, and no business logic; cause — an upgradeable-proxy pattern (EIP-1967 and similar) puts the logic in an implementation contract: the main contract only stores the implementation address and delegatecalls; the state-variable layout is in the main contract and the code is in the implementation (a layout conflict is itself a classic vulnerability); fix — first read the EIP-1967 implementation slot: `cast storage <addr> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url <rpc>` (the admin slot is `0xb53127684a568b3173ae13bae8d486943e0793e1d5dccd29778a66c42e1c39d`); for a non-standard proxy, locate the SLOAD constant slot in the decompile and read the implementation address; then `cast code <implementation address>` analyzes the implementation; a changeable implementation address = upgradeable, and the conclusion marks the read time
- **Decompiler output is rough and needs hand work**: symptom — panoramix pseudocode lacks variable names / types / storage semantics, function boundaries are misaligned, and you wrongly think the contract logic is chaotic or a key branch was missed; cause — the EVM has no types and no symbol table, symbolic-execution / heuristic decompilation drops information, and modern Solidity optimizer output (ABIEncoderV2, the optimizer) is structurally complex; fix — treat pseudocode only as a "rough map", and for a key function go back to `cast disassemble` for an instruction-level precise read (locate the dispatch table → per-instruction semantics → storage/call patterns); cross-check several tools (panoramix + cast disasm + echidna behavioral verification); the conclusion marks confidence and the verification method
