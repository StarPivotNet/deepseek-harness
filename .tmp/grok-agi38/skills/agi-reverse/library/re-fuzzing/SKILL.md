---
name: re-fuzzing
description: >
  Coverage-guided fuzzing: AFL++/libFuzzer/honggfuzz, instrumentation and corpus initialization,
  afl-fuzz run parameters, coverage (afl-cov), dictionaries/structured input.
  Triggers: fuzz, `模糊测试`, AFL, afl-fuzz, libFuzzer, honggfuzz,
  `覆盖率`, corpus, `语料`, dictionary, `挖洞`, fuzzing.
capabilities: [fuzzing]
---

# Coverage-guided fuzzing (AFL++ / libFuzzer / honggfuzz)

## When to use / when not to use

- Use: the target has a clear input surface (file parse / library function / network-protocol parse) and you want to find crashes automatically; source is available to instrument (or there is no source and you are willing to use QEMU mode); you need continuous regression to find new bugs
- Do not use: the target has no input parse (pure algorithm/pure logic → symbolic execution [[re-angr]] / [[re-z3]]); you already have a crash and only need to analyze it (→ [[re-crash-triage]]); the target is a kernel/driver (follow the [[re-kernel]] domain; it is outside userspace fuzz scope)
- Do not use: you only have one crash sample to reproduce (go straight to [[re-crash-triage]]; no need to rerun fuzz)

## Tool setup

Verify every tool before use. Fuzzing is dynamic execution and always runs inside a sandbox ([[re-analyze/platform-tips]] highest principle; see [[re-sandbox]]).

### AFL++ — main coverage-guided fuzzer

- Debian/Ubuntu: `sudo apt install afl++`
- Fedora: `sudo dnf install american-fuzzy-lop american-fuzzy-lop-clang` (the package is the AFL++ fork); or build from source for the latest (see below)
- Arch: `sudo pacman -S afl++`
- macOS: `brew install afl++`
- Windows: inside WSL2, `sudo apt install afl++` (AFL++ officially supports WSL; it cannot run directly on native Windows)
- Source build (recommended; newest version, all modes included):
   ```sh
   git clone https://github.com/AFLplusplus/AFLplusplus && cd AFLplusplus
   make distrib        # 需要 clang/LLVM 工具链
   sudo make install
   ```
- Verify: `afl-fuzz -h` (printing usage is OK); `afl-clang-fast --version`

### clang / LLVM — libFuzzer host + ASAN compiler

- Debian/Ubuntu: `sudo apt install clang`
- Fedora/RHEL: `sudo dnf install clang`
- Arch: `sudo pacman -S clang`
- macOS: shipped with Xcode (`xcode-select --install` adds the command-line tools), or `brew install llvm`
- Windows: the Linux build inside WSL2; native Visual Studio clang-cl also works (MSVC supports `/fsanitize=fuzzer`)
- Verify: `clang --version`

### libFuzzer — library-function / single-function fuzz (ships with clang)

- No separate install: clang includes it; `-fsanitize=fuzzer` enables it
- Verify:
   ```sh
   clang -fsanitize=fuzzer -x c /dev/null -o /tmp/fztest && /tmp/fztest -runs=1
   ```
   Output containing `INFO: libFuzzer` is OK (`/tmp/fztest` can be deleted after use)

### honggfuzz — hardware-counter / multi-thread fuzz alternative

- Debian/Ubuntu: no official package → build from source:
   ```sh
   sudo apt install build-essential binutils-dev libunwind-dev libblocksruntime-dev clang
   git clone https://github.com/google/honggfuzz && cd honggfuzz && make
   ```
- Fedora/RHEL: `sudo dnf install honggfuzz`
- Arch: `sudo pacman -S honggfuzz` (or the AUR package `honggfuzz`)
- macOS: no brew formula → build from source (needs Xcode + libblocksruntime)
- Windows: the Linux build inside WSL2
- Verify: `honggfuzz --help`

### afl-cov — coverage stats (gcov/lcov frontend)

- Depends on lcov/gcov: `sudo apt install lcov` / `sudo dnf install lcov` / `sudo pacman -S lcov` (gcov ships with gcc)
- The tool itself has no pip package; git clone and run directly:
   ```sh
   git clone https://github.com/mrash/afl-cov && cd afl-cov
   ```
- Verify: `./afl-cov -V`
- Note: afl-cov needs the target compiled with gcov instrumentation (`gcc -fprofile-arcs -ftest-coverage`), which is incompatible with AFL instrumentation — **compile the same code twice**: one afl+ASAN build to fuzz, one gcov build to measure coverage

## Procedure

Run in order; record the path of each step's products (harness source, corpus directory, fuzz output directory) for [[re-crash-triage]] / the report.

1. **Target and instrumentation choice**:
   - Source can be compiled → AFL++ compiler wrapper + ASAN:
      ```sh
      CC=afl-clang-fast CXX=afl-clang-fast++ AFL_USE_ASAN=1 ./configure && make
      # 简单单文件目标：
      afl-clang-fast -fsanitize=address -g -O1 -o target target.c
      ```
   - No source → `-Q` QEMU mode (`afl-fuzz -Q ...`); no instrumentation, but 2-5x slower
   - The target is a library function → write a fuzz target (harness) that reads a file and feeds the parse API:
      ```c
      /* fuzz_target.c —— 以 libpng 的 png_read 入口为例 */
      #include <stdint.h>
      extern int my_parse(const char *data, size_t len); /* 目标解析入口 */
      int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
        my_parse((const char *)data, size);
        return 0;
      }
      ```
      libFuzzer compile: `clang -fsanitize=fuzzer,address -g -O1 -o fuzz_target fuzz_target.c target_lib.c`
      AFL++ compiles the same harness: `afl-clang-fast -fsanitize=fuzzer,address -o fuzz_target_afl fuzz_target.c` (afl-clang-fast intercepts `-fsanitize=fuzzer` and links its own driver); run `afl-fuzz -i in -o out -- ./fuzz_target_afl @@`
   - Network target → see pitfall 5: the harness calls the parse function directly (data comes from a file); do not fuzz the whole service process
2. **Corpus initialization**:
    ```sh
    mkdir in out
    # 每个种子是目标可正常解析的最小有效输入（别拿空文件起步）
    cp seed_sample.bin in/
    afl-cmin -i in -o in_min -- ./target @@   # 去重：只留覆盖不同路径的种子
    ```
   - Corpus quality matters more than quantity: 10 small samples that cover different parse branches > 1000 large files of the same kind (see pitfall 2)
   - Starting from an empty corpus / pure empty files: the first few thousand execs all sit on the EOF branch, and parse logic is not covered for a long time
3. **afl-fuzz run parameters**:
    ```sh
    afl-fuzz -i in_min -o out -m none -t 1000+ -x dict.txt -- ./target @@
    ```
   - `-m none`: an ASAN program's default memory limit false-kills; this is required (see pitfall 4)
   - `-t 1000+`: give the initial timeout enough room (`+` means it adapts as paths grow)
   - `@@` placeholder = the file path the fuzzer generated; if input comes from stdin, drop `@@`
   - Multi-core multi-instance: `-M main` primary + `-S secondary1` and other secondaries (share one out directory); `afl-whatsup out` shows the summary
   - Resume: `afl-fuzz -i - -o out ...` (`-i -` reuses the existing output directory)
   - Runtime: 24h+ before the stats mean anything; do not stop early; after a crash appears, do not interrupt — open a separate analysis ([[re-crash-triage]] can use `afl-tmin` on out/crashes)
4. **Coverage (afl-cov)**:
   - Watch live while running: `afl-whatsup out` — `paths_total` growing + high `execs_done` = normal
   - gcov-build target (compiled separately from the fuzz build):
      ```sh
      gcc -fprofile-arcs -ftest-coverage -g -O0 -o target_gcov target.c
      ```
   - Summarize:
      ```sh
      ./afl-cov -d out --live --coverage-cmd "cat AFL_FILE | ./target_gcov" --code-dir .
      ```
      Products land in `out/cov/`; the HTML report is `out/cov/web/` (generated by lcov/genhtml)
   - Alternative without gcov: `afl-showmap -o /tmp/map -- ./target @@` shows which blocks one input covers; compare maps of two inputs to judge whether a new path was covered
5. **Dictionary / structured input**:
   - Dictionary `-x dict.txt`: keywords (magic, separators, keywords) lower the cost of cross-format mutation; AFL++ ships many format dictionaries (`AFLplusplus/dictionaries/` includes png/pdf/jpeg/tiff and similar; reference them directly with `-x`)
   - Structured input (header+length+data formats): the initial seeds must cover different structural variants; put common values for the length field in the dictionary; advanced use is a custom mutator (AFL++ `AFL_CUSTOM_MUTATOR_LIBRARY`; Python examples are in `utils/python_mutators/`) that keeps checksum/length consistent

## Cross-domain joins

- [[re-vuln]]: gateway workflow step 2 always calls this skill (the coverage base atom of the vulnerability-discovery domain)
- [[re-crash-triage]]: crash inputs this skill produces (`out/crashes/`) are handed to it for analysis; minimize/dedupe (cmin/tmin) is done inside its flow
- [[re-ctf]]: CTF pwn / challenge-binary fuzzing cites this skill
- [[re-binary-core]]: before writing a harness, use decompilation to confirm the parse entry and API semantics ([[re-ghidra]] / [[re-ida]])
- [[re-netcap]]: seed-corpus source for fuzzing a network target (real traffic captures)
- [[re-sandbox]] / [[re-analyze/platform-tips]]: fuzzing is dynamic execution and defaults to running inside a sandbox

## Common pitfalls

- **No instrumentation, no coverage**: Symptom — `afl-fuzz` runs and execs explode but the path count does not move, and no crash ever appears; cause — the target was not instrumented (a release binary / the compiler is not an afl-* wrapper / a wrong `@@` argument fuzzed an unrelated program); fix — before starting, `afl-showmap -o /tmp/map -- ./target @@` to verify coverage changes; `afl-fuzz` startup output warns about missing instrumentation; with no source, switch to `-Q` QEMU mode
- **Corpus size imbalance**: Symptom — startup is slow, exec rate per round is low, or early runs never cover parse logic at all; cause — too many seeds that are too large (queue bloat), or they are all empty files / the same format variant; fix — `afl-cmin` down to a few dozen minimal samples that cover different branches; keep one representative of each format variant
- **Crash dedupe (cmin/tmin)**: Symptom — `out/crashes/` piles up tens of thousands of files that are actually the same bug; cause — the fuzzer saves every triggering input and does not distinguish by crash site; fix — minimize one by one with `afl-tmin` (`afl-tmin -i crash -o crash.min -- ./target @@`), then merge same-class items by ASAN error type + backtrace (see [[re-crash-triage]])
- **Wrong sanitizer configuration**: Symptom — a real crash is not reported (miss) or the fuzz process is false-killed (false crash); cause — ASAN was not enabled (missed `AFL_USE_ASAN=1` / `-fsanitize=address`), `-m none` was not set so the ASAN memory limit killed it, or ASAN conflicts with an old glibc; fix — standardize on `AFL_USE_ASAN=1` + `-m none`; give `-t` enough room; first manually run a known crash input and confirm ASAN reports it
- **A network target needs a harness**: Symptom — fuzzing a network-service binary, input comes from a socket, the `@@` file never reaches the parse logic, and coverage stays 0; cause — a network program reads an fd, not a file, so the fuzz channel is misaligned; fix — write a harness that feeds file contents directly to the parse function (fuzz the parser, not the network stack); use [[re-netcap]] captures of real traffic as seeds
