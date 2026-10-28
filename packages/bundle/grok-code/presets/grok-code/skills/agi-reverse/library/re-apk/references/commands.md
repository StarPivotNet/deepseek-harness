# APK static-analysis command cheat sheet and operation sequences

The tool families fall into three layers: jadx (decompile Java), apktool (unpack / rebuild smali), aapt2/apksigner/adb (resource dump / sign / install loop). Each tool's commands and arguments follow the official docs (jadx: skylot/jadx; apktool: iBotPeaches/Apktool).

## Command-family cheat sheet

### jadx (decompile)

- `jadx -d java-out app.apk` batch-decompiles every dex class into a directory
- `jadx --show-bad-code app.apk` tolerant mode (still emits output when some classes fail to decompile)
- `jadx -j <n> app.apk` thread count; `-r` does not decompile resources; `--no-imports` drops import lines (diff-friendly)
- `jadx-gui` GUI (browse one class, jump, search); `jadx-gui app.apk` opens it directly
- `jadx --version` verifies; depends on Java 11+ (64-bit)

### apktool (unpack / rebuild)

- `apktool d app.apk -o out/` unpacks (resources become readable XML + smali)
- `apktool d -r app.apk -o out/` emits smali only and does not decode resources (rebuild succeeds more often; the usual form for a smali patch)
- `apktool d -s app.apk -o out/` emits resources only, no smali
- `apktool b out/ -o patched.apk` rebuilds (from 3.x the rebuild always uses aapt2; aapt1 is not optional, and the `--use-aapt2` choice was removed together with aapt1)
- `apktool d -a app.apk -o out/` unpacks all source, including unknown dex files (3.x `-a`/`--all-src`, replacing 2.x `--only-main-classes`; the meaning is the opposite — the former opens up, the latter narrows)
- `apktool b out/ --aapt <file>` names the aapt2 binary (the 3.x way to swap aapt2; 2.x `--use-aapt2` was a switch, this is a path; passing aapt1 is refused outright)
- `apktool --version` verifies; `apktool d` includes `--force` by default (overwrites old output)

### aapt2 / aapt (resources and the manifest)

- `aapt2 dump badging app.apk` a quick view of package name / version / launcher activity / permissions / target SDK
- `aapt2 dump resources app.apk` resource ID → name map (used to recover obfuscated resources)
- `aapt2 dump xmltree app.apk --file AndroidManifest.xml` decodes binary XML directly
- `aapt2 version` verifies; the build-tools version follows the SDK, and the command interface is stable
- Older SDK environments use `aapt dump badging app.apk` (the default before build-tools 34)

### apksigner / keytool / zipalign (repack signing)

- `keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456` generates a self-signed keystore
- `zipalign -P 16 -f -v 4 patched.apk aligned.apk` **align first** (4-byte alignment; `-P 16` page-aligns uncompressed `.so` files to 16 KiB; add it when native libraries are present, per the official requirement)
- `apksigner sign --ks ks.jks --out signed.apk aligned.apk` signs (the schemes actually enabled are decided by `--min-sdk-version`/`--max-sdk-version`, not a fixed v1+v2)
- `apksigner verify --print-certs signed.apk` verifies the signature and prints the certificate (confirm the signature took effect)
- `zipalign -c -P 16 -v 4 signed.apk` checks alignment (do not `zipalign` again after signing; it breaks v2/v3 signatures)
- `apksigner --version` verifies; when using apksigner, alignment must finish **before** signing

### adb / helpers (closed-loop verification)

- `adb version` verifies; `adb devices` lists devices
- `adb install signed.apk` installs; `adb install -r signed.apk` replaces an existing install
- `adb shell pm path <package>` retrieves the installed APK path; `adb pull` pulls it back for a byte-level patch check
- `file app.apk` confirms the zip format; `unzip -l app.apk | head` shows the package layout (dex count / so list)

## Common operation sequences (combined playbooks)

### 1. Full static-analysis flow (entry → permissions → code → sensitive points)

```
apktool d app.apk -o out/                         # manifest and smali
grep -E 'application|activity|uses-permission' out/AndroidManifest.xml
jadx -d java-out app.apk                          # Java layer
grep -rE 'key|secret|sign|license|http' java-out/ # locate sensitive strings
# the check/algorithm class you located → deep-read that one class in jadx-gui → walk callers by cross-reference
```

### 2. Smali-patch repack loop (edit → rebuild → sign → install → byte check)

```
apktool d -r app.apk -o out/          # keep original resources; edit smali only
# edit the matching smali: if-eqz ↔ if-nez, const/4 v0, 0x0, return-void
apktool b out/ -o patched.apk
keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456
zipalign -P 16 -f -v 4 patched.apk aligned.apk    # alignment must happen before signing (-P 16 does 16 KiB page alignment when an uncompressed .so is present)
apksigner sign --ks ks.jks --out signed.apk aligned.apk
apksigner verify --print-certs signed.apk        # the signature proves itself first
zipalign -c -P 16 -v 4 signed.apk                # alignment check (do not zipalign again after signing, or the v2/v3 signature is invalidated)
adb install signed.apk
adb shell pm path <package> && adb pull <path>       # pull the installed APK back
# byte-compare the patch address; confirm the edit is in place before debugging the logic layer (see the SKILL.md pitfalls)
```

### 3. Recover obfuscated resources (cross-check aapt2 dump)

```
aapt2 dump badging app.apk            # package / entry / permission baseline
aapt2 dump resources app.apk > res-map.txt   # obfuscated resource ID → name map
# on the dynamic side ([[re-frida]]) take the runtime resource ID and look it up in res-map.txt to recover the real resource name
```

### 4. Packer identification and routing

```
jadx -d java-out app.apk and only packer classes are visible (com.stub.StubApp and similar) → packed
ls out/lib/ looking for packer so files (libjiagu.so / libDexHelper.so / libsecneo.so and similar)
ls -la out/classes*.dex | abnormally small size → the real dex is decrypted at runtime
# after deciding it is packed: go to [[re-anti-analysis]] to unpack, or take the in-memory DEX at runtime with [[re-frida]]/[[re-memdump]]
# packer name / section / entropy fingerprint cross-check → [[re-packer-id]]
```

## Implementation lessons (internalized)

- jadx output corresponds strictly to smali: locate the method in jadx first, then find the matching smali in the apktool output by class name / method name and rewrite it; that is an order of magnitude faster than reading smali directly
- Closed-loop patch verification has two layers: byte level first (pull the installed APK and compare the patch address), then logic level (behavior change) — bytes in place means the sign/install chain did not destroy the edit
- `apktool d -r` is the default form for a smali patch: resources stay as-is and the rebuild failure surface is smallest; use a full unpack only when you must edit resources
- Packer decisions prefer the cross of "jadx output vs in-package dex"; a single feature (for example only one packer so) can misjudge
- Cross-check static conclusions against dynamic evidence: for an obfuscated-resource target, use the aapt2 dump map + a [[re-frida]] runtime value; do not guess on the static side

## Usage notes

- Pure static work can skip the sandbox ([[re-analyze/platform-tips]] supreme rule); running a sample (repack install, unpack verification) follows the [[re-analyze/platform-tips]] sandbox branch
- File each step's artifacts (unpack-directory hash, patched APK sha256, signing certificate) against [[re-triage]]; write conclusions into [[re-analyze/analysis-contract]]
- When the repack target contains a signature self-check, evaluate the check chain first (see the signature pitfall group in [[gotchas]]); a packed target prefers a no-repack plan
