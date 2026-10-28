---
name: re-flutter
description: Flutter/Dart AOT reversing: libapp.so snapshot-partition parsing, symbol recovery, Dart VM dynamic analysis. Triggers: Flutter, Dart, libapp.so, AOT snapshot, kernel_blob, flutter_assets, Dart VM
capabilities: [hybrid-app-analysis]
---

# Flutter / Dart AOT reversing (snapshot parsing / symbol recovery / VM dynamic analysis)

## When to use / when not to use

- Use: an Android package contains `lib/<abi>/libapp.so` (a Dart AOT snapshot) and `libflutter.so` (the engine) — business logic is in libapp.so
- Use: iOS `App.framework/App` (an AOT snapshot embedded in a Mach-O; `Flutter.framework` is the engine)
- Use: a debug build's `assets/flutter_assets/kernel_blob.bin` (a Dart kernel binary, containing class/function names and the AST)
- Use: you need to recover a Flutter app's Dart business logic (network interfaces, signature/crypto algorithms, protocols, MethodChannel channels)
- Do not use: a pure native Android app (no libapp.so / kernel_blob; go to [[re-apk]])
- Do not use: a pure native iOS app (no App.framework; go to [[re-ios]])
- Do not use: Flutter Web (the product is JS/WASM rather than a snapshot; go to [[re-wasm]])
- Do not use: the engine layer itself (internal logic of libflutter.so / Flutter.framework; see step 4)
- Note: dynamic steps run inside a controlled device / emulator snapshot ([[re-analyze/platform-tips]] highest principle); static first (large-sample principle)

## Tool setup

See [[re-analyze/platform-tips]] — Flutter products are large (libapp.so starts at tens of MB); follow "static first (large sample)": locate statically first, and supplement dynamically as needed; dynamic work (running / repackaging the app) defaults to a controlled device / emulator snapshot.

### python3 (main snapshot-header / partition parser)

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: built in; Windows: the official installer or `choco install python`
- Verify: `python3 --version`

### binutils (readelf / strings / objcopy, snapshot location and section extraction)

- Debian/Ubuntu: `apt install binutils`; Fedora: `dnf install binutils`; Arch: `pacman -S binutils`
- macOS: ships with the Xcode command-line tools (`xcode-select --install`)
- Windows: no built-in binutils — use WSL, or Ghidra's built-in parse as a substitute
- Verify: `readelf --version && strings --version`

### Ghidra (instruction-segment disassembly / decompilation and cross-references)

- Install and verify are in [[re-ghidra]]; without Ghidra, IDA / radare2 are equivalent ([[re-ida]] / [[re-radare2]])
- Verify: after importing libapp.so, `_kDart*` symbols can be located

### frida (dynamic side, Dart VM entry hook)

- Install, frida-server deployment, and version matching are in [[re-frida]] Tool setup (host and device versions must match)
- Verify: `frida --version`; `frida-ps -U` lists device processes

### blutter (automatic AOT-snapshot recovery, optional)

- Automatic recovery of classes/functions/the object pool of a release libapp.so; install and use are in [[re-hybrid-app]] Tool setup; step 2 of this skill uses manual parsing as the core method, and blutter as an automated alternative and cross-check
- Verify: the output directory contains `pp.txt` and it contains the target app's class names

## Procedure

Run in order; archive each step's products (section extracts / parse scripts / hook scripts + sha256).

1. **Identify the build mode (debug / release)**:
    ```sh
    unzip -l app.apk | grep -E 'kernel_blob|libapp|libflutter'    # Android 容器内定位
    file lib/arm64-v8a/libapp.so
    readelf -sW lib/arm64-v8a/libapp.so | grep _kDart             # release: AOT 快照符号
    xxd -l 32 assets/flutter_assets/kernel_blob.bin               # debug: 前 4 字节应为 ef cd ab 90（kernel magic 0x90abcdef 的小端）
    readelf -sW libapp.so | grep -c _kDartIsolateSnapshot         # AOT 段符号（data/instructions），比按 ASCII 串搜可靠
    ```
   - debug: `assets/flutter_assets/kernel_blob.bin` exists (**the header is 8 bytes total = magic `0x90abcdef` + formatVersion**; a Dart kernel binary; class/function names and the AST are preserved, so recovery cost is low) → go straight to step 3
   - release: no kernel_blob; business code is in libapp.so's `_kDartIsolateSnapshotData` (data) / `_kDartIsolateSnapshotInstructions` (instructions) → step 2
   - iOS: `Payload/<App>.app/Frameworks/App.framework/App` (business) and `Flutter.framework/Flutter` (engine); the same section names inside the Mach-O; locate them with `otool -l` / strings

2. **Dart AOT snapshot-partition parsing (release)**:
    ```sh
    objcopy --dump-section .rodata=snap.rodata libapp.so    # 数据段（含 VM + isolate 两份快照）
    objcopy --dump-section .text=snap.text libapp.so        # 指令段
    python3 - <<'PY'
    import struct
    data = open('snap.rodata', 'rb').read()
    MAGIC = 0xDCDCF5F5                          # Dart VM snapshot magic（int32；文件里是小端 f5 f5 dc dc）
    KINDS = {0: 'full', 1: 'full-jit', 2: 'full-aot'}
    off = 0
    while True:
        off = data.find(struct.pack('<I', MAGIC), off)
        if off < 0: break
        length, kind = struct.unpack('<qq', data[off+4:off+20])   # 基础头共 20 字节
        print('snapshot @', hex(off), 'kind:', KINDS.get(kind, kind), 'length:', length)
        off += 4
    PY
    ```
   - **Header format**: `magic(4, 0xdcdcf5f5)` + `length(8)` + `kind(8)` = **a 20-byte base header** (hash and similar fields follow). **There is no ASCII `"SNAPSHOT"`, and no fixed 12-byte version string** — searching for the string `SNAPSHOT` finds nothing on a real AOT sample
   - **After the header is a version-dependent internal serialization layout** (the order and structure of sub-blobs change with the Dart version); **do not treat it as a stable format promise**: to parse precisely, read against the target SDK version's `runtime/vm/snapshot.h`, the serializer, and the image-snapshot implementation, rather than forcing a hardcoded partition table
   - The machine code itself is in a **separate instruction segment** (`_kDartIsolateSnapshotInstructions`), apart from the data segment; when `kind` is `full-aot` it is an AOT snapshot
   - `_kDartVmSnapshot*` is the VM snapshot (standard libraries such as dart:core/io, shared by every Flutter app); business code is only in `_kDartIsolateSnapshot*`
   - Extract business strings from the strings blob:
      ```sh
      strings -n 6 -t x snap.rodata | grep -E 'https?://|token|secret|api/|MethodChannel'
      ```
   - Import the instruction segment into Ghidra: auto-analysis often does not recognize AOT code objects; function boundaries must be split by the target version's code-object metadata (sub-blob layout changes with version; see the item above); after decompilation, locate business functions by string cross-references
   - Automatic alternative: blutter (Tool setup) recovers asm/the object pool/class names; manual parsing is for cross-check and version fallback (pitfall 5)

3. **Symbol recovery**:
   - The build side kept a map (`--obfuscate --split-debug-info`):
      ```sh
      # 构建命令: flutter build apk --obfuscate --split-debug-info=symbols/
      ls symbols/                               # app.android-arm64.symbols 等（每 ABI 一个）
      python3 -c "import json; d=json.load(open('symbols/app.android-arm64.symbols')); print(len(d['data']))"
      # JSON 结构: {"data": {"混淆名": "原名"}} —— 反向映射表，查表即得原名
      ```
   - With no map, infer backward from string cross-references: UI copy / error messages / URLs in the strings blob → Ghidra cross-references find the referencing instructions → expand up and down the call chain (the method corresponds to [[re-binary-core]] cross-references)
   - debug kernel_blob.bin: the kernel format contains class/function names and the AST; strings + structure parsing recover call relationships directly, with no symbol table

4. **Distinguish the engine from business code**:
   - `libflutter.so` / `Flutter.framework`: the Flutter engine (C++: Dart VM, Skia, channel implementation); basically the same across apps — do not analyze it; use it only to take VM export symbols (step 5)
   - `libapp.so` / `App.framework/App`: the Dart business-code AOT snapshot — the analysis target
   - `_kDartVmSnapshot*` (VM snapshot / standard library) ≠ `_kDartIsolateSnapshot*` (business): business strings and class names are only in the isolate snapshot
   - Native plugins and the MethodChannel native side are outside the business so; go to [[re-binary-core]]

5. **Dynamic side (inside a controlled device / emulator snapshot, the [[re-analyze/platform-tips]] default sandbox)**:
   - Hook the Dart VM library-registration point — `Dart_CreateRootLibrary` exported by libflutter.so (the root-library registration entry; onEnter reads the library URI):
      ```js
      var f = Process.getModuleByName("libflutter.so").findExportByName("Dart_CreateRootLibrary");
      if (f) Interceptor.attach(f, {
        onEnter: function (args) {
          var uri = args[1].readCString();     // 库 URI（C 字符串）
          console.log("root library: " + uri);
        }
      });
      ```
      - Under release AOT this C API may not fire (libraries are deserialized directly from the snapshot) — switch to hooking the VM-internal `dart::Library::New` (a symbol inside libflutter.so, stripped with version) or go straight to the VM Service enumeration below
   - Enumerate isolates / libraries with the Dart VM Service (release must turn the VM service on first: hook `Dart_SetVMFlags` / `Dart_InitIsolate` and inject `--enable-vm-service`, or switch to a debug build to verify dynamic behavior):
      ```sh
      adb forward tcp:8181 tcp:8181
      curl http://127.0.0.1:8181/getVM
      curl "http://127.0.0.1:8181/getIsolate?isolateId=isolates/1"
      curl "http://127.0.0.1:8181/getInstalledLibraries?isolateId=isolates/1"
      ```
      - `getInstalledLibraries` lists every business library (library name = package name / path); `getObject` enumerates classes/fields by objectId; class names and strings in VM-service metadata are still readable
   - After locating the target function, hook by address (`_kDartIsolateSnapshotInstructions` base + code-object offset); the instrumentation base is in [[re-frida]]

## Cross-domain joins

- [[re-mobile]]: the mobile-app analysis gateway — the Flutter branch is taken by [[re-hybrid-app]] and this skill (container-side static and dynamic runs go through the gateway)
- [[re-hybrid-app]]: automatic Flutter snapshot recovery (blutter / reFlutter) and MethodChannel intercept — complements this skill (manual snapshot parsing + VM-layer dynamics)
- [[re-apk]] / [[re-ios]]: Android / iOS container-side static (unpack, manifest, signature, DEX/ObjC native bridge)
- [[re-frida]]: the dynamic-instrumentation base (version matching, spawn/attach, anti-detection, script templates)
- [[re-binary-core]]: the native layer of libapp.so / libflutter.so ([[re-format-elf]] + [[re-ghidra]] decompile the engine and the JNI bridge)

## Common pitfalls

- **release has no kernel_blob.bin**: Symptom — following a debug tutorial, `assets/flutter_assets/kernel_blob.bin` cannot be found; cause — the build mode decides the product: **Debug → JIT (a kernel binary; business code is in kernel_blob)**, **Profile and Release are both AOT** (business code is in libapp.so's snapshot segments) — **Profile does not execute business code from kernel_blob**; its difference from Release is profiling/service/optimization config, not the execution model; fix — judge the mode by step 1 first: no kernel_blob → snapshot-partition parsing in step 2; do not keep searching assets
- **Short names after obfuscate/tree-shaking**: Symptom — function/class names in the snapshot are all short names such as `a`/`b`, or missing entirely; cause — `--obfuscate` obfuscates names + tree-shaking deletes unreferenced code; fix — if the build side has a `--split-debug-info` map file, look it up directly (the JSON in step 3); with no map, anchor on copy/URLs in the strings blob and infer the call chain by cross-reference; on the dynamic side, hook key functions and observe behavior as a complement
- **Engine and business code are conflated**: Symptom — analysis sinks into `dart::` internal functions of libflutter.so or the `_kDartVmSnapshot*` segment (dart:core/io standard library), and time is wasted; cause — the engine layer and the VM snapshot are code shared by every Flutter app, not business code; fix — analyze business code only in libapp.so's `_kDartIsolateSnapshot*`; take only VM exports from libflutter.so (steps 4/5)
- **frida version mismatch**: Symptom — `frida-ps -U` reports a protocol error / unable to communicate; cause — the host frida-tools version number does not match the device frida-server, or the architecture does not match; fix — follow [[re-frida]] Tool setup strictly: compare `frida --version` and download the same-version frida-server, and pick the right architecture (arm64/arm/x86_64)
- **Snapshot version does not match the parse script**: Symptom — partition offsets are misaligned, strings-blob contents are garbage, or parsing breaks; cause — snapshot layout differs across Dart versions (the version string is visible in the header), and a hand-written/third-party script covers only a specific version; fix — read the header version string first; branch the parse by version; when the version is too new, fall back to the general method (magic scan + partition-semantics inference)
- **Hooking a Dart string prints garbage**: Symptom — the hook reaches a Dart object pointer but the print is garbage; cause — a Dart string is not a C string (at offset +7 of the object pointer, a 4-byte Smi-encoded length; shift right 1 for the real length; UTF-8 data starts at +15; that offset is a community-measured value); fix — write a readDartString helper that reads by this layout and caps the length (layout details are in the pitfall entry of [[re-hybrid-app]]); **the offset floats with the Dart version** — trust the authoritative offset exported by `gen_snapshot --print-object-layout-to`, or a measurement; do not copy a dead offset onto a different version
- **Object-pool deserialization read as fixed-width (VLE)**: Symptom — after blutter fails on a custom engine / structurally rearranged snapshot (`No cluster defined for cid N` or empty output), a hand-written parser's refs are misaligned and every string is garbage; cause — a Dart AOT object pool is a tagged entry array (X27 holds the pool base; `LDR Xn,[X27,#off]` loads slot off/8); the fill region has a 1-byte type per entry (old `TypeBits = eb & 0x7f`, `PatchableBit = 0x80`); type 0 (kTaggedObject) carries a VLE ref (variable length), and **type 1 (kImmediate) payload is a fixed-width integer (intptr_t, not VLE)** (a common pitfall); an unsigned VLE has 7 data bits per byte, and the last segment sets bit7 (5→`0x85`, 27673→`19 58 81`); **note that the type numbers/bit widths above are the Dart 2.9-era layout; current versions have changed the TypeBits width and enum order — take the layout table by snapshot version before parsing; do not apply it across versions**; fix — after a VLE read of the length start, decode entry by entry by type; slot_offset = idx × 8; first verify with 2–4 known ref→offset anchors before trusting the whole thing; when anchors do not match, narrow the scan window and retry; the object pool is the symbol table of an unsigned binary — `pool_offset → {every PC that loads it} → {owning function}`, so "which functions touch string ref N" can be answered statically (source: reverse-skills (inliver233), MIT)
- **strings cannot find Chinese copy**: Symptom — running `strings`/grep on libapp.so cannot find Chinese/CJK/emoji business copy, and the lead dies; cause — Dart snapshot strings have two storages: OneByteString (Latin-1/UTF-8, ordinary grep works) and TwoByteString (**UTF-16LE**); Chinese/CJK/emoji are basically all in TwoByteString, and matching a UTF-8 byte sequence against UTF-16LE storage of course misses; **CID numbers drift with the Dart version** (old 85/86, current 3.x is 93/94/95 and similar); do not hardcode a CID — read it dynamically from the snapshot class table; fix — search the target string in both UTF-8 and UTF-16LE, and record offset + encoding + occurrence count; `--dump-utf16` exports every CJK string and then grep; inside the object pool, a function's Code sits next to the strings it loads, so with no symbols the string↔function ownership can be guessed from pool proximity (source: reverse-skills (inliver233), MIT)
- **A pool-slot string has no cross-reference**: Symptom — the string's offset in the pool is known, but the decompiler's cross-reference list is empty, and the referencing function cannot be located; cause — there are only two standard idioms for taking a pool slot: `ADD xR,x27,#page,LSL#12` followed by `LDR xD,[xR,#off]` (offset=(page<<12)+off), and a direct `LDR xD,[x27,#off]` when page==0; a generic xref analysis often misses this kind of indirect address-taking; fix — write a pattern scanner that matches both idioms in raw bytes (no decompiler needed); function ownership uses the prologue signature (`fd 79 bf a9 fd 03 0f aa`) and scans backward to the function start; calibrate with one known load site before trusting the full scan; **"the scanner found nothing" ≠ "there is no loader"** — a non-standard-encoded load will be missed, and a negative result needs a second method to cross-check; a string loaded by exactly one function is feature-dedicated, and is a strong lead to a feature UI builder (source: reverse-skills (inliver233), MIT)
- **build/virtual-method callers=0 is misjudged as dead code**: Symptom — a BL xref scan of build or a virtual method finds 0 callers, and it is misjudged as dead code and abandoned; cause — a Dart build/virtual method is not called through BL; it goes through a dispatch stub: read the object cid → look up the dispatch table → `blr x30` virtual dispatch; a static BL scan naturally cannot see it; fix — callers=0 is normal and is not evidence of dead code; finding callers must be dynamic: at the dispatch stub or the target function's onEnter, capture `lr` + `Thread.backtrace(Backtracer.ACCURATE)` to locate the dispatch site (a "while rebuilding dirty elements" frame is the framework render path; the business builder has already returned); the stub puts the cid in x0 (low 16 bits) and the object pointer in x1; object field @1 also stores the cid as a fallback; after taking the cid, statically search `movk xR,#<cid>,lsl#16` for the constructor, and its BL caller is the parent build; X21 = the dispatch-table base; covering the whole table needs a cid→constructor static map (source: reverse-skills (inliver233), MIT)
- **Treating a Dart bool as 0/1**: Symptom — when decompiling AOT code, a bool is read as an ordinary 0/1 integer, and the logic never matches no matter how it is flipped; cause — Dart AOT has a fixed register convention: X15=shadow-stack, X26=Thread, X27=Pool, X22=null sentinel, X28=heap base (compressed pointers), X21=dispatch-table base; **a Dart bool is a tagged pointer to a canonical object, not 0/1** — True is at a low offset from null, False at a higher offset (without compressed pointers, True = null+0x20 (the low 16 bits often look like …8061), False = null+0x30 (…8071); **with compressed pointers (the Flutter release default), True = null+0x10 (…8051), False = null+0x18 (…8059)**); the consumer `tbz w0,#4` (compressed pointers use `#3`) **bit=0 takes the true branch** — the one whose judgment bit is 0 is True; fix — read disassembly by the fixed register semantics (`mov x0,x22` returns Dart null; the standard prologue is `stp x29,x30,[x15,#-16]!; mov x29,x15`, bytes `fd 79 bf a9 fd 03 0f aa`); bool encoding can be cracked by instruction frequency: `add xR,x22,#0x20` (compressed pointers `#0x10`) appears thousands of times (True), and `add xR,x22,#0x30` (compressed `#0x18`) likewise (False); offsets/judgment bits float with pointer compression and version; trust a measurement or `--print-object-layout-to`; the Thread global is `G = Thread[x26+0x80]`, and fields are read by offset; the allocation-thunk pattern is `mov x2,#imm; movk x2,#cid,lsl16; ldr x4,[x26,#0x228]; br x4` (source: reverse-skills (inliver233), MIT)
- **Materializing false in a patch with movz w0,#0 crashes (SIGILL)**: Symptom — a static patch or a Frida runtime memory write uses `movz w0,#0` (bytes 52800000) to materialize "false", and it crashes at runtime with signal 4 (SIGILL); cause — a Dart bool is a tagged pointer, and 0 is an illegal immediate tag; fix — materialize True with `add x0,x22,#0x20` (bytes c0820091), False with `+0x30` (**under compressed pointers, True is `+0x10` and False is `+0x18`**); the rule applies to both a static patch and a Frida runtime memory write; writing a Dart bool always writes the canonical address; the encoding floats with pointer-compression mode and version; trust a measurement (source: reverse-skills (inliver233), MIT)
- **A dialog patch has no effect (three-source triage)**: Symptom — after NOPing every showDialog call the dialog still appears, or the dialog appears on about a 60-second timer, and repeated retries become a time sink; cause — a Flutter dialog has only three sources, and mis-triage is the biggest waste: (a) an explicit showDialog BL; (b) an uncaught exception — MissingPluginException → FlutterError.onError/zone onError → **an asynchronous dialog, which does not go through any showDialog BL**; (c) an integrity aggregation gate — one aggregation function ORs about 7 checks, and any true shows the dialog; fix — logcat + a Dart stack frame shows MissingPluginException/Unhandled Exception and it appears on a timer → source (b); the correct fix is to cut off the fault-body constructor (change the conditional branch that builds the body into an unconditional skip); the global handler then has nothing to display; **stop NOPing the dialog**; dialog copy → pool ref → body builder → caller trace; callers=0 (cid dispatch) and no showDialog BL → also source (b); for source (c), find the aggregation function (it references many check*/get* channel-method strings + a condition → dialog construction), and NOP its aggregation-failure branch (`CMP W0,W22; B.EQ fail`) or the entry-null dialog-construction helper; when a patch works on one device and not another, use the copy contents to locate the newly triggered check class (for example, a verification-hint copy corresponds to an environment/emulator check) (source: reverse-skills (inliver233), MIT)
- **Treating the kernel-format magic as ASCII `KERNEL`**: Symptom — judging `kernel_blob.bin` by "the file header is KERNEL" with grep/xxd, or searching the container for a kernel file by that string, misses or hits something else; cause — the Dart kernel binary's magic is the **numeric value `0x90abcdef`** (`kMagicProgramFile` in source `runtime/vm/kernel_binary.h`); in the file it appears as little-endian bytes `ef cd ab 90`, and **it is not an ASCII string at all**; the header is 8 bytes total (magic + formatVersion), and a format version number follows, which can be used for version identification; fix — judge by the 4-byte magic; do not use a string search
- **Looking for an AOT snapshot by ASCII `SNAPSHOT`**: Symptom — `grep SNAPSHOT`/`data.find(b'SNAPSHOT')` has zero hits on a real libapp.so, so it is judged "no snapshot" or offsets are guessed from strings; cause — a Dart VM snapshot header is the **numeric magic `0xdcdcf5f5`** (4B) + length(8B) + kind(8B), a **20-byte base header**; **there is no ASCII `SNAPSHOT`, and no fixed 12-byte version string**; the sub-blob layout after the header is a **version-dependent internal serialization implementation** and cannot be forced as a stable format; fix — locate by `0xdcdcf5f5` (little-endian `f5 f5 dc dc`) and read length/kind (`kind` of `full-aot` means an AOT snapshot); to parse precisely, read against the target SDK version's `runtime/vm/snapshot.h` and the serializer implementation; the machine code itself is in a separate instruction segment
- **Tens of thousands of unsigned functions and no place to start**: Symptom — libapp.so is unsigned, about twenty thousand functions, and flipping through disassembly is a needle in a haystack; cause — with no symbols, function boundaries, string ownership, and call relationships all depend on static reconstruction, and there is no priority signal; fix — use the prologue signature bytes (`fd 79 bf a9 fd 03 0f aa`) and scan backward inside .text (a window of about 0x6000–0x8000 bytes) to recover function boundaries first; build a feature vector per function: the set of strings accessed (the dominant signal), BL targets/caller fan-in (`(word>>26)==0b100101` decodes imm26), post-gate branch sites (TBZ/TBNZ/B.EQ), null compares (`CMP W0,W22`/`MOV X0,X22`), and a bool-return flag; four sorters turn 20,000 into a short list: a key-string short list → co-access count (a key-class string ≥2 → orchestrator) → intersection of two anchor sets (the access-function sets of a title string and a body string intersect → a precise builder, 0 or 1 function) → iterate upward by BL-call fan-in; **caller count = a risk measure** — a high count (a shared-state function) should be avoided as a patch point; a dedicated handler with count 1 is a safe target; a high cmp + conditional-branch aggregate score is used to surface an integrity gate / aggregation predicate (source: reverse-skills (inliver233), MIT)
