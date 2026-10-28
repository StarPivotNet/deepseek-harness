---
name: re-hybrid-app
description: >
  Flutter/React Native hybrid-app reversing.
  Triggers: Flutter, React Native, `混合应用`, dart, libapp.so, Hermes, `Hermes 字节码`, hbc, RN bundle, index.android.bundle, NativeModules, TurboModule, Metro
capabilities: [hybrid-app-analysis]
---

# Hybrid-app reversing (Flutter / React Native)

## When to use / when not to use

- Use: inside the app you find libflutter.so / libapp.so (Flutter) or assets/index.android.bundle (React Native)
- Use: you need to recover the hybrid framework's business logic (a dart snapshot / a JS bundle)
- Use: you need to locate sensitive data exchanged on the JS↔native bridge (MethodChannel / NativeModules)
- Do not use: a pure Java/Kotlin native app (go to [[re-apk]])
- Do not use: pure native so logic (go to [[re-binary-core]])
- Do not use: you need a runtime hook — locate it statically first, then [[re-frida]]

## Tool setup

Static analysis may skip the sandbox (top principle in [[re-analyze/platform-tips]]); dynamic work (a reFlutter repack / running) is inside a controlled device / emulator snapshot. Verify every tool before use.

### Engine identification — jadx / unzip (reused from [[re-apk]])

- `unzip -l app.apk` looking at the assets/ and lib/ layout is enough to judge the engine. Cross-OS install is in the [[re-apk]] tool setup

### blutter — static recovery of a Flutter AOT snapshot (libapp.so)

- Install: `git clone https://github.com/worawit/blutter && cd blutter` — a C++20 project. It needs a fairly new compiler (g++>=13 / Clang>=16) + cmake/ninja/pkg-config/libicu/libcapstone + pyelftools/requests
  - Debian/Ubuntu: `apt install python3-pyelftools python3-requests git cmake ninja-build build-essential pkg-config libicu-dev libcapstone-dev`
  - Fedora: `dnf install gcc-c++ clang cmake ninja-build pkgconf-pkg-config libicu-devel capstone-devel python3-pyelftools python3-requests git`
  - Arch: `pacman -S gcc cmake ninja pkgconf icu capstone python-pyelftools python-requests git`
  - macOS: `brew install cmake ninja pkg-config icu4c capstone` + `pip3 install pyelftools requests`
- Usage: `python3 blutter.py libapp.so <output directory>` (auto-detects the Dart version, and when needed auto-downloads Dart sources and compiles the engine) — currently supports Android arm64 libapp.so and newer Dart versions
- Products: `asm/` (symbolized disassembly), `objs.txt` (a full dump of object-pool objects), `pp.txt` (every Dart object in the object pool), `blutter_frida.js` (a Frida script template)
- Verify: the output directory contains `pp.txt` and it contains the target app's class names

### reFlutter — Flutter dynamic (repack + traffic intercept)

- Install: `pip3 install reflutter` (Python 3, depends on frida-tools)
- Usage: `reflutter main.apk` → enter the Burp proxy IP → produces `release.RE.apk` → re-sign with uber-apk-signer (`java -jar uber-apk-signer.jar --allowResign -a release.RE.apk`) → install and run
- Product: after running, `adb -d shell "cat /data/data/<package>/dump.dart" > dump.dart` (class/function list + code offsets)
- Verify: `reflutter -h` prints version and usage; after the repack it can be installed and run and produces dump.dart
- Note: Flutter >= 3.24 needs the proxy set on the device by hand (`adb shell settings put global http_proxy <ip:port>`)

### dart toolchain (understanding snapshot structure, optional)

- Arch: `pacman -S dart` (the extra official repo)
- Debian/Ubuntu / Fedora: the official repos have no dart package → use the one bundled with the Flutter SDK (`snap install flutter` or the official SDK)
- macOS: `brew install dart` (or `brew install --cask flutter`); Windows: the Flutter SDK zip
- Verify: `dart --version`

### RN bundle recovery — hermes-dec (Hermes bytecode)

- Install: `pip3 install hermes-dec` (Python 3, pure standard library); Ubuntu also has `snap install hermes-dec` (the snap build's commands carry a `hermes-dec.` prefix, such as `hermes-dec.hbc-disassembler`; the pip build has no prefix); Arch AUR `yay -S hermes-dec`
- Commands: `hbc-file-parser` (parse the HBC header / version / function table), `hbc-disassembler` (bytecode → .hasm assembly), `hbc-decompiler` (→ pseudo-JS)
- Verify: `hbc-decompiler --help` works; a sample file can run all three steps
- Beautify a plaintext JS bundle: `pip install jsbeautifier` (Python 3, `js-beautify bundle.js`)

## Procedure

Run in order. Archive each step's products (so / bundle / hasm / decompiler output + sha256).

1. **Identify the engine**:
   ```sh
   unzip -l app.apk | grep -E 'libapp|libflutter|assets/|bundle'
   file lib/arm64-v8a/libapp.so
   file assets/index.android.bundle    # Hermes: "Hermes JavaScript bytecode, version XX"
   ```
   - Flutter: `lib/<abi>/libapp.so` (AOT snapshot) + `libflutter.so` (engine) + `assets/flutter_assets/`
   - RN: `assets/index.android.bundle` (plaintext JS or Hermes HBC); RN 0.70+ defaults to Hermes
   - Other: a WebView shell (assets/*.html) / Cordova / uni-app — handle it on the webview path
   - The identification conclusion decides the branch: Flutter → step 2; RN → step 3

2. **Flutter: libapp.so snapshot analysis (blutter)**:
   ```sh
   python3 blutter.py lib/arm64-v8a/libapp.so ./flutter_out
   grep -r "<target class name>" ./flutter_out/pp.txt             # class/function names are in the snapshot string table
   grep -rn "https://\|api\|token\|secret" ./flutter_out/asm/ | head
   ```
   - blutter products give Dart classes/functions and the object-pool structure — follow business logic by class name (a release AOT keeps dart-layer names; see pitfall 1)
   - Dynamic extra: a reFlutter repack → dump.dart gets runtime classes/functions and offsets → `frida -U -f <package> -l frida.js` together with `_kDartIsolateSnapshotInstructions` (`readelf -Ws libapp.so`) locates hook points

3. **RN: extract and recover bundle.js**:
   ```sh
   # plaintext JS
   unzip -p app.apk assets/index.android.bundle > bundle.js
   js-beautify bundle.js > bundle.pretty.js
   # Hermes bytecode
   hbc-file-parser index.android.bundle > meta.txt
   hbc-disassembler index.android.bundle out.hasm
   hbc-decompiler index.android.bundle out.js
   # clue extraction
   grep -aoE 'https?://[^"'"'"' ]+' out.js | sort -u     # endpoints, halfway
   grep -aoE '"[A-Za-z0-9_/+=]{16,}"' out.js | sort -u   # suspected keys / base64
   ```
   - At the hasm level, look at function call relationships (`LoadConstString` paired with `CallN`); when pseudo-JS loops/conditions are incomplete, trust hasm + the string table (see pitfall 2)

4. **The native part goes through [[re-binary-core]]**:
   - `libflutter.so` / `libapp.so` (ELF) → parse with [[re-format-elf]] → [[re-ghidra]] decompiles engine-layer C++ (dart:: VM, channel registration, Skia) and the JNI bridge (FlutterEngine / PlatformChannel)
   - RN: `libhermes.so` (the engine, optional), the JNI bridge (the `com.facebook.react` package) → native-module logic
   - Anti-debug / crypto / certificate checks are often in this layer (for example the BoringSSL verify function in libflutter.so) — hook points are in step 2

5. **Locate logic (the bridge boundary)**:
   - Flutter: a global grep of MethodChannel channel names (a `flutter_` prefix is common); the PlatformChannel send/receive site is where sensitive data (token / config) is exchanged
   - RN: the NativeModules registry and `requireNativeComponent` / `NativeModules.xxx` — crypto that cannot be found on the JS side is in a native module (go to step 4)
   - Walk backward from UI copy / network strings: the string table (Flutter snapshot / JS bundle) → the matching function → the logic

## Dynamic interception of Flutter MethodChannel

The Flutter platform channel (PlatformChannel) is the trunk of Dart ↔ native communication. Intercepting it observes every native-capability call:

- **Java/Kotlin side**: hook the MethodCallHandler of `io.flutter.plugin.common.MethodChannel` — record the channel name / method name / argument JSON
- **Getting the channel name**: hook `MethodChannel.setMethodCallHandler` (onEnter captures the channel instance, including the name) or take the channel name directly from the `MethodChannel` constructor; lower down, hook `BinaryMessenger.send` (the first argument is the channel name)
- **The engine messenger layer**: messenger messages of `io.flutter.embedding.engine.FlutterEngine` (a low-level fallback)
- **Complements static observation on the Dart side**: statically find channel names and call sites (string literals), and dynamically confirm the actual traffic
- **Output**: structured JSON (channel / method / args), consumed by the [[re-analyze/analysis-contract]] data contract (evidence archive)

The Flutter specialty is in [[re-flutter]]

## React Native / Hermes (RN bytecode and the bridge)

### Identification: HBC and RN products

- **`.hbc` / Hermes bytecode**: a 4-byte file-header magic of the `c61fbc03` class (little-endian). `file` output looks like "Hermes JavaScript bytecode, version XX"; no magic, and a start such as `var __BUNDLE_START_TIME__` in JS source, means a plaintext bundle
- **RN app layout**: `assets/index.android.bundle` (business JS / HBC packed by Metro; RN 0.70+ compiles with Hermes by default), `lib/<abi>/libhermes.so` (the Hermes engine), `libreactnativejni.so` (the JNI bridge)
- **How Hermes differs from a standard JS engine**: Hermes is AOT precompiled bytecode (VM instructions; no JIT compile at runtime). A standard engine (JSC / V8 class) product is a plaintext JS source pack. The two decide whether what follows is bytecode disassembly or pure JS recovery

### Hermes bytecode: the disassembly idea

- **Structure**: file header (magic + version) → bytecode segment → function table / string table; the version is in the file header and directly decides tool compatibility
- **Disassembly**: a hermesc-class tool (the `-dump-bytecode` family) or an hbc-disassembly-class Python implementation (see "Tool setup") → produces hasm assembly; the string table can be extracted as a whole (grab printable strings across segments) to get clues first
- **Function-table features**: each function has an id / offset / instruction count / parameter count — follow the business entry by call relationships (LoadConstString paired with CallN)

### JS bundle extraction: Metro structure and recovery

- **Metro pack structure**: a module factory is registered into the global registry through `__d(factory, moduleId, deps)`, and `__r(moduleId)` is the runtime require; the top of the bundle has `__BUNDLE_START_TIME__` and a polyfill prefix
- **Recovering business JS**: beautify (a jsbeautify-class tool) → split module boundaries on `__d(` → restore each module independently (factory body + dependency array) → obfuscation / string encryption hands off to [[re-script-deob]]
- **Module correspondence**: a large module (long strings / many dependencies) is often the business main pack. Compare it with page function to shrink the scope

### Native bridge: NativeModules / TurboModule

- **JS-side location**: `NativeModules.xxx` access points / `TurboModuleRegistry.get('Xxx')` — the bridge name is the module name
- **Native-side mapping**: the module registry under the JNI bridge `com.facebook.react` package (`@ReactMethod` annotated class methods / the `getNativeModules()` list); TurboModule interface method signatures correspond one to one with JS call names
- **The bridge boundary is where sensitive data is exchanged**: crypto that cannot be found on the JS side is in a native module (go to [[re-binary-core]]), the same idea as Flutter MethodChannel

### Dynamic: hook the JS runtime ([[re-frida]])

- **Module load points**: hooking `__d` / `__r` can enumerate every loaded module and id, and dump the module-factory source; a module registered again at runtime is a remotely delivered (hot-update) feature
- **console output**: hook the console.log / warn implementation and take business logs and error stacks
- **Bridge-layer fallback**: hook NativeModules method calls (arguments / return value) and observe data exchanged between JS and native

### Pitfalls

- **Hermes bytecode is not cross-version**: symptom — the same sample disassembles normally in one environment, and after a version or tool change the output is garbage or it errors immediately; cause — the HBC format evolves with the engine version and does not guarantee backward compatibility, and disassembly-class tools cover only a specific version range; fix — take the version first (`file` output / the version string inside libhermes.so / build time), pick a hermesc-class tool for that version or update the disassembler. When the version does not match, switch tools first rather than hand-fixing bytes
- **Bundle encryption / obfuscation (a Metro encryption layer)**: symptom — after the bundle is unpacked it is ciphertext / garbage, or module function names are unreadable; cause — the build pipeline encrypts at the Metro output layer (a decryptor embedded in the bundle, decrypted at runtime) or an obfuscation plugin is enabled; fix — look inside the bundle for decryptor features (an XOR loop / a self-decrypt function / a hardcoded key), recover the decryptor statically and decrypt the whole thing, or [[re-frida]] dumps plaintext at the decrypt function's return. The obfuscated part hands off to [[re-script-deob]]
- **Bytecode mixed with plaintext JS (some pages use a remote bundle)**: symptom — the local bundle is plaintext JS and the content looks normal, but key page logic is missing, or a module that is not local appears at runtime; cause — mixed delivery: some pages are packed into assets, and sensitive / update pages are a remotely delivered bundle (hot update, staged rollout). The local pack only contains the shell and load logic; fix — check local-bundle completeness first (the `__d` module count compared with page function), capture / a filesystem snapshot archives the remote bundle, then handle it on the plaintext or HBC path

## Cross-domain

- [[re-mobile]]: the hybrid-app branch always calls this skill (after engine identification, split by framework)
- [[re-apk]] / [[re-ios]]: container-side static (manifest, signature, the iOS equivalent)
- [[re-binary-core]]: the native part — [[re-format-elf]] + [[re-ghidra]] decompile libapp.so / libflutter.so and the RN JNI bridge
- [[re-frida]]: runtime hooks (the bridge layer, certificate checks, anti-detection)
- [[re-analyze/platform-tips]]: default sandbox, a tool parse ≠ the loader's view (snapshot offsets / tool-version differences)
- This skill is referenced by the "mobile app analysis" path in [[re-analyze]] triage (re-mobile → re-hybrid-app)

## Common pitfalls

- **A Flutter AOT snapshot has no source-level symbols**: symptom — looking at libapp.so directly in IDA/Ghidra only shows dart:: internal functions and bare offsets, and business function names are invisible; cause — an AOT snapshot has no DWARF symbols, but Dart class/function names are actually kept in the snapshot string table; fix — blutter recovery (pp.txt / asm/). Grep the string table to locate class names and then analyze against asm. Do not look for business symbols in the ELF symbol table
- **RN Hermes bytecode is hard to recover**: symptom — the pseudo-JS from hbc-decompiler is missing every loop/condition, variable names are register numbers, and the logic does not read; cause — HBC is VM instructions, and decompilation to source level is incomplete; fix — look at call relationships in hbc-disassembler's hasm (LoadConstString + CallN locates string use sites), walk semantics back from the string table / plaintext inside the bundle (URLs, error prompts), and when needed capture plaintext traffic dynamically and compare
- **Engine version differences**: symptom — blutter reports that Dart version is unsupported / hermes-dec fails to parse or is shifted; cause — the tool only supports a specific version range, and the app uses a new engine (a new Dart 3.x snapshot format, a new Hermes bytecode version); fix — take the version first (the version string inside libflutter.so / `file` output HBC version / build time), update the tool (blutter downloads the matching Dart sources and rebuilds on demand) or switch to a specialty tool that supports that version
- **The JS and native bridge boundary**: symptom — crypto and key logic cannot be found in the JS/bundle; cause — the sensitive logic is in a native module (the RN NativeModules / Flutter MethodChannel native side); fix — find the bridge registration per step 5 (channel name / native module table) → go to [[re-binary-core]] and analyze the matching so. Do not keep forcing it at the JS layer
- **An obfuscated build**: symptom — function names are all a/b/c or hashes; cause — a Flutter `--obfuscate` / RN Hermes + obfuscation-option build; fix — drive from strings that are still usable (error copy / API paths) and behavior observation, and locate the bridge layer with a dynamic [[re-frida]] hook
- **A Flutter SSL check and the traffic cannot be captured**: symptom — the capture tool does not see Flutter app traffic or reports a certificate error; cause — Flutter ships its own SSL check (it does not follow the system proxy / certificate trust chain). A general-purpose bypass has open-source code on github; fix — use a general Flutter SSL-check bypass or a frida bypass to capture first; after blutter recovery, libapp.so symbols are visible, and the target function can be hooked directly by address (for example the arguments/return of a signing function generateMD5, to take the salt and the plaintext) — a full algorithm recovery is not required
- **Dart string memory layout (the key to reading a string with frida)**: symptom — hooking a libapp.so function gets a pointer but the string cannot be read; cause — a Dart string is not a C string: **at pointer +7, 4 bytes are an Smi-encoded length (shift right 1 for the real length), and at +15 is the UTF-8 data**; fix — write a readDartStringExact helper for this layout (add a length cap so a misread cannot run away). Hooking arguments/return values can both restore plaintext
- **The Hermes function-table header is a packed bitfield, not a struct**: symptom — reading the function table as an ordinary struct scrambles function bounds/names/parameter counts, or a large-header offset of an overflowed function is read as an ordinary field; cause — the HBC function header packs 10 fields into a single 128-bit word (legacy 16 bytes, version <97) or a 96-bit word (modern 12 bytes, version >=97, the RN 0.75+ default shape), and bit widths differ by version; fix — take the version first and then pick the bitfield map; flag bits can assist semantic inference (bit0 strict, bit3 hasExceptionHandler, bit5 overflowed). When overflowed is set, the inline header fields cannot be trusted. Assemble from the large header instead (legacy is (info_offset<<16)|offset, modern is (function_name<<24)|(offset&0xffffff)); function bounds = the in-header offset + bytecode_size, and the global code is function 0 (source: hermes-decomp (SymbioticSec), MIT)
- **The Hermes small string table: a u32 bitfield + a sentinel overflow table + run encoding + packed shared storage**: symptom — string lengths/contents are shifted, and an xref walks back to the wrong function; cause — each item is one u32: bit0 is the UTF-16 marker, bits1-23 store the storage offset, bits24-31 store the length (255 max). When the length or offset hits a sentinel (0xff / 0x800000), the real value is filled from the overflow table as an (offset,length) pair; the string-kind table is run-length encoded (the high bit 0=ordinary String, 1=Identifier, and the low 31 bits are the count of that consecutive kind); fix — parse by bitfield and follow the overflow table. Locate every entry by the table-item offset. Never substring-search (several entries may share one packed storage span). The write-back path is the same. Expanding by run distinguishes code strings from identifiers (identifiers are used for property-access resolution and naming hints) (source: hermes-decomp (SymbioticSec), MIT)
- **Opcode definitions drift by version, and builtin indexes change only at a release boundary**: symptom — the same bytecode is shifted after a disassembler/decompiler or version change, or it crashes on an unknown opcode; cause — each HBC version has its own instruction table (40-99): opcode numbers and operand-type sequences (Reg8/Reg32/UInt8/Addr8 and similar) differ version by version; fix — take the table per version (a missing version falls back to the table of the "nearest <= target version" and reports the actual version). An unknown opcode falls back to <invalid> rather than going out of range; the disassembly layer first normalizes semantic variants onto an abstract definition (two encodings of Mov, and three variants of GetById, merge into one abstract operation). The IR layer handles only abstract semantics; jump targets are computed as an Addr8/Addr32 offset relative to themselves (source: hermes-decomp (SymbioticSec), MIT)
- **Do not use full SSA+Phi for variable recovery**: symptom — decompiler output has a mass of temporaries and edge copies, and readability is poor; cause — the target language JS has no Phi, and the De-SSA stage of full SSA creates noise instead; fix — recover by live-range splitting: reaching definitions + union-find. When two definitions meet at the same use (an if/else join, a loop back-edge) they merge into one class, otherwise they stay independent variables, with no Phi; naming does register-role inference first (infer the type backward from a property/method vocabulary: length/push/map/filter→Array, then/catch/finally→Promise, next/done/value→Iterator, toString/split/trim→String). Name priority: a debug-section scope name > a destructuring key > a named function name > a parameter > a type fallback > a number. Function names pass a "meaningfulness" filter (reject pure digits / generated names / generic core names) (source: hermes-decomp (SymbioticSec), MIT)
- **The Metro module-factory parameter count is a version signal**: symptom — scanning `__d` registrations does not recognize the factory, factory parameter roles are wrong, and module-skeleton recovery fails; cause — a classic bundle factory has 4 parameters (require/module/exports/deps), and a modern bundle has 7 (including importDefault/importAll); fix — param_count-1 (drop this) is the role judgment; match the `__d(undefined, factory, moduleId, deps)` pattern. When parameters are forwarded through registers, keep an in-flow map of "register → function/integer/array" for value tracking; export analysis has three modes, direct assignment / batch assignment / Object.defineProperty; module naming along a propagation chain (name a reverse require → a re-export thin wrapper inherits it → a single-dependency chain) is more reliable than a single-point inference (source: hermes-decomp (SymbioticSec), MIT)
- **Bytecode write-back patches: same length in place, a length change is a move, overlap is refused**: symptom — editing .hbc bytes directly crashes the bundle at runtime and shifts structure tables; cause — string storage allows packed (several entries share one span), offsets are referenced from many places, and a variable-length edit must also fix every later segment; fix — change only bytecode and do not recompile JS (an HASM round trip: emit-hasm out, edit, asm back); string patches dispatch by length: same length → overwrite in place and do not touch the table, a length change → rebuild the string table + storage and move every trailing segment (offsets fixed together); a UTF-16 string and a packed-overlapping string are always refused; modern (>=97) supports only same-length string patches. A variable-length string / a function resize / injecting a stub to grow / create-from-scratch all error explicitly and do not write a broken file; after the patch, reparse and verify the structure agrees. If it does not, refuse the output (source: hermes-decomp (SymbioticSec), MIT)
- **The capability boundary of Hermes decompilation**: symptom — the decompiled result is missing variable names, control flow is distorted, or the expectation is to get the original source back directly; cause — the decompiler has no deobfuscation capability (after obfuscation it can only get the obfuscated semantics); a release pack often strips the debug section (offset=0 or u32::MAX), so variable names/line numbers are entirely gone; disassembly ≠ decompilation — an instruction stream can only give exact control flow and operands, and variable/structure/module semantics depend on IR + whole-program analysis; fix — "no debug info" is itself an analysis conclusion, and naming can only be heuristic; prefer looking in the string table for source/JSON/maps embedded at compile time (for example RN Reanimated's Babel plugin compiles a worklet's original source into the .hbc string table as an ordinary string, and joining by function name yields the real source). That is less work than decompilation and it stays faithful (source: hermes-decomp (SymbioticSec), MIT)
