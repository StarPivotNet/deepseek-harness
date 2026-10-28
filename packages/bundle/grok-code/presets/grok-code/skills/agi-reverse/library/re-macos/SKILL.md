---
name: re-macos
type: atomic
description: >
  macOS native-app reversing: App Bundle/signature and notarization, entitlements, sandbox and TCC, keychain and Secure Enclave.
  Triggers: `macOS逆向`, mac app, entitlements, Secure Enclave, `钥匙串`, TCC, codesign, `公证`.
capabilities: [macho-parser]
---

# macOS app reversing

## When to use / when not to use

- Use: a native/closed-source macOS app (.app/.dylib/.framework), a target with signature, notarization, and a sandbox, a keychain / Secure Enclave hardware-key scenario
- Use: judging authorization/distribution state — who the signer, notarization, hardened runtime, and Team ID are (distribution-surface / trust-surface analysis)
- Use: trust-chain problems — Dylib Hijacking, the injection surface, TCC dependencies (which privacy capabilities were requested/used)
- Do not use: an iOS app (go to [[re-ios]]); pure Mach-O format parsing (go to [[re-format-macho]])
- Do not use: a Linux/Windows target (each goes to [[re-gdb]] / [[re-x64dbg]])
- Do not use: you only want to capture network traffic/file behavior (when there is no macOS-specific surface, use the general path [[re-behavior]] / [[re-netcap]])
- Note: TCC and keychain data are system privacy. Analyze read-only and do not export contents (red line)

## Tool setup

### codesign / spctl / otool / lipo (signature and Mach-O tools, bundled on macOS)

- macOS: bundled with the system (Xcode command-line tools `xcode-select --install`)
- Linux: Mach-O can be analyzed statically (`llvm-otool`, `brew install llvm` or a distro llvm package). Signature parsing is limited
- Verify: `codesign --version`; macOS: `otool --version`; Linux: `llvm-otool --version`

### plutil / xattr (Info.plist and quarantine check, bundled on macOS)

- Verify: `plutil -help`, `xattr -h`
- Use: Info.plist key parsing (`plutil -p`); the `com.apple.quarantine` extended attribute decides whether Gatekeeper blocks it

### Hopper / IDA / Ghidra (decompiler base)

- Install and verify via [[re-ida]] / [[re-ghidra]]

### lldb (dynamic debugging)

- Install and verify via [[re-lldb]]; handle PT_DENY_ATTACH before attach (step 6)

## Procedure

Run in order and archive each step's products (path + sha256, see [[re-triage]]). Record signature/entitlements info per the [[re-analyze/analysis-contract]] contract.

1. **Package layout and signature check**:
   ```sh
   file Sample.app/Contents/MacOS/Sample
   codesign -dv Sample.app 2>&1 | head            # signer/Team ID (requirements need `-d -r-`)
   spctl -a -vv Sample.app 2>&1                   # notarization state (Gatekeeper)
   defaults read Sample.app/Contents/Info.plist   # key Info.plist keys
   ```
   - Watch: the signer (Apple developer/distribution certificate), Team ID, CDHash, Hardened Runtime (the runtime flag), and Info.plist CFBundleIdentifier / version / minimum system version
   - Architecture confirmation: `file` output / an x86_64 and arm64 universal binary (`lipo -archs`) — this decides the decompiler and the dynamic environment (arm64e on Apple Silicon has PAC differences; see [[gotchas]])
   - A notarization-derived check: `spctl -a` passing does not guarantee a local staple — `xcrun stapler validate Sample.app` checks whether the ticket travels with the package
   - Quarantine-attribute check: `xattr -l Sample.app` looks at `com.apple.quarantine` (quarantine flag + timestamp + responsible app; **it does not contain the source URL** — source info is in Spotlight attributes, looked up with `mdls -name kMDItemWhereFroms Sample.app`)

2. **entitlements and the sandbox**:
   ```sh
   codesign -d --entitlements :- Sample.app 2>&1 | head -30
   ```
   - Key groups: `com.apple.security.app-sandbox` (the sandbox master switch), `network.client/server` (network), `files.user-selected.*` (user-selected files), `device.camera/microphone` (devices), `application-groups` (group sharing), `cs.allow-dyld-environment-variables` / `cs.disable-library-validation` (injection surface), `get-task-allow` (debug permission; a release build should not have it)
   - The sandbox profile decides the capability boundary — when analyzing authorization logic and the attack surface, look at the entitlements list first, then cross-check with dynamic behavior
   - Anomaly signals: a release build carries `get-task-allow` (it should be only for development debugging) or an over-privileged combination (for example no UI but `device.camera` is on) — record it as a suspicious item in the conclusion

3. **The TCC permission database**:
   ```sh
   # user-level TCC database (authorization records)
   ls ~/Library/Application\ Support/com.apple.TCC/
   # system-level TCC database
   ls /Library/Application\ Support/com.apple.TCC/
   ```
   - Prerequisite check: TCC.db is itself protected by TCC — without Full Disk Access, reading fails on permissions. Confirm authorization before reading
   - TCC.db (SQLite) records each app's authorization for privacy resources; analyze the target's dependence on TCC (which permissions were requested, when, and the failure path)
   - Note: TCC data is system privacy data. Analyze read-only and do not export contents (red line)

4. **Keychain and Secure Enclave**:
   - Keychain item types (generic password / internet password / key) and access conditions — `kSecAttrAccessible` is **accessibility** (what device state makes it readable: not locked / after first unlock / this device), **not an ACL**; access control is `kSecAttrAccessControl` / `SecAccessControl` (biometrics / passcode gate). Traditional macOS ACL is separately `SecAccess` / `kSecAttrAccess` (see [[gotchas]])
   - A Secure Enclave key: generated on device with `SecKeyCreateRandomKey` (attributes include `kSecAttrTokenID: kSecAttrTokenIDSecureEnclave`) — `SecKeyCreateWithData` imports/restores from external key data. An SE private key never leaves the chip and cannot be imported. Do not treat that as the SE generation interface; the private key is **not extractable** (equivalent to Android Keystore hardware backing; see the Keystore audit in [[re-android-native]])
   - Analysis: which keychain items the target reads (SecItemCopyMatching call sites), and whether the key is Secure Enclave bound (not extractable → record purpose and access conditions rather than looking for the bytes)

5. **The dyld load chain**:
   ```sh
   otool -L Sample.app/Contents/MacOS/Sample | head    # LC_LOAD_DYLIB dependencies
   otool -l Sample.app/Contents/MacOS/Sample | grep -A4 LC_RPATH
   ```
   - The dependency list and RPATH → the Dylib Hijacking surface (a writable directory + a missing dependency)
   - Injection surface: DYLD_INSERT_LIBRARIES is limited by hardened runtime — without the `cs.allow-dyld-environment-variables` entitlement it does not take effect; under system integrity protection, injection on a system path does nothing
   - Injection verification: environment variable + a trial run inside the sandbox, `DYLD_INSERT_LIBRARIES=/path/to/hook.dylib ./Sample`. If it does nothing, return to the static path ([[re-ghidra]]). Do not force the injection

6. **Anti-debug and protection**:
   - Debugger detection: `PT_DENY_ATTACH` (a ptrace request returns a refusal on attach) — locate the ptrace call site statically first ([[re-ghidra]] / [[re-ida]]), patch or bypass it, then attach
   - Signature checks: call sites of the `SecStaticCodeCheckValidity` / `SecRequirementCheck` class — the typical points where changing the signature or injecting triggers a check failure. Locate them one by one (pitfall 1)
   - Record the countermeasure surface: code-signature checks, debugger detection, and anti-injection (a DYLD_INSERT_LIBRARIES check), each with its call site and trigger condition

7. **Evidence check (close-out)**: signer / Team ID / the entitlements text, TCC dependency points, keychain-item purposes, the dyld dependency list — file them per [[re-analyze/analysis-contract]]; cross-check dynamic conclusions against the static list (the capability boundary follows dynamic behavior; see [[decision-tree]])

## Cross-domain

- [[re-format-macho]]: the Mach-O format base (LC_* parsing)
- [[re-ios]]: the iOS-side complement (jailbreak ecosystem and entitlements differences)
- [[re-lldb]]: dynamic debugging
- [[re-frida]]: dynamic instrumentation (macOS desktop is supported)
- [[re-sandbox]] / [[re-analyze/platform-tips]]: isolation of dynamic execution (signature/behavior observation happens inside a sandbox)
- [[re-analyze/analysis-contract]]: signature/entitlements info is passed per the data contract
- [[re-patching]]: persistent handling of PT_DENY_ATTACH and signature-check points
- Swift-layer analysis (mangling/witness table) → [[re-swift]]

## Common pitfalls

- **Signature checks fire in several places**: symptom — after a patch it exits as soon as it runs; cause — checks at load / run / update; fix — locate them point by point (step 6). Handle the check points before walking the logic
- **A Secure Enclave key cannot be extracted**: symptom — a memory search does not find the private key; cause — hardware backing; fix — record purpose and access conditions. Do not look for the bytes (see step 4)
- **TCC permissions make a feature missing**: symptom — the target feature is grayed out; cause — TCC did not authorize it; fix — analyze its request logic rather than bypassing system permissions (red line)
- **A notarization check cannot be reproduced offline**: symptom — in an offline environment the spctl result looks abnormal; cause — notarization needs a network query (including revocation status); fix — substitute local signature info from codesign and mark "notarization state not verified"
- **hardened runtime limits injection**: symptom — DYLD_INSERT_LIBRARIES does nothing; cause — the runtime flag does not include the allow-dyld environment variable; fix — the static-analysis path ([[re-ghidra]]). Do not force the injection
- **quarantine interferes with running**: symptom — the target crashes/prompts when it comes from a download; cause — `com.apple.quarantine` triggers a Gatekeeper check; fix — `xattr -dr com.apple.quarantine` removes it and you retest (test environment only)
- **A nested signature was not handled**: symptom — after a patch, a runtime check fails; cause — framework/helper/extension each have an independent signature, and re-signing only the main program is not enough; fix — `codesign --deep` or re-sign layer by layer, and check each layer's CDHash
- Decision branches (dynamic-feasibility judgment / data-target grading): [[decision-tree]]. Signature/injection/TCC boundaries and counterexamples: [[gotchas]]. Execute entirely inside a sandbox (top principle in [[re-analyze/platform-tips]])
