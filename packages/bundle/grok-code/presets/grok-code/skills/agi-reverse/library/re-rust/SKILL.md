---
name: re-rust
description: Rust binary reversing: symbols, monomorphization, ownership patterns. Triggers: Rust, rust, `Rust二进制`, cargo
capabilities: [lang-runtime-analysis]
---

# Rust binary reversing (symbol decode / monomorphization / ownership)

## When to use / when not to use

- Use: after confirming the binary was compiled by Rust (symbols carry a `_ZN` / `_RNv` prefix), demangle and recover the symbols. Identify the duplicated code produced by generic instantiation (monomorphization). Understand object lifetime through ownership / destructor (drop) patterns. Analyze async/await state machines and library patterns such as tokio/serde
- Use: a malicious Rust sample (static recovery in [[re-malware]] — trojans and ransomware rewritten in Rust are increasing)
- Do not use: a non-Rust native program (C/C++/Go go straight to [[re-binary-core]]; Go uses [[re-go]])
- Do not use: a confirmed packer goes through [[re-anti-analysis]] first (a Rust binary is usually unpacked, but it is large)
- Note: dynamic steps default to the sandbox (the top rule in [[re-analyze/platform-tips]]). Static first (the large-sample principle)

## Tool setup

See [[re-analyze/platform-tips]] — decompilation and symbols are static steps and skip the sandbox. A Rust binary is usually 1-10MB or more, so static location comes first.

### The Rust toolchain (rustc/cargo — for installing symbol tools, optional)

- rustup is preferred (the official installer, the latest on every platform): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Debian/Ubuntu: `apt install rustc cargo` (the official package; the version may lag). Fedora: `dnf install rust cargo`. Arch: `pacman -S rust`
- macOS: `brew install rust`. Windows: `choco install rust` or rustup
- Check: `rustc --version && cargo --version`

### rustfilt (Rust symbol demangle; required for the new v0 `_RNv`)

- Debian/Ubuntu: `apt install rustfilt` (the official package)
- Other distros have no official package → the official install: `cargo install rustfilt`
- Check: `echo '_ZN3foo3barE' | rustfilt` prints `foo::bar`

### c++filt (can decode legacy `_ZN`; cannot decode v0)

- Linux: shipped with binutils (`apt install binutils` / `dnf install binutils` / `pacman -S binutils`)
- macOS: `brew install binutils` (the command is `g++filt`) or `brew install llvm` (`llvm-cxxfilt`)
- Windows: the Linux build inside WSL, or MinGW binutils
- Check: `c++filt _ZN3foo3barE` prints `foo::bar`

### Ghidra / IDA (the decompiler base; the install is in those skills)

- Ghidra 11+ has a built-in Rust demangler (the analysis option "Demangler Rust"; see [[re-ghidra]])
- IDA has none built in → a community Rust demangler plugin (for example idarustdemangler), or preprocess the symbol table with rustfilt
- Check: decompiler function names are readable (not `_ZN...` / `_RNv...` garbage)

### nm / readelf (the symbol table and sections, binutils)

- The install is the same as c++filt (shipped with binutils)
- Check: `nm --version`

### rustc --emit (understanding the compiler product, optional)

- `cargo rustc -- --emit=asm` / `--emit=llvm-ir` / `--emit=mir`: recompile the sample with a matching version and get assembly / IR / MIR with symbols, to compare how the compiler expanded it (monomorphized generic instances, an async state machine, drop-glue insertion points)
- `--emit=link` is the default product. `--emit=metadata` has no code but has type and dependency information
- Check: `rustc --emit=asm hello.rs` produces a `.s` file

### bloaty (size analysis, used by pitfall 2; the install is in the tool setup of [[re-go]])

- Purpose: `bloaty -d symbols sample` reports size share by symbol (the monomorphization expansion can be large)
- Check: `bloaty --version`

## Steps

Run in order and record evidence (path + sha256; see [[re-triage]]).

1. **Identify Rust**:
   ```sh
   file sample
   nm sample | head -20                  # 出现 _ZN...（legacy）或 _RNv...（v0）即 Rust
   strings sample | grep -iE 'rustc|rust_begin_unwind|panicking|__rust_alloc'
   ```
   - Signature symbols: `_ZN4core9panicking...E` (panic infrastructure), `_ZN3std2rt...E` (the std runtime), `__rust_alloc` / `__rust_dealloc` (the allocator that replaces malloc/free)
   - A std program's entry is `main`. no_std (embedded) uses `_start`
   - The `.comment` section fingerprint: `readelf -p .comment sample` prints `rustc version <version> (<commit>)` and the linker version directly (a measured 1.95 product contains `rustc version 1.95.0 (59807616e 2026-04-14)` and `Linker: LLD 22.1.2`) — look here for the version fingerprint first. It is faster than guessing the panic style
   - Panic text leaks a source path: the path after `strings sample | grep 'panicked at'` looks like `/rustc/<commit>/library/std/src/...`, and `<commit>` is the exact toolchain version. Business-code paths are in the same text

2. **Decode symbols (demangle)**:
   ```sh
   nm -C sample | grep main              # 内置 demangle（仅 legacy _ZN 可解）
   nm sample | rustfilt > symbols.txt    # 全量 demangle（v0/legacy 通吃）
   grep -iE 'main|tokio|serde' symbols.txt
   ```
   - The new v0 form (`_RNv`) can be decoded only by rustfilt / Ghidra 11+. c++filt prints it unchanged (pitfall 5)
   - Ghidra 11+ demangles automatically after import: the function tree is readable directly. Confirm symbols were kept: no output → pitfall 1
   - After v0 became the default, a product is still mixed naming: a measured 1.95 product is overwhelmingly v0 symbols (455 vs 30 legacy), but `main` and some internal std symbols (including `.llvm.` suffix instances) are still legacy `_ZN` — identification and a batch demangle must cover both prefixes

3. **Identify monomorphization**:
   ```sh
   grep -oE '::[a-z_]+<[^>]*>' symbols.txt | sort | uniq -c | sort -rn | head
   ```
   - The same generic name with several type parameters = several copies of the instance code (for example `Vec<u8>` and `Vec<i32>` each get a full expansion)
   - Analysis strategy: pick the representative instance of the most common type parameter, and between instances in the same group compare only the type-related branches. Skip the duplicated code (pitfall 2)

4. **Ownership / borrow patterns**:
   - drop: a call of `core::ptr::drop_in_place::<T>` is an object destructor site (vtable drop glue). Follow it to the struct's lifetime and fields
   - Allocation: `__rust_alloc` / `__rust_dealloc` correspond to malloc/free. `alloc::boxed::Box` (exclusive heap), `alloc::sync::Arc` (reference-count up and down), `alloc::vec::Vec` / `alloc::string::String` (a capacity change triggers realloc)
   - Calls of `core::mem::replace` / `take` / `swap` are common operations produced by the borrow checker
   - A large amount of memcpy plus a size argument in the decompilation → a struct copy / Clone (`derive(Clone)`)

5. **Common library patterns**:
   - tokio/async: `tokio::runtime::Runtime::block_on`, `tokio::task` / executor symbols. An async fn expands into a state machine (pitfall 4)
   - serde: `serde::de::` / `serde::ser::` and a `deserialize` symbol — the config / protocol parse entry. Follow it to the data format
   - Network: `std::net::TcpStream`, `tokio::net::`. Logging / config: `log::` / `tracing::`, `serde_json`
   - Error text / URLs / config strings in strings help locate the target logic

## Cross-domain handoff

- [[re-binary-core]]: this skill is cited by the core gateway — the first look is [[re-triage]], the decompiler base is [[re-ghidra]] / [[re-ida]], and library fingerprints are [[re-imports]]
- [[re-ghidra]]: prefer the built-in Rust demangler on 11+. [[re-ida]]: a Rust demangler plugin, or preprocess with rustfilt
- [[re-emulation]]: a no_std / embedded Rust firmware with no runtime can be helped by emulated execution
- A malicious case: a Rust malware sample (rewritten ransomware / trojans are common) is static under this skill → behavior analysis switches to [[re-malware]]
- Related branches of [[re-analyze/platform-tips]]: static first (a large sample), dynamic defaults to the sandbox, and the Wine/QEMU branch for a cross-platform sample

## Pitfalls

- **Symbols were stripped, and recovery is extremely hard**: symptom — `nm` prints nothing, and every function is `sub_*`; cause — the release profile set `strip = true`, or the release process stripped (Rust has no recovery structure like Go's pclntab); fix — confirm first whether `nm` is really empty (most release builds keep symbols by default; check step 2). After a strip, use strings to find panic text / error messages (they contain file paths and type clues). FDEs in `.eh_frame` / `.gcc_except_table` can recover function boundaries (turn on unwind parsing in the Ghidra analysis options)
- **Monomorphization produces a large amount of duplicated code**: symptom — the same logical function appears dozens or hundreds of times, differing only by type, and the function list explodes; cause — a generic is instantiated for every type parameter, and each instance is a full copy of the code (the size also explodes); fix — after demangle, group and count by generic name, analyze one representative instance, and between members of the group diff only the type-related branches. Confirm the size / duplication problem with bloaty (`bloaty -d symbols`). Ignore the other instances during analysis
- **Panic paths are interleaved with the normal path**: symptom — in the decompilation every index / `unwrap` / assertion carries a branch and a panic call, and readability is drowned; cause — Rust inserts `panic_bounds_check` / `core::panicking::panic` checks at an out-of-bounds index, `unwrap()`, and `assert!` (a release build still keeps the index check), plus `unreachable!` dead paths; fix — identify and skip calls and exception branches related to `core::panicking::` / `std::panicking::` / `panic_impl`. Panic text is visible in strings and can be used backwards to locate the call site
- **An async/await state machine is expanded**: symptom — one async fn becomes a struct plus a huge `match` state loop, function names carry `{{closure}}` / `{{opaque}}`, and there is no linear flow; cause — an async fn compiles to a Future state machine. Each await point is a state and a save point, and poll transfers by state; fix — follow the transfer logic by state number (0..N), and read the poll method hard. Identify calls of `core::future` / `std::future::poll_with_tls_context`. A tokio program finds `tokio::runtime` symbols and `block_on` to locate the entry
- **c++filt cannot decode the new v0 mangling**: symptom — `c++filt` / `nm -C` print `_RNv...` unchanged, and the symbol is still garbage; cause — v0 mangling has been optional since 1.37 (`-C symbol-mangling-version=v0`), and it became the default at the end of 2025 (during 2019-2025 the vast majority of binaries were still legacy `_ZN`, which `nm -C` can decode); fix — use rustfilt uniformly (the official Debian/Ubuntu package `apt install rustfilt`; otherwise `cargo install rustfilt`) and batch `nm sample | rustfilt`. The built-in demangler in Ghidra 11+ decodes automatically
- **The panic strategy decides the product shape (unwind vs abort)**: symptom — some products have no `rust_begin_unwind` symbol, `.eh_frame` is tiny or missing, and in the decompilation a `core::panicking` call site is a termination path directly, so the whole program exits during behavior analysis; cause — `-C panic=abort` (common in an embedded / size-sensitive / hardened build) removes the unwind tables and the recovery path. The default `panic=unwind` is what keeps them; fix — `readelf -S` for whether `.eh_frame` exists, plus `nm` for `rust_begin_unwind` / `rust_panic`, decides the strategy. An abort product does not need a recovery path after panic; panic is termination. Panic text (`panicked at`) is present under both strategies
- **A no_std product has no std runtime symbols**: symptom — `_ZN3std2rt...E` is not found, and `__rust_alloc` is sometimes absent too; cause — no_std (embedded / a kernel) does not link std, only core plus a custom allocator; fix — identification switches to core features (`_ZN4core...`) plus the `.comment` version fingerprint. The entry is `_start`, not `main`. Confirm the allocator symbol (`__rust_alloc` or a custom `malloc`) as needed. This kind of firmware is often paired with [[re-emulation]] for an environment-free simulation
