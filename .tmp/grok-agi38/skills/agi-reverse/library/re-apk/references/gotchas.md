# APK static-analysis tool-specific pitfalls and boundaries

## jadx pitfall group

- **No business code in the decompile ≠ the tool is broken**: on a packed sample jadx emits only packer classes (StubApp / the packer Application); the business dex is decrypted only at runtime — identify the packer first per SKILL.md step 5, then go to [[re-anti-analysis]] / [[re-mobile-pack]] or take the in-memory DEX with [[re-frida]]/[[re-memdump]]; do not keep thrashing at the jadx layer
- **Large-sample OOM / hang**: a huge dex or an abnormal sample (a malformed resources.arsc) overwhelms the default heap — browse one class in `jadx-gui` instead of a full decompile, or raise the jadx process heap (a JAVA_OPTS-class environment variable, depending on the distribution script); first use `unzip -l` to see the dex count and estimate the scale
- **Decompile quality drops as the dex gets more malformed**: obfuscated / malformed code_item produces bad code — `--show-bad-code` tolerant output is hard to read but is a floor; prefer cross-checking logic on the smali side (the apktool output)
- **A Java version mismatch means it will not start**: jadx requires Java 11+ (64-bit) — on ClassNotFound / an immediate exit, confirm with `java -version` first; in a multi-JDK environment point `JAVA_HOME` at 11+ before running

## apktool pitfall group

- **On a rebuild failure, unpack again with `-r`**: after a full unpack (resources decoded), `apktool b` often reports resource-compile errors — a smali patch always uses `apktool d -r`, keeping resources as-is; do a full unpack and rebuild only when you must edit resources (3.x has only the aapt2 compile path; there is no switch to change compilers)
- **A rebuilt artifact's signature necessarily differs from the original package**: any repack changes package contents — when the target contains a signature self-check (comparing PackageManager signature information) the patch is blocked; evaluate the check chain first (SKILL.md pitfall 2); a packed target prefers no repack (adapt the signature with a runtime hook)
- **`apktool d` overwrites the output directory**: the default `--force` overwrites the old directory directly — on repeated unpacks the old artifact is replaced silently and a patch comparison uses the wrong version; before a sensitive operation, `cp` an archive or change the `-o` directory
- **The distro apktool is old**: apt/dnf packages lag the official release (wrapper-jar mechanism) — rebuild behavior differences (aapt version, resource handling) follow the official release; when something looks wrong, upgrade to the official build before debugging

## Signing and repack pitfall group

- **zipalign and the signature scheme are orthogonal requirements, and the order cannot be reversed**: when using `apksigner` you must **`zipalign` first, then sign** (official zipalign docs: If you sign your APK using apksigner and make further changes to the APK, its signature is invalidated). v2/v3 include ZIP metadata in the signature protection, so aligning after signing destroys the signature outright — measured: `zipalign -f 4` after `apksigner sign` gives `DOES NOT VERIFY` and reports `APK is signed using APK Signature Scheme v2 but no such signature was found. Signature stripped?`; v3 is the same. jarsigner (v1 JAR signature) has the opposite order (sign first, then align), but v1 is no longer recommended. Which schemes are actually enabled is decided by `apksigner` from `--min-sdk-version`/`--max-sdk-version`, not a fixed v1+v2 (signing a target with minSdk 24 yields v1=false / v2=true / v3=true)
- **`install -r` having no effect ≠ the patch is ineffective**: a same-package same-signature replace install keeps data; when behavior does not change, do the byte-level closed loop first (`pm path` + `adb pull` and compare the patch address; see [[commands]] sequence 2), then investigate the consumer / build cache
- **Signature verification is a cross-layer chain; neutralizing one point is not enough**: the Java layer takes the signature → a digest → the native layer compares it with a hardcoded baseline, and a mismatch at any layer fails — prefer reusing the app's own signature-adaptation hook; on the static side, find the native compare function and neutralize the failure branch (details in SKILL.md pitfall 2)
- **A debuggable target can be attached directly**: an APK with `android:debuggable="true"` or a debuggable build needs no repack; attach with [[re-frida]] and bypass the check — before repacking, confirm whether this shortcut exists

## Packer-identification pitfall group

- **Do not conclude from one feature**: besides libjiagu.so there are in-house packers / obfuscated dex (no packer so, but the dex is transformed) — cross the three features packer so + packer class + dex size; if still unsure, use the [[re-packer-id]] fingerprint
- **Resource obfuscation ≠ packing**: a sample that only obfuscates resources and does not change code has normal jadx output but random resource names — recover the map with `aapt2 dump resources` ([[commands]] sequence 3); do not send it to the unpack flow by mistake
- **Multi-dex split misjudged as packing**: `classes2.dex`/`classes3.dex` is normal multi-dex (method count over 64K), not packing — judge by the total dex and the entry Application class; looking only at the file name misjudges

## Version differences

- **jadx**: from 1.4.x it requires Java 11; the 1.5.x mainline (locally measured 1.5.6 supports `--version`) — the release zip stays in sync with the brew/pacman package, and feature differences are small; the decompiler itself iterates quickly, and old versions support Kotlin / new dex features poorly; when something looks wrong, upgrade first
- **apktool**: **3.x is the current mainline and 2.x is the maintenance line**; the two lines' commands are not fully compatible; the apt/dnf distro build lags the official release clearly. When you pick up an old tutorial/script, confirm the target major version first
- **apktool 3.x CLI breaking changes** (a 2.x spelling errors immediately): (1) **aapt1 removed** — 3.x ships only aapt2 (on 2.x the unsuffixed binary is 32-bit and the `_64` suffix is 64-bit; 3.x has only a single 64-bit binary), the 2.x `--use-aapt2` switch disappears with it, swapping the aapt2 binary uses `--aapt <file>`, and passing aapt1 is refused outright; (2) **no 32-bit build is provided** — there is no usable artifact on a 32-bit system; (3) **`--api-level` removed**; (4) **`--only-main-classes` is replaced by `-a`/`--all-src`**, and the meaning is the opposite: the former unpacks only the main dex, the latter also unpacks unknown dex files (packed/malformed samples often rename dex, and you need `-a` to unpack them); (5) **advanced options accept long arguments only** — 3.x short arguments are only `-a -f -j -l -o -p -q -r -s -t -v`; an old short argument such as `-m`/`-k` reports `Unrecognized option` and must be written `--match-original`/`--keep-broken-res`/`--res-resolve-mode`
- **aapt2 / build-tools**: 34.0.0 is an example; newer SDKs ship a higher version; interfaces such as `aapt2 dump xmltree --file` are stable; older environments use `aapt` (the default before 34)
- **apksigner**: the version built into build-tools follows the SDK; `--min-sdk-version`/`--max-sdk-version` decide which of v1/v2/v3 are actually enabled (the default follows the target SDK range), and `apksigner verify --verbose` prints true/false per scheme; `--version` output follows the actual version

## Usage notes

- Pure static work can skip the sandbox ([[re-analyze/platform-tips]] supreme rule); repack / install / run-verification samples follow the sandbox branch
- Archive patched artifacts against the original sample sha256 ([[re-triage]]); write analysis conclusions into [[re-analyze/analysis-contract]]
- Version-dependent behavior (apktool rebuild details, jadx decompile quality) follows what the target version actually does
