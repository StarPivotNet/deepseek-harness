---
name: re-harmonyos
description: >
  HarmonyOS app reversing: hap/hsp/har package layout, ArkTS bytecode (.abc, ArkCompiler) analysis.
  Triggers: `鸿蒙`, HarmonyOS, hap, ArkTS, `abc 字节码`, `方舟编译器`
capabilities: [bytecode-parser]
---

# HarmonyOS app reversing (HarmonyOS / hap / ArkTS)

## When to use / when not to use

- Use: you have a hap (app release package) / hsp (shared package) / har (static-library archive) and need module config, resources, and ArkTS business logic
- Use: you need to recover business logic from .abc bytecode (ArkCompiler output) — string location, disassembly, deobfuscation
- Use: the HarmonyOS app contains native libraries (.so under libs/) and needs combined static/dynamic analysis
- Do not use: a normal Android APK (go to [[re-apk]]; the dex/smali system is not this skill)
- Do not use: a pure Web/front-end app (not a HarmonyOS container; script/Web paths go to [[re-script-deob]] or [[re-browser-ext]])
- Note: **dynamic execution defaults to a sandbox ([[re-analyze/platform-tips]] top principle)** — static unpack/disassembly needs no sandbox; emulator or device observation must go into [[re-sandbox]]

## Tool setup

See [[re-analyze/platform-tips]] — static analysis (unpack, strings, disassembly) needs no sandbox; dynamic steps follow the top principle and go into a sandbox.

### hap unpack (zip container, general approach)

- hap = zip container, same family as APK (zip/jar family) — any general zip unpacker works (unzip / 7-Zip / the python3 zipfile module). Do not lock to one implementation
- Same flow as [[re-apk]]: list first (`unzip -l`) → unpack → verify integrity (CRC / file-count check)
- A specialized unpacker (module.json parsing plus resource extraction) is optional; pick the build that matches the release version
- Verify: the unpacked tree is complete (against the listing from step 1)

### python3 (string extraction and scripts)

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`; macOS: bundled; Windows: official installer
- zipfile is in the standard library: `python3 -m zipfile -l app.hap` lists, `python3 -m zipfile -e app.hap out/` unpacks
- Verify: `python3 --version`

### String / resource extraction tools

- `strings` (bundled with binutils) and `grep`: pull URLs, keys, and prompt text from .abc and resources
- For resource files (layouts, images, rawfile), run `file` to identify the type, then extract

### ArkCompiler disassembler (abc alternative, generalized)

- Reuse the jadx-style idea from [[re-java]]: Android uses jadx on dex; the HarmonyOS counterpart is an ArkCompiler disassembler — official toolchain (shipped with the SDK) or an open-source implementation both work. Pick one that emits instruction-level assembly (mnemonics + operands / constant refs). Cross-check with more than one implementation
- Version match: identify the compiler version before picking a tool (see pitfall 2)

## Procedure

Run in order. Archive each step's products (unpack directory, disassembly output + sha256) (see [[re-triage]]).

1. **Package layout identification and unpack**:
   ```sh
   file app.hap
   unzip -l app.hap | head -30
   unzip -o app.hap -d out/
   ```
   - hap ≈ an APK variant: `module.json` (module config, the manifest equivalent: entry / permissions / component declarations), `resources/` (resources, equivalent to res/), `ets/` (where ArkTS compile products live, .abc bytecode), `libs/` (native .so), `assets/` (rawfile and other raw resources)
   - hsp / har are also zip containers with a similar layout (hsp contains .abc; har is a static-library archive). The unpack flow is the same
   - Zip-container unpack is the same family as APK ([[re-apk]]): list → unpack → verify; if a nested container appears, unpack recursively (see pitfall 4)

2. **Bytecode identification (.abc)**:
   ```sh
   find out/ -name "*.abc" | head
   xxd out/ets/modules.abc | head -10    # inspect the file header
   ```
   - `.abc` is an ArkCompiler (`方舟编译器`) bytecode file and the body of the business logic. The header has a fixed magic and a version field, then segments (string segment / literal segment / instruction segment, and so on; the exact layout evolves with the compiler version)
   - Older layouts differ (module file names / locations differ) — trust the unpack listing. If `file` does not recognize it, read the header with `xxd` / python3, identify the compiler version, then pick the tool (see pitfall 2)

3. **Recovering business logic (strings + disassembly)**:
   ```sh
   strings -n 8 out/ets/*.abc | grep -iE 'https?://|key|secret|token|sign' | head
   grep -rnE 'https?://|key|secret' out/resources/ | head    # strings inside resources are clues too
   ```
   - String location: strings inside .abc are stored as constants. strings/grep can pull URLs, keys, and prompt text — walk from a sensitive string back to its reference, then along the call chain to recover logic (same idea as string location in [[re-java]])
   - ArkCompiler disassembly: after instruction-level assembly is produced, find the entry and sensitive-string references first, then recover the flow from constant loads and call relationships
   - JS/TS business-resource extraction: a hap may contain plaintext JS/TS fragments (assets/, rawfile, uncompiled resources) — after extraction, handle them with [[re-script-deob]] (beautify, deobfuscate, decode)
   - When obfuscation shortens function names, fall back to strings and behavior (see pitfall 3)

4. **Same and different versus Android**:
   - No dex/smali layer: business logic is in .abc (ArkCompiler bytecode), not dex — smali patches, baksmali, and similar ideas do not apply directly. The counterpart is ArkCompiler disassembly
   - Resource and manifest layout is similar: module.json ≈ AndroidManifest (entry / permissions / components), resources/ ≈ res/ — resource-analysis ideas from [[re-apk]] (resource dump, string-resource location) partly reuse, with HarmonyOS-side tools swapped in
   - Toolchain reuse and differences: zip unpack, string extraction, `file` identification, and native so analysis ([[re-format-elf]] + [[re-ghidra]]) all reuse; dex tools (jadx/apktool) do not apply and are replaced by an ArkCompiler disassembler; the dynamic-hook idea ([[re-frida]]) still works on a HarmonyOS emulator or device, with the attach method adjusted to the environment

5. **Dynamic side (sandbox)**:
   - Runtime observation on an emulator or device is orchestrated through [[re-mobile]]: install the hap (official deploy tool) → start and observe → capture traffic/logs → hook the runtime for plaintext, and cross-check against static disassembly
   - Always run inside [[re-sandbox]] (emulator snapshot / controlled device + network isolation), following the default-sandbox principle in [[re-analyze/platform-tips]]

## Cross-domain

- [[re-apk]]: same zip-container unpack flow; manifest/resource analysis ideas reuse
- [[re-hybrid-app]]: when a hap embeds a WebView / hybrid framework (JS bundle), split by framework type
- [[re-java]]: reuse the jadx-class decompiler idea (on the abc side the counterpart is an ArkCompiler disassembler)
- [[re-mobile]]: dynamic orchestration (emulator/device + hook + capture). This skill hangs off that gateway domain
- [[re-script-deob]]: deobfuscate extracted plaintext JS/TS business resources
- Base: native so → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]]); initial survey → [[re-triage]]; dynamic sandbox → [[re-sandbox]]; sandbox principle → [[re-analyze/platform-tips]]

## Common pitfalls

- **Opening a hap with Android tools skips the ets directory**: symptom — jadx/apktool errors on a hap, or shows only resources and config and no business code; cause — dex-family tools do not know .abc, so the ets/ directory is skipped; fix — do a full zip unpack and listing check first (step 1). Business code uses an ArkCompiler disassembler. Do not rely on dex tools
- **abc disassemblers are version-sensitive**: symptom — disassembly errors, shifted output, or instructions that do not line up; cause — ArkCompiler keeps evolving, and bytecode layout / instruction set differ by compiler version, so tools must match the version; fix — identify the compiler version first (header version field + module.json / build info), then pick the matching tool, and cross-check implementations when needed
- **After obfuscation, short names fall back to strings**: symptom — functions and variables in the disassembly are all short names and the logic does not read; cause — build-time obfuscation/compression stripped the semantics; fix — fall back to the string table and resources: grep URLs / prompt text / key strings → locate references → recover meaning along the call chain, and compare with dynamic behavior
- **Incomplete unpack of a hap double container**: symptom — after unpack, resources or modules are missing and runtime resources are scrambled; cause — some build versions nest another resource container inside the zip (inner zip / resource index), so a single-layer unpack only gets the outer layer; fix — after unpack, look for nested containers and recurse until module/resource files, and verify integrity with CRC / file counts
- **Business logic lives in a native so**: symptom — the core algorithm/crypto is not in .abc; cause — sensitive logic was pushed down into a .so under libs/ (JNI/NDK style); fix — the so goes through [[re-format-elf]] + [[re-ghidra]] ([[re-binary-core]]), combined with call sites on the .abc side to recover the whole flow
