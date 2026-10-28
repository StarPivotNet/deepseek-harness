---
name: re-go
description: Go binary reversing: retained symbols, string tables, goroutines. Triggers: Go, golang, `Go二进制`, goroutine, go build
capabilities: [lang-runtime-analysis]
---

# Go binary reversing (symbols / string tables / goroutines)

## When to use / when not to use

- Use: after confirming a Go-compiled binary (`file` shows a Go BuildID, or the section table contains `.gopclntab`), recover logic from Go's default symbol retention; identify the Go version and build info; analyze control flow of multi-goroutine programs; restore Go symbols after strip
- Use: malicious Go samples ([[re-malware]] static recovery — Go malware often carries plaintext C2 config and buildinfo)
- Do not use: non-Go native programs (C/C++ goes straight to [[re-binary-core]]; Rust goes to [[re-rust]])
- Do not use: if a packer is confirmed, go to [[re-anti-analysis]] first (after a Go binary is packed, pclntab offsets are invalid; return to this skill after unpacking)
- Note: dynamic steps default to a sandbox ([[re-analyze/platform-tips]] top principle); Go binaries are large, so prefer static analysis (large-sample principle)

## Tool setup

See [[re-analyze/platform-tips]] — Go binaries are usually 1MB and up (the runtime is most of that). Follow "static first (large samples)"; dynamic work (running the sample under dlv/gdb) defaults to a sandbox.

### Go toolchain (go version / go tool buildid / go version -m)

- Debian/Ubuntu: `apt install golang-go` (distro package; the Debian build may lag — `go version -m` buildinfo fingerprints need Go 1.18+, so if the tool is too old use the official tarball)
- Fedora: `dnf install golang`; Arch: `pacman -S go`
- macOS: `brew install go`; Windows: `choco install golang` or the official installer
- Verify: `go version`; `go tool buildid sample` prints a build ID (a non-Go program errors)

### Ghidra (built-in Go support) and Go plugins

- Ghidra 11.2+ ships a Go analyzer (identifies Go binaries, recovers symbols from pclntab, annotates runtime types). Install via [[re-ghidra]]
- IDA plugin (optional): GitHub `0xjiayu/go_parser` — an IDA Pro Go parsing script that recovers types and structs
- Verify: after Ghidra import, the function tree shows `main.*` / `runtime.*` names

### GoReSym (symbol recovery after strip; optional but critical)

- No distro package → official install (needs the Go toolchain): `go install github.com/mandiant/GoReSym@latest`
- Usage: `GoReSym -t -d -p sample > gosyms.json` (-t types, -d stdlib packages, -p file path)
- Import into a decompiler: `goresym_rename.py` (script from the official GoReSym repo; Ghidra/IDA import; PR #11 merged)
- Verify: `GoReSym -about` prints about and license info; the JSON output contains function names and addresses

### redress (Go binary metadata, optional)

- No distro package → official install: `go install github.com/goretk/redress@latest`
- Usage: `redress info sample` (compiler version / GoRoot / main package path), `redress packages sample --std --vendor` (package list), `redress source sample` (source-tree projection), `redress types struct sample --methods` (types)
- Verify: `redress version`

### garble — identifying Go obfuscation (common in malware; no standalone tool)

- garble is a community-maintained third-party Go obfuscator (build-time transforms, not a runtime packer; author mvdan, not an official Go project) — increasingly common in Go malware, so identify it before analysis
- **Identification features**: (1) the string/section table occasionally shows a `garble` marker (build info is stripped by default, so a leftover is not guaranteed) (2) a garble build has no DWARF by default (`readelf -S` has no `.debug_*`) (3) function names are hashed (`main.main` → a short hash name; pclntab remains but names are unreadable) (4) a `-literals` build garbles strings
- **Common build flags**: `garble -literals build` (string obfuscation; stripping debug info is the default and needs no flag; `-tiny` also drops location info / strips panic prints and symbol names, about -15% size)
- Analysis points are in step 3 (hashed function names / lazy string decryption / interface method names kept)

### bloaty (size analysis, optional)

- Debian/Ubuntu: no official package → GitHub `google/bloaty` release or a source build (cmake+ninja, needs protobuf)
- Fedora: `dnf install bloaty`; Arch: `pacman -S bloaty`; macOS: `brew install bloaty`
- Windows: official release (or the Linux build inside WSL)
- Verify: `bloaty --version`; usage: `bloaty -d symbols sample`

## Procedure

Run in order. Record evidence at each step (path + sha256; see [[re-triage]]).

1. **Identify a Go binary**:
   ```sh
   file sample                     # "Go BuildID=..." means Go (usually statically linked)
   readelf -S sample | grep -i go  # .go.buildinfo / .gopclntab / .gosymtab
   nm sample | grep -E 'main\.main|runtime\.main'   # whether symbols exist
   ```
   - `.gopclntab` is the function table (function names / addresses / line numbers); the section name is the decision criterion
   - Confirm symbol retention: empty `nm` → pitfall 1 (strip)

2. **Go version fingerprint**:
   ```sh
   go tool buildid sample                # build ID (unique id from go build; always available)
   go version -m sample                  # Go 1.18+: Go version + module path + dependency list
   strings sample | grep -E '^go1\.[0-9]+'   # older fallback: runtime.buildVersion
   ```
   - The version decides pclntab layout and how GoReSym/redress parse it; no buildinfo → pitfall 5
   - The module path from `go version -m` gives the project name and dependencies directly (malware often leaks the C2 framework); write it down first
   - pclntab magic dates the version band directly: the first 4 bytes of `.gopclntab` are `0xfffffffb` = Go 1.2–1.15, `0xfffffffa` = 1.16–1.17, `0xfffffff0` = 1.18–1.19, `0xfffffff1` = 1.20+ (header layout in step 6; GoReSym and similar tools scan these four values)

3. **Using the symbol table**:
   - **Tool choice (goal → tool)**:
     - Recover function names (symbols after strip) → **GoReSym**: `GoReSym -p sample > gosyms.json` → `goresym_rename.py` imports into the decompiler and restores names
     - Type recovery (struct fields / interfaces / method signatures) → **redress**: `redress types struct sample --methods` (or GoReSym `-t` type output)
     - Version identification → buildinfo (`go version -m` / `go tool buildid`) + pclntab magic (step 2) — no symbol tool required
   - Go keeps symbols by default (unless `-ldflags "-s -w"`): `nm sample | grep ' main\.'` lists user-code functions
   - After Ghidra import the function tree is grouped by package; the ELF entry `_rt0_amd64_linux` is only a platform stub. The real user entry is `main.main` (called by `runtime.main`); `main.init` is initialization
   - Decompile `main.main` for the main logic and walk the call chain from `main.` functions; when symbols are fully retained there is nothing to guess
   - **garble-obfuscated samples** (common in Go malware; see tool setup): pclntab still parses but function names are hashed — GoReSym lists the hash names, and structure / call chains are still usable; with `-literals`, strings are **lazily decrypted** at use sites through a top-level decode function (only strings that are touched get decoded) — after triggering use, read plaintext from memory, or recover the decoder statically (GoStringUngarbler can automate this); **exported interface method names are not obfuscated by garble** (to keep itab dispatch), so interface calls can locate implementations by method name. What gets hashed is unexported method names

4. **String table**:
   ```sh
   strings -n 6 sample | grep -E '^main\.|/.*\.go'   # function names and source paths
   strings sample | grep -E 'go1\.|module |\.go$'
   ```
   - pclntab holds function names and source paths, visible directly via `strings` — collect `main.` names first as a draft of the call graph
   - Source paths reveal project layout (for example `/home/user/c2/agent/main.go`)
   - In Ghidra, string cross-references (Ctrl+Shift+F) walk back to use sites (the [[re-binary-core]] R2 method)

5. **Understanding goroutines / the scheduler**:
   - The `go` keyword decompiles into a `runtime.newproc` call (which then calls `newproc1`). The address in its funcval argument is that goroutine's entry function
   - After a goroutine entry returns it goes through `runtime.goexit`; `runtime.gopark` / `runtime.gosched` / `runtime.schedule` are schedule and park points — do not treat them as the main flow
   - The `runtime.morestack` call in each function prologue is only a stack-growth check; ignore it (noise)
   - Dynamic (inside a sandbox): dlv is the friendliest debugger for Go — `go install github.com/go-delve/delve/cmd/dlv@latest`, then `dlv attach <pid>`, `goroutines` lists every goroutine, `goroutine <n> stack` shows a stack; strace from [[re-tracing]] observes concurrent syscalls

6. **Runtime structure notes (pclntab / goroutine stacks / buildinfo)**:
   - pclntab header (1.20+ layout): magic(4) + pad1 + pad2 + minLC + ptrSize + nfunc(8) + nfiles(8) + reserved(8) + funcnameOffset(8) + cuOffset(8) + filetabOffset(8) + pctabOffset(8) + pclnOffset(8); funcnameOffset points at the function-name string pool, pctab is the PC→line table — the 1.18/1.19 and 1.20+ pcHeader are both 72 bytes (debug/gosym ver118/ver120 share one parse branch; textStart is written with the real address via relocation, and from Go 1.26 on it is always 0 and no longer stored; from 1.20 symbol names gain a colon, `go.`→`go:`); the truly shorter header is ≤1.17 (ver116 has no textStart field); the Go118PCLnTabMagic change in 1.18 changed functab offsets (func data entries switched from addresses to offsets), and tools dispatch on magic
   - Goroutine stack: the first field of the g struct (runtime-private) is `stack{lo, hi}`, the stack range; `stackguard0` is the stack-growth check threshold — each function prologue's `runtime.morestack` checks it (the noise source); `sched.gobuf` saves sp/pc at park time; dlv's `goroutines` / `goroutine <n> stack` output comes from these fields, and the park point resumes in `runtime.gopark`
   - Manual buildinfo parse: `.go.buildinfo` embeds `\xff Go buildinf:` (14 bytes) + ptrSize(1) + endian marker(1), 16-byte aligned; when `go version -m` fails, extract version and module info by this magic (same source as go tool; a decode failure means it really is not there)
   - Platform differences: a Windows Go product is PE but section names and the symbol system are the same (`.gopclntab` / `.go.buildinfo` are both present). nm/GoReSym/redress on Linux can analyze a PE Go sample directly; the entry stub symbol follows the platform (Linux `_rt0_amd64_linux`, Windows `_rt0_amd64_windows`, macOS `_rt0_amd64_darwin`) and only jumps to runtime.main

## Cross-domain

- [[re-binary-core]]: this skill is referenced by the core gateway — initial survey [[re-triage]], formats [[re-format-elf]] / [[re-format-pe]], decompiler base [[re-ghidra]] / [[re-ida]], library fingerprints [[re-imports]]
- [[re-ghidra]] / [[re-ida]]: import Go symbol/type recovery products (GoReSym JSON, redress types) into the decompiler
- Dynamic side: [[re-gdb]] / [[re-tracing]] inside a sandbox; prefer dlv for debugging Go (goroutine-aware)
- Malware case: recover a Go malware sample (C2, loader) statically with this skill → hand behavior analysis to [[re-malware]]
- [[re-analyze/platform-tips]] related branches: static first (large samples), dynamic defaults to a sandbox, cross-platform Go samples (Windows PE Go on Linux follows the Wine branch)

## Common pitfalls

- **After strip, all symbols are gone and recovery is hard**: symptom — `nm` prints nothing, Ghidra functions are all `sub_*`, `main.main` is missing; cause — `-ldflags "-s -w"` or the release pipeline stripped symtab/DWARF (pclntab data is still there; nothing references it as a symbol); fix — GoReSym/redress recover function names and addresses from `.gopclntab` (if section lookup fails, scan for pclntab magic bytes) → import into Ghidra/IDA with `goresym_rename.py`; obfuscators such as garble mangle function names (pclntab structure remains, function bounds are still recoverable, but names are meaningless) → pair with GoResolver/GoStringUngarbler, and if needed fall back to strings plus dynamic behavior analysis
- **The binary is huge; the runtime is most of it**: symptom — Ghidra imports tens of thousands of functions, auto-analysis stalls, `runtime.*` drowns the target; cause — Go statically links the runtime (scheduler / GC / memory management) plus a morestack check per function, usually 1-2MB+; fix — after symbol recovery, filter first: `nm | grep ' main\.'`, `grep '^main\.'` on the GoReSym JSON, and shrink to user code; decompile only target functions on demand in Ghidra; follow platform-tips "static first (large samples)" — locate statically, then add dynamic work only as needed
- **Finding goroutine entries**: symptom — decompilation shows no linear main flow, only `runtime.gopark` / `schedule` scheduler calls; cause — user code runs as many goroutines (`go` keyword / spawned by `runtime.newproc`), there is no single main path, and order is decided by the scheduler; fix — read the funcval argument at each `runtime.newproc` call site to get the entry address; after the entry returns it goes through `runtime.goexit`; dynamically, use dlv (in a sandbox) `goroutines` to list them and inspect each goroutine stack
- **Escape analysis changes stack layout**: symptom — a local from source is not on the stack; it becomes `runtime.newobject` plus a heap pointer; cause — the Go compiler's escape analysis moves escaped objects to the heap (GC-managed), so the frame does not hold the expected locals; fix — do not hunt locals in the frame the C way; follow the heap pointer returned by newobject and its type (GoReSym `-t` / redress `types` recover type structure), and read object fields from the recovered type layout
- **buildinfo version fingerprints have a floor**: symptom — `go version -m` errors or prints nothing, so the Go version is unknown; cause — buildinfo (`.go.buildinfo`) is embedded by default only since Go 1.18; older or trimmed binaries do not have it; fix — `go tool buildid` is always available (gets the build ID); for older builds look at `runtime.buildVersion` via `strings | grep '^go1\.'`; `redress info` can also infer the compiler version from pclntab layout
- **Custom-struct serialized data (gob)**: symptom — a data section is a "byte stream" but decompilation shows `encoding/gob` decoding; cause — the author gob-encoded a custom struct (config / VM program / embedded object); in a `LoadProgram`-style function, `gob.NewDecoder` + `Decode` is the entry; fix — rebuild the struct from decompilation (field names and field count come from the type definition in the gob stream), **generate a same-struct sample in Go and compare bytes** (byte-by-byte compare the type-definition region; field names, types, and counts are obvious). When field names are damaged (missing bytes from the material or encoding), gob errors on an out-of-range field number; you can patch local gob sources for a lenient decode (skip the field-number check) and approach the data
- **LD_PRELOAD usually does nothing on a pure-Go syscall path**: symptom — hooking libc functions (execve/openat) does not intercept the Go program's calls; cause — a pure Go product (`CGO_ENABLED=0`) issues syscalls directly and does not go through libc symbols; there is no `PT_INTERP` and no dynamic section, so `LD_PRELOAD` has nothing to interpose; fix — first classify the product: `readelf -l/-d/-Ws` and `ldd` for `PT_INTERP`, `DT_NEEDED`, and cgo traces — pure Go uses strace/eBPF/ptrace (observe the real syscall or hook lower), and when cgo or dynamic ELF symbols exist `LD_PRELOAD` can still interpose normally (for example a cgo product with `DT_NEEDED libc.so.6`, where a hook can hit; see "cgo mixed products" below); you can also hook a **child process** — C programs such as bash/ls forked by Go's `exec.Command` still go through libc and can be intercepted by `LD_PRELOAD`
- **Replaying runtime behavior (fake server)**: symptom — Go malware logic is complex but needs network interaction (an IRC/HTTP server) to trigger; cause — the program is a client (beacon / C2 bot), and offline static analysis does not show the full behavior; fix — **replay against a fake server**: DNS hook (hijack getaddrinfo so the domain → 127.0.0.1) plus a fake IRC/HTTP server (replay the real interaction sequence extracted from a pcap) and let the program run the logic chain itself; watch handshake timing (wait until the bot finishes JOIN before sending) and message format (the bot checks messages by name/channel)
- **Garble-obfuscated Go binaries**: symptom — stripped + random function names + empty strings; cause — Garble obfuscates both function names and strings; fix — GoReSym recovers pclntab (function bounds are unaffected by name obfuscation) → GoResolver CFG signatures restore stdlib names → GoStringUngarbler batch-decrypts strings → find C2/keys in the decrypted strings
- **Locating Go crypto keys**: symptom — the AES key is not found; cause — the key is concatenated from several constants at runtime, and the common entry is an AES-GCM wrapper rather than a direct `aes.NewCipher`; fix — follow the key argument of `crypto/aes.NewCipher` back to the concatenation site; note that the argument of `crypto/cipher.NewGCM` (and `NewGCMWithNonceSize` / `NewGCMWithTagSize` / `NewGCMWithRandomNonce`) is a `cipher.Block`, **not the key**. If you land on these wrappers first, keep walking the `Block` back to `aes.NewCipher` and then take the key
- **Go interface calls are unreadable**: symptom — a decompiled interface call is an indirect jump; cause — Go interfaces dispatch through an itab; fix — locate the itab and annotate the interface type by hand
- **Symbols exist but signatures do not**: symptom — function names are present, parameters/types are not; cause — newer Go products do not carry full symbol info; fix — accept that names are usable and rebuild signatures from other evidence (config deserialization types / call sites)
- **String noise is high**: symptom — recovered strings are mixed with a mass of stdlib constants; cause — Go standard-library string constants; fix — filter by package, then screen for business strings
- **Source rebuild principle**: symptom — line-by-line recovery is unrealistic; cause — the product has no source correspondence; fix — rebuild readable code by package and keep the logic rather than line-for-line identity (logic first)
- **cgo mixed products; the C part has no Go names**: symptom — `nm` mixes bare symbols (`printf`, `pthread_*`) that do not match the `main.` / `runtime.` style; cause — cgo links C code / static libraries straight into the Go binary, and C symbols are outside the Go naming system; fix — split by naming style: the Go side (`main.` / package.) stays in this skill, bare C symbols go to [[re-binary-core]] ([[re-imports]] library fingerprints); cgo blocks are usually thin wrappers, and the main logic is still on the Go side
- **Static analysis of a Windows PE Go sample on Linux**: symptom — `file` reports PE, and after Ghidra import the entry is not `_rt0_amd64_linux`, so it looks like a Windows environment is required; cause — Go products share structure across platforms; only the container format (PE/Mach-O/ELF) differs; fix — keep using nm/GoReSym/redress (the symbol table and pclntab are platform-independent) and recognize the entry by platform (on Windows the PE entry points at the `_rt0_amd64_windows` stub); only the dynamic side needs Windows/Wine (the [[re-analyze/platform-tips]] branch)
- (Source: reverse-skill field-journal, MIT)
