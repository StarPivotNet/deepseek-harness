---
name: re-wasm
description: WASM reverse engineering: format parsing, wasm2wat, the browser side. Triggers: WASM, wasm, WebAssembly, wat
capabilities: [web-assembly]
---

# WebAssembly reverse engineering (WABT / wasmtime / Chrome DevTools)

## When to use / when not to use

- Use: recover logic from a .wasm module (web front-end crypto/checks, a browser extension, a game, a wasm payload loaded by a malicious page / supply-chain JS)
- Use: a sample where `WebAssembly.instantiate` / `WebAssembly.Module` / a `.wasm` fetch appears — analyze the wasm and the JS glue as one piece
- Do not use: not wasm (native goes to [[re-binary-core]], .NET to [[re-dotnet]], Java to [[re-java]], pure JS/script to [[re-script-deob]])
- Do not use: the wasm module is already readable enough and you only need to read the logic — `wasm2wat` and read the WAT. The full flow is unnecessary
- Note: dynamic execution defaults to a sandbox (top rule in [[re-analyze/platform-tips]]). A wasm module is relatively isolated, but the host JS glue calls sensitive APIs such as DOM/network — restore the JS side first ([[re-script-deob]])

## Tool setup

Follow [[re-analyze/platform-tips]] — wasm parse/decompile is a static step and skips the sandbox. Dynamic execution (wasmtime/wasm3/browser load) enters a sandbox under the top rule (at least disconnect the network).

### WABT (wasm2wat / wasm-decompile / wasm-objdump, the primary parse and decompile tools)

- Debian/Ubuntu: `apt install wabt`; Fedora: `dnf install wabt`; Arch: `pacman -S wabt`
- macOS: `brew install wabt`; Windows: `choco install wabt`, or the bin directory of a GitHub `WebAssembly/wabt` release
- Verify: `wasm2wat --version && wasm-decompile --version && wasm-objdump --version`

### wasmtime (WASI CLI runtime; --invoke calls an export directly)

- Official installer (all platforms, installs to `~/.wasmtime/bin`): `curl https://wasmtime.dev/install.sh -sSf | bash`
- Debian/Ubuntu: no official package — use the official install script/binary (install.wasmtime.dev) or build from source. Fedora: the official repo has no CLI package — use the official install script or a third-party repo (GetPageSpeed/COPR). Arch: `pacman -S wasmtime`. macOS: `brew install wasmtime`. Windows: `winget install BytecodeAlliance.Wasmtime`
- Verify: `wasmtime --version`

### wasm3 (a light interpreter; it can run with no WASI dependency; embedded / quick-check scenes)

- Arch: the official repo has no wasm3 — AUR (for example the wasm3 package) or build from source. macOS: `brew install wasm3`
- Debian/Ubuntu/Fedora have no official package → download the single-file binary for the platform from a GitHub `wasm3/wasm3` release, or build from source: `git clone --depth 1 https://github.com/wasm3/wasm3 && cmake -B build -S wasm3 && cmake --build build`
- Verify: `wasm3 --version`

### Chrome DevTools (browser-side dynamic analysis)

- Chrome/Chromium: Debian/Ubuntu `apt install chromium` (Chrome uses the official deb); Fedora `dnf install chromium`; Arch `pacman -S chromium`; macOS `brew install --cask google-chrome`; Windows official installer
- Verify: start the browser, `F12` opens DevTools → the Sources panel can expand a .wasm file
- Serve locally for the browser to load: `python3 -m http.server 8000`

### binaryen (wasm-opt optimize / deobfuscate; wasm-dis disassemble)

- Debian/Ubuntu: `apt install binaryen`; Fedora: `dnf install binaryen`; Arch: `pacman -S binaryen`
- macOS: `brew install binaryen`; Windows: `choco install binaryen`, or a GitHub `WebAssembly/binaryen` release
- Verify: `wasm-opt --version`

## Steps

Run in order. Record evidence at each step (path + sha256; see [[re-triage]]).

1. **Identify a wasm module**:
   ```sh
   file sample.wasm                          # "WebAssembly (wasm) binary module version 0x1 (MVP)"
   xxd sample.wasm | head -1                 # magic 00 61 73 6D (\0asm) + version 01 00 00 00
   ```
   - Magic `\0asm` (`00 61 73 6D`) + version `01 00 00 00` = standard wasm. If it does not match → not wasm (it may be encrypted/obfuscated/damaged; see pitfall 3)
   - It often appears embedded. Restore a .wasm file first: a base64 string inside `atob(...)`, or a `Uint8Array([0,97,115,109,...])` array literal in JS
   - Confirm from the JS side: `WebAssembly.instantiate` / `WebAssembly.Module` / a `.wasm` fetch means a wasm payload (JS glue goes to [[re-script-deob]])

2. **Section parse (wasm-objdump / wasm2wat)**:
   ```sh
   wasm-objdump -x sample.wasm        # every section: Type/Import/Function/Table/Memory/Global/Export/Code/Data
   wasm-objdump -h sample.wasm        # section summary only
   wasm2wat sample.wasm -o sample.wat # binary → WAT text (add --enable-all when there are extension instructions)
   wasm-objdump -d sample.wasm        # disassemble every function body (WAT-style instructions)
   ```
   - What each section means for RE: Type (function signatures, helps restore types), Import (**functions injected by the host JS/WASI — the call boundary**), Export (**external function names JS can call**), Data (**the string-constant area**), Code (instruction bodies)
   - Read Import + Export first and build the call surface, then enter Code

3. **Decompile (wasm-decompile)**:
   ```sh
   wasm-decompile sample.wasm -o sample.c    # C-like pseudocode (readability first)
   ```
   - Compare with WAT: wasm-decompile reads well but drops some type/boundary information. For a critical function, the close read follows the WAT that `wasm2wat` produced
   - Locate the entry: `(export "checkPassword" ...)` → JS side `instance.exports.checkPassword`. An imported function → find the implementation in the JS glue (pitfall 2)
   - Strings: `wasm-objdump -s sample.wasm` dumps the raw contents of every section (hex dump, including the Data segment; the Data section can also be read from `-x` output). In the WAT, find `(data (i32.const offset) "string")`, and map `i32.const offset` in the code back to the string (pitfall 1)
   - When there are many functions / suspected obfuscation, skim with wasm-decompile first, pick the target function, then read it closely

4. **Browser side (DevTools Sources / JS call surface)**:
   - Open the sample page (serve it locally). DevTools → Sources → expand the `.wasm` file on the left: Chrome automatically gives a decompiled pseudocode view. You can set breakpoints and single-step. The Scope panel shows wasm locals. The Call Stack shows JS↔wasm frames together
   - Call surface: `importObject` in JS-side `WebAssembly.instantiate(bytes, importObject)` defines the wasm import implementations. `instance.exports.xxx(...)` is a wasm external function — breakpoint the JS call site, single-step into the wasm frame, and watch arguments/return value
   - Headless: Chrome headless + DevTools Protocol (`--headless --remote-debugging-port=9222`), or an equivalent Node `WebAssembly.instantiate` reproduction of the call
   - Change values dynamically: in the DevTools wasm pseudocode view, change arguments and replay the call, and compare outputs as a black box

5. **Dynamic (wasmtime + instrumentation / black-box differential)**:
   ```sh
   wasmtime run sample.wasm                                   # a WASI program (needs a _start export)
   wasmtime run --invoke checkPassword sample.wasm '"test"'   # call an export directly (arguments are parsed as JSON)
   wasmtime run --dir . --env FLAG=xxx sample.wasm            # explicitly grant WASI file/environment capabilities
   wasm3 sample.wasm checkPassword test                       # a module with no WASI uses wasm3 (arguments as-is)
   ```
   - Instrumentation: `wasm-objdump -d` static instructions + `--invoke` black-box differential — feed different inputs to the same export, and watch output changes to locate branches / check logic
   - WASI system calls: `strace -f wasmtime run sample.wasm` (pitfall 5; goes to [[re-tracing]])
   - When you need BigInt arguments or to trace on the JS side, write node glue:
     ```js
     const { instance } = await WebAssembly.instantiate(bytes, imports);
     console.log(instance.exports.f(1n, 2n));   // i64 must be BigInt (pitfall 4)
     ```
   - Every dynamic execution defaults to a sandbox (top rule in [[re-analyze/platform-tips]])

## Related skills

- [[re-managed]]: gateway workflow step ① (identify the runtime) and ② (decompile) always call this skill. A wasm host program (JS/Node) belongs to the managed-code domain
- [[re-script-deob]]: deobfuscate and restore JS glue first (instantiate / import object / fetch wasm / atob embed) — import implementations are basically all on the JS side. The two skills must be used together
- [[re-tracing]]: the dynamic side of a WASI program — `strace -f wasmtime run` watches the syscall boundary
- [[re-emulation]]: optional — emulate a WASI module that has no suitable runtime (wasm is often compiled with Emscripten; before emulation, understand host dependencies by the WASI mapping)
- [[re-firmware]]: a wasm module in an embedded / router web UI
- Base [[re-binary-core]]: first look ([[re-triage]]); a sample that mixes wasm and native
- [[re-malware]]: the full chain of a malicious page / supply-chain JS loading a wasm payload
- [[re-deobfuscate]]: wasm obfuscation (wasm-obfuscator and similar) is obfuscation confrontation. The deep-recovery idea is the same

## Pitfalls

- **Strings are in the data segment, not in the code**: symptom — wasm2wat/decompilation shows only `i32.const offset` numbers, and grep finds no plaintext; cause — wasm has no string type. String constants live in the Data segment, and code references them by memory address; fix — `wasm-objdump -s sample.wasm` dumps the raw contents of every section (hex dump; the Data segment is in there; the Data section can also be read from `-x` output) (in the WAT, look at `(data (i32.const offset) "…")`), and map the offset back to the reference site
- **imports are the JS boundary, not a library call**: symptom — the critical check/decrypt logic is not in the wasm file; cause — a wasm import is injected by the host JS (`WebAssembly.instantiate(bytes, { env: {...} })`), and the sensitive logic is on the JS side; fix — `wasm-objdump -x` lists the Import section → find the matching implementation in the JS glue ([[re-script-deob]]) — wasm only proves "what was called", not "what it did"
- **Obfuscated wasm (wasm-obfuscator and similar): deobfuscate before analysis**: symptom — wasm2wat output is a long stretch of control-flow flattening, dead code, and `select` noise, strings are sliced/encrypted, and function names are wiped; cause — the obfuscator does control-flow flattening + string encryption + name erasure; fix — binaryen restores flattening pass by pass: `wasm-opt --flatten --simplify-locals --vacuum --dce -O3` iterated for several rounds. String encryption needs the decrypt logic located (same idea as [[re-deobfuscate]]; note the decrypt function may be an import — back to pitfall 2)
- **BigInt calling convention**: symptom — JS calling a wasm export raises `TypeError: Cannot convert a BigInt value to a number`, or an i64 argument is silently truncated; cause — an i64 argument/return can cross the JS↔wasm boundary only as BigInt (Number has only 2^53 precision); fix — on the JS side pass BigInt with `instance.exports.f(1n, 2n)`. wasmtime `--invoke` parses arguments as JSON and does not support BigInt — write node glue when you need it. Reproduce the algorithm with Python int / JS BigInt, not Number
- **WASI syscall boundary**: symptom — wasmtime running a WASI program reports `unknown import: wasi_snapshot_preview1.…`, or browser and runtime behavior disagree; cause — a WASI program imports `wasi_snapshot_preview1` to get file/clock/random/network capabilities, and the runtime fails if that capability was not granted. In a browser the host import is JS, not WASI, so the same module can behave differently at the two ends; fix — `wasm-objdump -x` reads the Import section and confirms which WASI functions are used → `wasmtime run --dir . --env K=v` grants them explicitly → `strace -f wasmtime run` watches the actual syscalls ([[re-tracing]]). Mark the runtime environment in the conclusion (browser vs wasi)
