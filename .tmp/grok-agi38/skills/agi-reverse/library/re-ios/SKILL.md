---
name: re-ios
description: >
  iOS app analysis: Mach-O, class-dump, jailbreak environment.
  Triggers: `ios逆向`, ipa, class-dump, `越狱`
capabilities: [macho-parser]
---

# iOS app analysis

## When to use / when not to use

- Use: you have an IPA / an installed iOS app, and need to look at Mach-O structure, ObjC class structure, code signing, and dynamic analysis in a jailbreak environment
- Use: an App Store encrypted binary needs unpacking
- Do not use: the target is only Mach-O structure / load commands (go straight to [[re-format-macho]])
- Do not use: you need a runtime hook / bypass (go to [[re-frida]])
- Do not use: dynamic analysis with no jailbreak and no managed device (static first; the dynamic-limit note is pitfall 3)

## Tool setup

Static analysis (unpack / class-dump / otool) may skip the sandbox; dynamic work (jailbroken device / simulator / managed device) runs in a controlled environment under the top principle in [[re-analyze/platform-tips]].

### unzip / zipinfo — ipa unpack

- Linux: `apt install unzip` / `dnf install unzip` / `pacman -S unzip`
- macOS: bundled /usr/bin/unzip; Windows/WSL: the Linux build inside WSL
- Verify: `unzip -v`

### class-dump — ObjC header export

- macOS: the latest release 3.4 of the official repo nygard/class-dump is source only, with no prebuilt binary — build from source (xcodebuild) to use it; the `brew install class-dump` formula was removed from homebrew-core (measured in 2026: formulae.brew.sh has no such formula) and is no longer usable
- Alternative: class-dump-swift (mxms0/class-dump-swift) also exports ObjC and Swift classes/methods, built from source (depends on LLVM + make, not the Swift toolchain) — prefer it for a Swift target
- Linux/Windows: no official build; compile class-dump-swift from source (depends on LLVM + make, not the Swift toolchain), or run it on a macOS VM / a remote Mac
- Verify: `class-dump --help` (usage output is enough)

### otool — Mach-O structure / symbol viewing (bundled by Apple)

- macOS: `xcode-select --install` (Xcode Command Line Tools)
- Linux substitute: `llvm-otool` (`apt install llvm` / `brew install llvm`)
- Verify: `otool -h /bin/ls`

### idevice toolchain (libimobiledevice) — device identification / info

- macOS: `brew install libimobiledevice` (includes idevice_id / ideviceinfo / ideviceinstaller)
- Linux: `apt install libimobiledevice-utils` (Debian/Ubuntu); Arch: `pacman -S libimobiledevice`
- Verify: `idevice_id -l` lists UDIDs of connected devices; `ideviceinfo` prints device model / iOS version / UDID

### Jailbreak environment (optional)

- Jailbreak tools: unc0ver / checkra1n / palera1n (pick by device model and iOS version). After jailbreak, install OpenSSH + a package manager (Sileo / Cydia)
- Verify: `ssh root@<device IP>` can log in
- Not jailbroken but a real device is needed: install with an Apple developer-account signature (a free-account signature is valid for 7 days; see pitfall 2); the jailbreak-environment specialty (tweak development / jailbreak detection) is in [[re-ios-jb]]

### iOS FairPlay decrypt / unpack (pick the backend for the environment)

The decrypt backend for an App Store encrypted app is a maintained implementation already adapted to the current Frida API, chosen for the target iOS and jailbreak version. There is no single tool that is universal across versions.

- Prerequisites: a jailbroken device + frida-server (see the [[re-frida]] tool setup) + usbmuxd forwarding
- Selection: first align `frida --version` with the device frida-server version, then pick a dumper compatible with that Frida generation. From Frida 17 the static `Module` lookup/enumeration API was removed (see the common pitfalls in [[re-frida]]), and a dumper that still depends on those old APIs errors immediately on Frida 17
- Legacy / reference implementation: the Frida agent in `AloneMonkey/frida-ios-dump` uses `Module.ensureInitialized`, static `Memory.read*`, `Module.findExportByName(null, …)`, and `Process.enumerateModulesSync` — these APIs were removed in Frida 17. That repo is better kept as a reference for the unpack algorithm and Mach-O rebuild logic; using it directly needs a frida-server of Frida 16 or below, or a port you do yourself to the new API
- Another route: implementations based on `mremap_encrypted` (UnFairPlay / unfaird class), which do not depend on frida runtime instrumentation. Evaluate availability against the target iOS version
- Device channel: macOS `brew install libusbmuxd` (the old usbmuxd formula was renamed); Linux `apt install usbmuxd` (Debian/Ubuntu, includes iproxy); Arch `pacman -S libusbmuxd`
- Verify: `iproxy -h` (the forwarder is usable); confirm parameters from the chosen dumper's own `-h` output

## Procedure

Run in order and record each step (evidence path + sha256, see [[re-triage]]).

1. **ipa unpack and signature check**:
   ```sh
   unzip app.ipa -d app/
   file app/Payload/*.app/*                   # confirm the main binary is arm64 Mach-O
   codesign -dv app/Payload/*.app/ 2>&1       # signature type (Apple Distribution / Development / adhoc)
   otool -l app/Payload/*.app/ | grep -B1 -A4 LC_ENCRYPTION_INFO   # check cryptid
   ```
   `cryptid 1` = App Store encryption. The on-disk code is ciphertext. Unpack first (step 5) and then continue.
   - Package layout at a glance: `Payload/<App>.app/` is the main binary and resources; `SwiftSupport/` is the system Swift libraries (common in a simulator package); `embedded.mobileprovision` is the signing provisioning profile (on macOS, `security cms -D -i` can read entitlements and expiry)
   - `file` confirms the main binary is an arm64/arm64e device architecture — an x86_64 simulator product has no dynamic-analysis value. Skip it

2. **class-dump headers**:
   ```sh
   class-dump -H app/Payload/*.app/ -o headers/
   ```
   Class names / method names / properties are most of the business interface. Look at headers before going into the decompiler. An encrypted binary is unpacked first (step 5) and then dumped, or you only get the shell's classes. Swift methods do not enter ObjC headers (see pitfall 4).

3. **The binary goes through [[re-format-macho]]**:
   ```sh
   otool -h app/Payload/*.app/                # architecture / cputype
   otool -L app/Payload/*.app/                # dependent dylibs (framework list)
   ```
   Structure, load commands, entry, segments, and signature follow the [[re-format-macho]] steps; for a Swift binary, `strings -n 6` finds symbols and error messages to help locate things.

4. **Dynamic debugging in a jailbreak environment**:
   ```sh
   iproxy 2222 22 &                           # usbmuxd forwards device ssh to local 2222
   ssh -p 2222 root@127.0.0.1                 # log into the jailbroken device
   ```
   Start the target app on the device; breakpoint / single-step debugging goes through debugserver + lldb (see [[re-lldb]]); hook / bypass prefers [[re-frida]] (frida-server install is in that skill).

5. **Unpack (FairPlay decrypt)**:
   ```sh
   frida --version                            # host Frida generation — fix it before picking a dumper
   iproxy 2222 22 &
   <chosen dumper> <BundleID or app name>      # pick a maintained implementation for the target iOS / Frida version, pull and decrypt
   file <output>.ipa
   otool -l <output>/Payload/*.app/ | grep -A4 LC_ENCRYPTION_INFO # confirm cryptid 0
   ```
   The idea: read the Mach-O header and segments from the already-decrypted memory image and rebuild a decrypted ipa. The dumper must match the generation of the host `frida --version` and the device frida-server (see tool setup); the unpacked product returns to steps 1-3 and is rerun.

## Cross-domain

- [[re-mobile]]: workflow step 2 (the iOS branch) always calls this skill
- Binary parsing → [[re-format-macho]]; breakpoint debugging → [[re-lldb]]; instrumentation / bypass / unpack execution → [[re-frida]]
- This skill is called by the "mobile app analysis" path in [[re-analyze]] triage (re-mobile → re-ios)
- The desktop macOS ecosystem (signature/entitlements/Secure Enclave) → [[re-macos]]
- Swift-layer analysis (mangling/witness table) → [[re-swift]]
- Jailbreak-environment specialty (tweak analysis and development, identifying and bypassing jailbreak detection) → [[re-ios-jb]]

## Common pitfalls

- **Analyzing an App Store encrypted binary directly**: symptom — class-dump prints nothing / otool structure is incomplete, and decompilation only sees the shell; cause — `cryptid 1` encryption, and the on-disk code is ciphertext; fix — step 1 checks LC_ENCRYPTION_INFO first. If encrypted, unpack per step 5
- **An invalid signature cannot be installed**: symptom — after a repack / modification, a device install reports that it cannot verify the app, or it will not install; cause — the signature and the content disagree, or a free certificate expired after 7 days; fix — `codesign -f -s -` adhoc re-sign (self-sign only) or sign again with a developer certificate; when a free account expires, reinstall
- **No jailbreak → dynamic analysis is limited**: symptom — there is no jailbroken device, and unpack / lldb attach / frida are all unavailable; cause — the iOS sandbox and mandatory signing restrict dynamic debugging; fix — static analysis first (steps 1-3). Dynamic work moves to a simulator (needs an unencrypted app) or a managed device (Apple Configurator deploy + a development certificate). If that is impossible, do static only
- **Swift methods do not enter class-dump headers**: symptom — the business methods cannot be found in the class headers; cause — Swift does not export ObjC runtime metadata; fix — `strings` / `swift-demangle` find symbols. Logic analysis relies on [[re-format-macho]] + decompilation ([[re-binary-core]])
- **class-dump errors on an arm64e binary**: symptom — class-dump crashes or the output is empty; cause — arm64e pointer authentication (PAC) interferes with the metadata walk; fix — switch to a newer class-dump / class-dump-swift, or unpack first and then dump
- **Treating a simulator product as a device analysis**: symptom — `file` shows the main binary is x86_64, and dynamic analysis is entirely unavailable; cause — the distributor gave a simulator package (often with SwiftSupport/); fix — step 1 uses `file` to confirm an arm64/arm64e device architecture. Skip a simulator product
- **class-dump will not install (the brew formula was removed)**: symptom — `brew install class-dump` reports No available formula; cause — homebrew-core removed that formula (measured in 2026); fix — build nygard/class-dump from source, or switch to class-dump-swift (see tool setup)
