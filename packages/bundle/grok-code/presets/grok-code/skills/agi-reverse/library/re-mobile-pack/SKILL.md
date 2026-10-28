---
name: re-mobile-pack
description: >
  Android packer unpacking specialty: `乐固`/360/`梆梆`/`爱加密`, DEX recovery.
  Triggers: `脱壳`, `Android加固`, `DEX脱壳`, `乐固`, `梆梆`, `360加固`, `爱加密`
capabilities: [unpack]
---

# Android packer unpacking (DEX recovery)

## When to use / when not to use

- Use: you have an Android packed app (`乐固`/360/`梆梆`/`爱加密` and similar) and need to recover the real DEX to continue static analysis
- Use: [[re-apk]] has already identified a packer, and a unpack path must be chosen
- Use: the unpacked product has empty method bodies / extracted instructions, and needs repair
- Do not use: packing is not confirmed — confirm statically with [[re-apk]] first; an ordinary app goes straight to jadx
- Do not use: a strong packer that is mainly VMP virtualization — go to [[re-anti-analysis]] (the [[re-unpack-advanced]] idea)
- Do not use: you need a runtime hook / detection bypass (that is [[re-frida]])

## Tool setup

Dynamic unpacking runs by default inside a controlled device / emulator snapshot (top principle in [[re-analyze/platform-tips]] — default sandbox). Verify every tool before use.

### frida + frida-dexdump — the runtime-unpack workhorse

- frida-tools: all platforms `pip install frida-tools` (Python 3.8+; a venv is recommended); the frida-server version must match the host and be pushed to the device (the full install and anti-detection flow is in the [[re-frida]] tool setup)
- frida-dexdump: all platforms `pip install frida-dexdump` (Python 3) — at runtime, search memory for the DEX magic and dump
- Verify: `frida --version`; `frida-dexdump -h` (the `-U` / `-f` / `-d` parameters are visible)
- Usage: `frida-dexdump -U -f <package>` (spawn and unpack from the start), `frida-dexdump -U <pid>` (attach), `frida-dexdump -U -f <package> -d` (deep search, covers multi-DEX / partial extraction)

### BlackDex — a static unpacker (no frida; the preferred alternative for an ordinary packer)

- Install: download the APK from GitHub releases — `https://github.com/CodingGay/BlackDex/releases`; 32-bit and 64-bit are two separate APKs (if the target app does not appear in the list, switch to the other architecture)
- Environment: an ordinary Android phone or emulator, Android 5.0~12, no root / custom environment required
- Capability: covers the three packer classes on-disk load / in-memory load / instruction extraction; deep mode backfills method bodies of extracted instructions (experimental; it may take several minutes or fail)
- Products: `hook_*.dex` (from hooking system APIs) and `cookie_*.dex` (the DexFile cookie technique)
- Verify: after install it can list the target app and finish unpacking

### Youpk — an active-call unpacker (the strongest path for extraction packing)

- Source/ROM: `https://github.com/Youlor/Youpk` — a fork of Android 7.1.2_r33, **Google Pixel 1 only**: build in Android Studio and flash the custom ROM with `flash-all.sh`
- Usage: `adb shell "echo <package> >> /data/local/tmp/unpacker.config"` → start the target app and it unpacks by active call automatically (the log says "unpack end") → `adb pull /data/data/<package>/unpacker`
- Repair: `java -jar dexfixer.jar ./unpacker ./out` (the companion DEX repair, backfills method instructions)
- Verify: `adb shell ls /data/data/<package>/unpacker` shows dex/method products

### jadx — decompile after unpacking (reused from [[re-apk]])

- Cross-OS install and verification are in the [[re-apk]] tool setup; jadx analyzes multiple DEX files directly, so a hand merge is avoided

### adb — device interaction

- Bundled with Android SDK platform-tools; verify `adb --version`; for an emulator, `adb shell` is enough
- dexdump: bundled with Android SDK build-tools (used for the DEX integrity check in step 4); verify `dexdump -h`

### Memory dump (the [[re-memdump]] idea)

- frida/objection `memory dump`, or grep the dump for the DEX magic `dex\n0xx` per [[re-memdump]] and extract — the fallback when frida-dexdump is unavailable

## Procedure

Run in order. Archive each step's products (DEX path + sha256) (see [[re-triage]]).

1. **Identify the packer (confirm before acting)**:
   - Class-name features: jadx decompilation only shows packer classes — `com.stub.StubApp` (`爱加密`), `com.secneo.apkwrapper` / `com.bangcle.*` (`梆梆`), and similar; the entry Application was replaced with a packer class
   - Packer so features: `ls out/lib/` — `libjiagu.so` / `libprotectClass.so` (360 packing), `libDexHelper.so` / `libexec.so` (`爱加密`), `libsecexe.so` / `libsecmain.so` (`梆梆`)
   - DEX size: `ls -la out/classes*.dex` — the real DEX is stored encrypted (assets/ or decrypted at runtime), and classes.dex inside the packer is abnormally small
   - The identified packer name decides the path: ordinary whole-file / extraction packing → this skill; mainly virtualization → [[re-anti-analysis]]

2. **Runtime unpack (frida-dexdump, the default path)**:
   ```sh
   adb shell monkey -p <package> 1            # start the app first so the packer loads the real dex into memory
   frida-dexdump -U -f <package>              # or spawn from the start
   frida-dexdump -U <pid>                  # attach to an already-running process
   frida-dexdump -U -f <package> -d           # deep search (multi-DEX / partial extraction)
   ```
   Products are in the current directory `<package>/<timestamp>/*.dex`. **Timing**: wait until the app reaches a business page before dumping (key experience in [[re-analyze/platform-tips]] — dump timing). A dump at the instant of start gets the packer's initial state.

3. **Static unpack (BlackDex / Youpk, the alternative when frida is detected)**:
   - BlackDex: install the APK for the matching architecture → pick the target app → unpack (an ordinary packer takes seconds; an extraction packer uses deep mode, several minutes, with a failure risk) → export the products
   - Youpk (prefer this for extraction packing): flash the Pixel 1 ROM → write the package-name config → start the app and wait for the automatic unpack → pull the `unpacker/` directory → `java -jar dexfixer.jar ./unpacker ./out`
   - Cross-check: compare the products of the two paths (the same method body should agree). When they disagree, take the complete one

4. **DEX repair and integrity check**:
   ```sh
   file out/*.dex                          # should show "Dalvik dex file version 035" (magic: dex\n035\0)
   dexdump out/classes.dex 2>/dev/null | head -30
   jadx -d java-out out/                   # decompile to verify: are the business classes complete
   ```
   - Empty method bodies (CodeItem all nop / a direct throw) → an instruction-extraction packer was not backfilled: re-unpack with dexfixer (companion of a Youpk product) or BlackDex deep mode; if it still fails → trigger the method by an active call and then dump ([[re-memdump]] idea)
   - Multi-DEX: check whether classes.dex / classes2.dex / ... are complete; frida-dexdump `-d` deep search is the fallback; jadx analyzes multiple DEX files directly
   - After repair, a decompile spot-check is mandatory before business analysis (see pitfall 3)

5. **Analysis after unpacking (the full [[re-apk]] flow)**:
   - manifest entry/permissions → jadx decompiles business code → locate the target logic (key/protocol/check)
   - Behavior must change → a smali patch + repack and sign ([[re-apk]] step 4)
   - A native so (packer so / JNI business so) → [[re-binary-core]] ([[re-format-elf]] + [[re-ghidra]]); the packer's own anti-debug/check countermeasures → [[re-anti-analysis]]

## Cross-domain

- [[re-mobile]]: workflow step 5's packing branch always calls this skill (entered after [[re-apk]] identifies the packer)
- [[re-apk]]: packer identification (step 5) and static analysis after unpacking (manifest / jadx / smali)
- [[re-frida]]: the runtime-unpack execution environment + anti-frida-detection countermeasures (rename / change port / gadget)
- [[re-memdump]]: the in-memory DEX extraction idea (dump timing, magic scan, multi-DEX fallback)
- [[re-anti-analysis]]: VMP / virtualization-packer countermeasures (an extraction+virtualization combo packer goes to the strong-packer flow)
- [[re-binary-core]]: packer so / JNI native-logic analysis ([[re-format-elf]] / [[re-ghidra]])
- [[re-analyze/platform-tips]]: default sandbox (emulator snapshot), the key dump-timing experience
- This skill is referenced by the "mobile app analysis" path in [[re-analyze]] triage (re-mobile → re-apk identifies packing → re-mobile-pack)

## Common pitfalls

- **VMP-class packing (extraction + instruction virtualization) is hard to unpack**: symptom — after frida-dexdump / BlackDex produce a DEX, method bodies are full of nop / empty shells, and some method logic can never be found in the dex; cause — besides extracting instructions, the packer virtualizes key methods into an so (a custom VM interprets them), and the DEX layer cannot restore that part; fix — when it is identified as extraction+virtualization: repair the extracted part with a Youpk active call, and give up DEX recovery for the virtualized part. Observe input/output dynamically with a [[re-frida]] hook, or restore the VM interpreter (high cost; mark the scope and go to the strong-packer idea in [[re-anti-analysis]])
- **Anti-frida detection**: symptom — spawn crashes immediately, frida-dexdump cannot connect, or the dump is empty; cause — the packer detects frida-server port 27042 / path / characteristic threads (gum-js-loop) and similar fingerprints; fix — follow the anti-detection section of [[re-frida]]: rename + change the port; if it is still detected → switch to BlackDex / Youpk (they do not depend on frida) or a frida-gadget injection
- **Incomplete DEX repair (empty method bodies)**: symptom — jadx opens the unpacked DEX and half the methods have no decompiled content or throw directly; cause — the CodeItem of an instruction-extraction packer was not backfilled (the dump was earlier than method execution / the repairer did not handle it); fix — dexfixer repair (companion of a Youpk product) or re-unpack with BlackDex deep mode; trigger the method by an active call and then dump with [[re-memdump]]; after repair, a dexdump spot-check + a jadx decompile verification, then enter analysis
- **Multi-DEX merge/loss**: symptom — only a single classes.dex was dumped, and jadx reports a missing class / a reference that does not exist; cause — after packing, multiple DEX files are loaded by the packer at runtime, and the frida-dexdump default search may miss them; fix — `-d` deep search, hook ClassLoader and enumerate loaded dex ([[re-frida]] enumeration), extract everything from a memory dump; jadx loads every dex directly for analysis
- **Dumping too early**: symptom — the dumped DEX will not unpack / is the packer's initial data; cause — the real dex has not been decrypted and loaded yet; fix — wait until the app enters a business page and then dump (the key dump-timing experience in [[re-analyze/platform-tips]], the other end from "save decrypted data the instant you see it")
- **PairIP (Google Play automatic protection) has three gates**: symptom — JADX opens a key method and only `VMRunner.invoke("...")` remains as an empty shell, and on an emulator it exits after a few seconds; cause — the three-piece packer Play applies automatically on listing: (1) code virtualization: logic is extracted into an encrypted VM blob (a randomly named file with no extension under assets; a `\x00IAP` header is the decrypt criterion) + the native interpreter `libpairipcore.so` (symbol names such as `executeVM` are decoded at runtime from an XOR table, and strings will not find them); (2) a TEE key: the blob is AES/GCM ciphertext, the wrapping key lives in the device TEE (AndroidKeyStore), and Play delivers it through `importWrappedKey` (SecureKeyWrapper ASN.1) — three hard prerequisites: a Play install (the `gpdeku` split carrier), passing Play Integrity, and a signed-in Google account. Missing any one means a Finsky log FAILURE → faking `isEncryptionKeyPresent()` locally also does nothing; (3) runtime anti-tamper: `dl_iterate_phdr` / opendir scans maps, finds an injected so → deliberately feeds std::vector an illegal length → `std::__throw_length_error` abort (tombstone fingerprint `length_error was thrown in -fno-exceptions mode`) → if the abort is neutralized, execution falls through to the instruction after abort, hits memory, SIGSEGV + `SIG_DFL` reset — **a signal-layer hook cannot stop it. The root cause is on the detection side (maps must not show the face)**; fix — pass Integrity first (a three-green real device or PlayIntegrityFix) + clear visible injected modules (restart after Zygisk disable)
- **PairIP plaintext: call, do not hook**: symptom — hooking any `VMRunner` method (getVmByteCode/executeVM/readByteCode) destroys the process immediately; cause — PairIP watches ArtMethod integrity: a frida hook rewriting `entry_point_from_quick_compiled_code` hits the check; fix — **call the decrypt function by reflection** (`getVmByteCode` is private static, and frida reflection can call it; whether the blob name has an `assets/` prefix is inconsistent across versions, so try both). Zero hooks and zero ArtMethod changes decrypt every blob to plaintext — unpacking PairIP does not need kernel-level stealth. Kernel-level stealth is needed only when you must follow the interpreter dynamically
- **Repacking a packed APK directly → a black screen on a real device**: symptom — a packed APK is repacked with apktool, and after signing and installing the real device shows a black screen (the process stays alive, no crash), while the same APK "looks normal" on an emulator; cause — the repack rebuilds the DEX from smali and breaks the packer's layout and self-check assumptions. The packer cannot locate/verify the encrypted payload → it does not decrypt → every platform-channel handler in the real DEX throws MissingPluginException → an uncaught exception tears down rendering; on an emulator the packer check is relaxed, and "the emulator can run it" is not evidence; fix — before a repack, do a packer check (a packer runtime so under assets in the `lib*sec*` / `lib*shell*` style, a dynamic DEX loader so, a packer stub entry class, a single oversized classes.dex with no business strings, and an smali→dex round trip that splits out several empty stub DEX files); once packing is confirmed, give up an apktool repack; a memory dump must hit the decrypt window — the packer unloads itself transiently, and `/proc/self/maps` may not even show the packer. Too early or too late and the decrypted DEX is not obtained; if the app itself also self-checks "whether the packer exists", unpacking must neutralize that check as well (source: reverse-skills (inliver233), MIT)
- **Delivery paths for a packed target: unpack-and-repack / injection without repack / a resident gadget**: symptom — a packed target is unpacked and repacked and then runs abnormally, or it is unclear which modification-delivery path to pick; cause — after unpack-and-repack, packer artifacts were not cleaned, and the packer runtime conflicts with the plaintext DEX; fix — pick by target state: path a, unpack and repack (high fidelity): blackdex / FART / frida-dexdump takes the real DEX back from the live process inside the decrypt window and then repacks (the packer is no longer needed). Before the repack, clear every packer artifact (packer runtime so, packer directory, DEX loader); path b, injection without a repack (the DEX is not reinstalled, the packer and the self-check are not touched at all, low risk to the packer, preferred): replace libapp.so in place + inject a Java hook with an LSPatch-class tool. Note the target may detect the injection framework itself (detection strings are common), which is an integrity signal that must be handled together; path c, a resident gadget (zero file changes): inject frida-gadget + a boot autostart script for runtime signature adaptation and an in-memory libapp patch. Note the gadget can be detected, and a runtime flip of a check-coupling flag may backfire; reversing the packer-check logic to force an apktool repack is not recommended — high difficulty, low return (source: reverse-skills (inliver233), MIT)
