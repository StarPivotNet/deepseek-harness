---
name: re-mobile
type: gateway
description: >
  Mobile-app analysis gateway. Orchestration: APK static → iOS → dynamic Frida → native libraries.
  Child skills: [[re-apk]] [[re-ios]] [[re-frida]] [[re-frida-script-author]] [[re-mobile-pack]] [[re-hybrid-app]]
  [[re-android-native]] [[re-android-crypto]] [[re-ios-jb]] [[re-flutter]] [[re-harmonyos]].
  Crypto-system audit (Keystore / Cipher / crypto hook) → [[re-android-crypto]]
  Triggers: `移动App`, APK, ipa, `Android逆向`, `iOS逆向`, frida, mobile app analysis.
capabilities: [dex-parser, jni-analysis, frida-instrumentation, mobile-forensics]
---

# Mobile app analysis

## Full workflow

1. Survey: [[re-triage]] (capability: `triage`) — file/hash/entropy confirms the input type (APK and IPA are both ZIP containers, and `file` reports ZIP; a bare `.so` / Framework dylib goes straight to step 4). If the [[re-analyze]] entry was not used, do it first and read the `RE_*` session variables
2. Static:
   - Android: [[re-apk]] (capability: `dex-parser`) — apktool unpack, AndroidManifest entry/permissions/components, jadx decompiles Java, smali patch ideas, packer identification
   - iOS: [[re-ios]] (capability: `macho-parser`) — ipa unpack and signature check, class-dump headers, unpack an encrypted binary
3. Dynamic: [[re-frida]] (capability: `frida-instrumentation`) — when runtime behavior is needed (decrypt, hook, bypass certificate/detection, observe the call chain), spawn/attach and instrument; iOS breakpoint debugging goes to [[re-lldb]] (capability: `debugging`)
4. Native libraries: a mobile app that contains native code (Android `lib/*.so`, a dylib inside an iOS Framework) → [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`): [[re-format-elf]] (capability: `elf-parser`; Android) / [[re-format-macho]] (capability: `macho-parser`; iOS) parse the format, [[re-ghidra]] (capabilities: `decompilation`, `debugging`) decompiles the JNI/ObjC lower logic; a deep Android-native dive (JNI registration recovery, so logic) goes to [[re-android-native]] (capability: `jni-analysis`); an iOS jailbreak environment (jailbreak detection / tweak / dynamic debug) goes to [[re-ios-jb]] (capability: `jailbreak-analysis`)
5. Packed: after [[re-apk]] (capability: `dex-parser`) identifies a packer, go to the unpack domain ([[re-anti-analysis]] (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`), Android); an iOS App Store encrypted binary is unpacked per [[re-ios]] (capability: `macho-parser`) (the backend is chosen for the target iOS/jailbreak environment). Unpacked products return to step 2 and are rerun
6. Output: conclusion/report (per `RE_REPORT`), hash and evidence archived (see [[re-triage]] (capability: `triage`))

Archive each step's result (evidence path + sha256, see [[re-triage]] (capability: `triage`)) so the report can cite it. A malware sample or a callback found at any time goes to [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`).

## Which atomic skill when (choice tree)

- Input is an APK / the target is Android → [[re-apk]] (capability: `dex-parser`) static → runtime needed → [[re-frida]] (capability: `frida-instrumentation`)
- Input is an IPA / the target is iOS → [[re-ios]] (capability: `macho-parser`) static + unpack → breakpoint debug [[re-lldb]] (capability: `debugging`) / instrument [[re-frida]] (capability: `frida-instrumentation`)
- The target contains a native library (.so / dylib) → [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`; [[re-format-elf]] (capability: `elf-parser`) / [[re-format-macho]] (capability: `macho-parser`) / [[re-ghidra]] (capabilities: `decompilation`, `debugging`)); Android native specialty (JNI/so) → [[re-android-native]] (capability: `jni-analysis`)
- The target has jailbreak detection / tweak analysis is needed / dynamic debug on a jailbroken device → [[re-ios-jb]] (capability: `jailbreak-analysis`)
- Decrypt / bypass a certificate / hook a function / observe a call chain → [[re-frida]] (capability: `frida-instrumentation`)
- Packed: Android → [[re-anti-analysis]] (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`; identify first via [[re-apk]] (capability: `dex-parser`)); iOS encryption → unpack with [[re-ios]] (capability: `macho-parser`)
- Android packer-unpack specialty (`乐固`/360/`梆梆`/`爱加密`) → [[re-mobile-pack]] (capability: `unpack`; after identification, runtime/static unpack + DEX repair)
- Flutter / React Native hybrid app → [[re-hybrid-app]] (capability: `hybrid-app-analysis`; engine identification → blutter / hermes-dec)
- Extract a DEX/key from runtime memory → [[re-memdump]] (capability: `memory-dump`; DEX extraction is in that skill)

## Cross-domain

- A mobile app contains a native library: [[re-mobile]] → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]] decompile the JNI/ObjC lower logic); Android native specialty [[re-android-native]]; iOS jailbreak environment [[re-ios-jb]] (jailbreak detection / tweak / remote lldb)
- A mobile app is packed: [[re-mobile]] → [[re-anti-analysis]] (Android unpack); an iOS encrypted binary is unpacked by [[re-ios]]
- Dynamic analysis defaults to a sandbox: emulator snapshot / controlled jailbroken device + network isolation (top principle in [[re-analyze/platform-tips]])
- Mobile malware sample / callback: [[re-mobile]] → [[re-malware]] (behavior analysis in [[re-sandbox]])
- This gateway is called by the "mobile app analysis" path in [[re-analyze]] triage.md (re-mobile → re-apk / re-ios → re-frida → re-binary-core if a native library is present)

## Common pitfalls

- Opening an APK in jadx, getting Java, and concluding → on a packed sample jadx only sees the packer shell — identify the packer with [[re-apk]] first, then go to the unpack domain ([[re-anti-analysis]]) or take the in-memory DEX dynamically
- Treating an iOS encrypted binary as an ordinary static target → class-dump/otool only see the shell or ciphertext — check `cryptid` and unpack per [[re-ios]] before continuing
- Running mobile dynamic analysis bare on a real device → the device environment is uncontrollable and evidence is hard to reproduce — prefer an emulator snapshot / a controlled jailbroken device, with network isolation (top principle in [[re-analyze/platform-tips]])
- Ignoring native libraries → only the Java/ObjC layer was analyzed, and the core logic (JNI, anti-debug, sensitive algorithms) is all in a .so/dylib — seeing `lib/` or a Framework means go to [[re-binary-core]]
- Skipping steps in the choice tree → Frida before static work is finished, or every dynamic method is used and there is still no progress — advance in workflow order 1→6, and archive evidence at each step before the next

### Mobile-package repack and patches

- **A repack keeps the original format parameters**: symptom — a repacked package, or one with resources replaced, crashes or fails to parse when loaded on a real device; cause — the repack tool's default output format differs from the original (compression method / alignment / container flags); fix — keep the original package's format parameters (compression flags / alignment). The product should be the same order of size and the same format as the original. Verify locally before the real device
- **Learn the host structure before replacing an embedded resource**: symptom — after replacement the target reads at the wrong offset; cause — the embedded length/header fields inside the container are unknown (the length field was not updated when the replacement length changed); fix — parse the host structure with a script first (magic / length-field position). After replacement, unpack the content back out of the final product and compare it (strings will not find it inside a compressed container; you must decompress to verify)
- **Pick a patch injection point in a module whose content is fully known**: symptom — you want to change a module with complex logic, and can only patch the instruction stream at byte level, which is fragile; cause — there is no declarative/readable host; fix — pick a module whose content can be fully restored and wholly rewritten (config class / constant class) as the injection host, and append the patch logic at the end of the host
- **A patch must never block the main flow**: symptom — patch code runs before the host framework is ready, and crashes or hangs; cause — injection is too early (host dependencies are not initialized); fix — poll a host-ready flag (UI framework root / main object is available) and only then run. Protect every exception. On timeout, give up silently and fall back to the original behavior
- **Order for debugging a real-device native crash**: symptom — a tombstone/native stack only locates a module layer and does not show the root cause; cause — runtime protection (pcall / exception catch) cannot save a native abort, and the managed exception log is the root cause; fix — suspect "repack format differences" first (compression / alignment / container structure), then suspect logic; root-cause evidence is the runtime exception log (FATAL EXCEPTION / Unhandled Exception). Do not look only at the native stack
- **A channel package is not the official package**: protocol/behavior conclusions from a third-party channel repack (a package name with a channel marker, login through the channel SDK) cannot be applied directly to the official package — before analysis, confirm the package source (package name / signature / channel-SDK features)


## Experience library

The full field-experience corpus is in [[experience]].
