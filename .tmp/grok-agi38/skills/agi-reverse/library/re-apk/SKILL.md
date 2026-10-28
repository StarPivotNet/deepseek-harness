---
name: re-apk
description: >
  APK static analysis: jadx/apktool, manifest, smali, packer identification.
  Triggers: apk, `android逆向`, jadx, smali, dex
capabilities: [dex-parser]
---

# APK static analysis

## When to use / when not to use

- Use: you have an APK / Android application package and need the manifest, Java code, resources, permissions, and component structure
- Use: you need to identify packing / obfuscation (packer, resource obfuscation) as preparation for unpack or a patch
- Do not use: you need a runtime hook / decrypt / bypass (go to [[re-frida]])
- Do not use: the target is logic inside a native .so (go to [[re-format-elf]] under [[re-binary-core]])
- Do not use: you need to extract a DEX from runtime memory (go to [[re-memdump]])

## Tool preparation

Pure static analysis (unpack / decompile) can skip the sandbox ([[re-analyze/platform-tips]] supreme rule); dynamic work / unpack goes to [[re-frida]] / the unpack domain. Verify every tool before use.

### jadx — primary Java decompiler (includes JADX GUI)

- Official/GitHub release: download `jadx-<version>.zip` from `https://github.com/skylot/jadx/releases`, unzip, and run `bin/jadx` (Linux/macOS) or `bin\jadx.bat` (Windows); the GUI is `bin/jadx-gui`
- macOS: `brew install jadx`; Arch: `pacman -S jadx`
- Depends on Java 11+ (official requirement: 11+ and 64-bit): Linux `apt install openjdk-17-jre` / `dnf install java-17-openjdk` / `pacman -S jre17-openjdk`; macOS `brew install openjdk`
- Windows/WSL: use the Linux zip inside WSL
- Verify: `jadx --version`; version note — the release zip stays in sync with the brew/pacman package; use the version you actually measured

### apktool — unpack / rebuild (official/GitHub release)

- Depends on Java 8+ (the minimum on the official install page; the jar is compiled targeting Java 8). Official wrapper: download `apktool_<version>.jar` and the wrapper script from `https://github.com/iBotPeaches/Apktool/releases` (Linux/macOS `apktool`, Windows `apktool.bat`); put the script and the jar in the same directory
- **Version model: 3.x is the current mainline, 2.x is the maintenance line** — the two lines' commands are not fully compatible, and the official docs are split by 3.x / 2.x. After download, confirm the major version with `apktool --version` first; a 2.x-era command or tutorial used as-is on 3.x reports `Unrecognized option` (the change list is in the version-differences section of [[gotchas]])
- Debian/Ubuntu: `apt install apktool` (the distro build is older; command-behavior compatibility is enough)
- macOS: `brew install apktool`
- Windows/WSL: the Linux build inside WSL
- Verify: `apktool --version`

### aapt2 — resource dump / recover obfuscated resources

- Ships with Android SDK build-tools. After installing cmdline-tools: `sdkmanager "build-tools;34.0.0"`, path `$ANDROID_HOME/build-tools/34.0.0/aapt2`
- macOS: `brew install --cask android-commandlinetools` then `sdkmanager "build-tools;34.0.0"`
- Windows: Android Studio → SDK Manager, check build-tools
- Verify: `aapt2 version`; version note — the build-tools version follows the SDK (example 34.0.0; a newer SDK ships a higher version); the command interface is stable, so use the version you installed

### dex2jar (optional) — dex → jar

- GitHub release: download the zip from `https://github.com/pxb1988/dex2jar/releases`, unzip, then `d2j-dex2jar.sh classes.dex` produces a jar, which you browse with jd-gui
- Needs Java
- Verify: `d2j-dex2jar.sh --version`

### apksigner / keytool — repack signing (paired with a smali patch)

- apksigner is in Android SDK build-tools (same path as aapt2); keytool ships with Java
- Verify: `apksigner --version`; `keytool -help`

### adb — device install / repack closed-loop verification

- Ships with Android SDK platform-tools (`sdkmanager "platform-tools"`)
- Linux: `apt install adb` (Debian/Ubuntu); macOS: `brew install --cask android-platform-tools`; Arch: `pacman -S android-tools`
- Windows: the official platform-tools zip
- Verify: `adb version`

## Procedure

Run in order and record each step (evidence path + sha256; see [[re-triage]]).

1. **Unpack (apktool d)**:
   ```sh
   apktool d app.apk -o out/
   ```
   This extracts `AndroidManifest.xml`, `smali/` (bytecode that can be rebuilt), `res/`, `assets/`, `lib/`. `-s` (`--no-src`) does not decode source (resources only), `-r` (`--no-res`) does not decode resources (smali only); combine them as needed for a patch. The artifact is a better fit than jadx for edit-then-rebuild.

2. **AndroidManifest entry / permissions / components**:
   ```sh
   grep -E 'application|activity|service|receiver|provider' out/AndroidManifest.xml | head -40
   ```
   Record: the main entry (`android:name` of `application` / the first `activity`), `uses-permission` (SMS / call-log / device-admin permissions are malicious or sensitive signals), exported components, `android:debuggable="true"` (a debuggable app can be attached directly with [[re-frida]]). After packing, the entry is often replaced by a packer class (see pitfall 1).

3. **jadx decompiles Java**:
   ```sh
   jadx -d java-out app.apk          # batch-decompile every dex class
   jadx app.apk                      # or GUI mode, browse class by class
   ```
   Look first at the entry class (Application / MainActivity) and algorithm / check classes; locate sensitive strings (keys, URLs, check logic) with `grep -rE 'key|secret|sign|license' java-out/`. dex2jar is an equivalent alternative: `d2j-dex2jar.sh app.apk` produces a jar, then use jd-gui; the jar can also enter the [[re-java]] flow (browse with CFR/JD-GUI, identify Java packing). No business code in the decompile → packer identification (step 5).

4. **Smali patch approach**:
   ```sh
   # after editing smali: rebuild, align, sign, install (with apksigner, zipalign must happen before signing; do not change the package after signing)
   apktool b out/ -o patched.apk
   keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456
   zipalign -P 16 -f -v 4 patched.apk aligned.apk
   apksigner sign --ks ks.jks --out signed.apk aligned.apk
   adb install signed.apk
   ```
   Common edits: invert a conditional branch (`if-eqz` ↔ `if-nez`), change `const/4 v0, 0x0` into a returned constant, make the check method `return-void` directly. Locate the logic in `jadx` first, then edit the matching smali. When the target contains a signature self-check, the patch may be blocked (see pitfall 2).

5. **Packing / obfuscation identification**:
   - Packer features: jadx sees only packer classes (`com.stub.StubApp` = ijiami, `com.secneo.apkwrapper` / `com.bangcle.*` = bangcle, Legu, and similar); `lib/` has one extra packer so (`libjiagu.so` = 360 packer, `libDexHelper.so` = ijiami…); `classes.dex` is abnormally small (the real dex is decrypted at runtime)
   - Resource-obfuscation features: paths under `res/` were renamed at random, and the `resources.arsc` structure is abnormal
   - Identified as packed → go to the unpack domain ([[re-anti-analysis]] / [[re-mobile-pack]]) or take the in-memory DEX dynamically ([[re-frida]] / [[re-memdump]]); fine-grained fingerprints of packer name / section / entropy go to [[re-packer-id]]; recover resource obfuscation with aapt2:
     ```sh
     aapt2 dump badging app.apk      # package name / entry / permission quick view
     aapt2 dump resources app.apk    # the resource map after obfuscation
     ```

6. **AAB and split APK (distribution-form boundary)**:
   - `.aab` (Android App Bundle): it is a zip and contains dex and resources — jadx can open it directly and read the code; a real-device install needs bundletool to produce APKS; once you have the .aab, follow steps 1-3
   - split APK (`base.apk` + `config.*.apk`): the main dex and code are in base, and language/density configuration is in the splits — static analysis is primarily on base, and resource differences are compared in the splits; apktool unpacks base and each split separately

## Cross-domain joins

- [[re-mobile]]: workflow step 2 (the APK static branch) always calls this skill
- Need runtime (decrypt / hook / bypass) → [[re-frida]]; take a DEX from runtime memory → [[re-memdump]]
- Packed / shelled → [[re-anti-analysis]] (unpack domain) and [[re-mobile-pack]] (packer-unpack specialty); native .so → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]])
- Deep Java-layer work after dex→jar (obfuscation / Java packing) → [[re-java]]
- This skill is called by the [[re-analyze]] triage path "mobile app analysis" (re-mobile → re-apk)

## Common pitfalls

- **A packed sample shows only the packer stub in jadx**: symptom — the decompile contains only packer classes such as StubApp, and there is no business code; cause — the real dex is stored encrypted under assets/ or is decrypted only at runtime; fix — identify the packer per step 5, go to [[re-anti-analysis]] to unpack, or take the in-memory DEX at runtime with [[re-frida]] / [[re-memdump]]
- **A signature check blocks the patch**: symptom — after a repack install it crashes or reports "signature mismatch / unsigned"; cause — the app self-checks its signature (comparing PackageManager signature information); fix — locate the check point and patch around it (change the smali return / branch), or [[re-frida]] hook the `PackageManager.getPackageInfo` call chain
- **Resources cannot be read directly after resource obfuscation**: symptom — `res/` paths do not match resource IDs, and strings cannot locate the target resource; cause — resources were renamed at random by obfuscation; fix — recover the map with aapt2 dump (step 5), and cross-check with dynamic analysis when needed
- **A native .so was analyzed as Java**: symptom — the core logic (algorithm / anti-debug) is not in the Java layer; cause — the sensitive logic is written in a JNI .so; fix — send so files under `lib/` to [[re-format-elf]] + [[re-ghidra]] ([[re-binary-core]]), and match JNI functions by the export table / symbols in the `Java_<package>_<class>_<method>` style
- **apktool rebuild fails**: symptom — `apktool b` reports a resource compile error; cause — resources were decoded during unpack, and some resource formats are incompatible with rebuild; fix — `apktool d -r` keeps the original resources undecoded, and rebuild after editing smali only
- **Analyzing only base of a split APK misses resources**: symptom — the target string/resource is not in base; cause — language/density configuration was split into `config.*.apk`; fix — apktool unpacks base and each split separately, and resource differences are compared per split (step 6)

- **Four details of a hand-written dex parser**: the opcode is the **low byte of a u16** (the high byte is register bits; reading the whole u16 as the opcode misaligns everything); `fill-array-data` is **0x26** (31t), goto is **0x28** (0x24 is filled-new-array; memory will get this wrong); string_data_item has a **uleb128 length prefix** (if you do not skip it, the length is treated as a character); `insns_size` of code_item is at **+12** (+4 is outs_size) — before writing a parser by hand, check the layout against the dex spec
- **The jadx directory has only the launcher script left**: symptom — `jadx` reports ClassNotFound; cause — the install is incomplete (the jar is missing / was cleaned); fix — re-download the full zip from the GitHub release (codeload.github.com is more stable than github.com), or use a single tool such as baksmali directly
- **Analyzing a container / dual-app (VirtualApp-class) sample**: symptom — a sample running inside a dual-app container behaves abnormally, hooks miss the target process, or you need to analyze the container itself; cause — a VA/Blackbox container simulates the system through "proxy stubs + dynamic registration": starting an Activity goes through a fake AMS inside the container (a Binder dynamic proxy intercepts, restores the VAPP request arguments, then forwards to the real system); IO redirection turns hardcoded absolute paths toward the install path inside the container; a ContentProvider `onCreate` is the container init entry (`handleBindApplication` calls it on purpose); the principle matches old Android (VA supports only old versions; Blackbox is the modern reference implementation); fix — when analyzing an app inside the container, watch which process it really belongs to (container process vs host process), and put hook points on the container framework layer (fake AMS / IO-redirect functions) rather than the app layer; identifying a dual-app environment (dual-app detection) looks at container so files in `/proc/self/maps` and fake package-name path features; the same principle also applies to install-free run / plugin analysis

- **`install -r` has no effect after a repack (repack trap)**: symptom — after a signed repack install, behavior does not change at all, and you misjudge "the patch is ineffective"; cause — with the same package name and the same signature, `-r` replaces the existing app and keeps its data; not incrementing versionCode does not block a content update (it mainly affects the downgrade-install rule); "the patch did not take effect" should be investigated as: the signature-check chain (see the next item), an inconsistent split APK, the install target of a multi-user/profile, a build-artifact cache (the apktool rebuild build cache was not cleaned), the target process was not restarted; fix — after install, do a closed-loop check: `adb shell pm path <package>` retrieves the installed APK, byte-compare the patch address, and only after the bytes are confirmed in place debug the logic layer (a wrong consumer, and similar) (source: reverse-skills (inliver233), MIT)
- **A cross-layer signature-check chain and system-version drift**: symptom — after a repack it still shows a "signature mismatch" class of prompt, or reusing an old-style signature-adaptation hook on a new system falsely reports tampering; cause — signature verification is often a cross-layer chain (the Java layer takes signature information → digest computation → the native layer compares it with a hardcoded baseline, and a mismatch at any layer fails), so neutralizing one point is not enough; the app's own PackageManager signature-adaptation hook can be reused (intercept the getPackageInfo family, replace both signatures and signingInfo, and act only on its own package), but the constructor signature of the internal signature object it builds by reflection (such as SigningDetails) changes with the system version, and returning null after an exception triggers a false judgment; fix — prefer reusing the app's own signature-adaptation hook; on version drift, probe the live constructor with Frida and rebuild through a public constructor; a packed target prefers no repack (runtime signature adaptation), and consider a repack only when there is no packer; on the static side, find the native compare function and neutralize the failure branch (source: reverse-skills (inliver233), MIT)
