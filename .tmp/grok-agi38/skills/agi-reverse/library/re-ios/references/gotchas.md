# iOS app-analysis tool-specific pitfalls and boundaries

## Signature and install pitfalls

- **A free signature dies in 7 days**: an app signed with a free Apple ID expires in 7 days — for a long analysis, confirm the signature validity first (`security cms -D -i embedded.mobileprovision` reads the expiry). Do not misread "expired signature, cannot install" as "the patch/repack failed"
- **After a repack, the signature and the content disagree**: a modified binary must be re-signed (`codesign -f -s -` adhoc is self-sign only, or a developer certificate), or the device reports that it cannot verify the app; an adhoc signature covers only a local self-install. When it coexists with the original signature, look at how it was installed
- **entitlements change runtime behavior**: losing the original entitlements on re-sign (for example keychain-access-groups, aps-environment) changes behavior — `codesign -d --entitlements -` exports the original items first, and the re-sign carries them
- **Limits of a free-account signature**: a free account has no App Group / push and similar capabilities, and the signature lasts 7 days — for full capabilities use a paid developer account or a managed device

## Encryption and unpack pitfalls

- **The cryptid verdict must look at the LC_ENCRYPTION_INFO segment**: a `codesign` result does not state encryption. Only LC_ENCRYPTION_INFO inside `otool -l` (cryptid 0/1) counts — run this step right after unpack, then plan
- **Unpacking depends on a jailbreak + a dumper/Frida generation match**: unpack tools are sensitive to the frida-server version — Frida 17 removed the static `Module` lookup/enumeration API, and a dumper agent that depends on the old API errors immediately; on a dump failure, first check the [[re-frida]] tool setup against the generation from `frida --version`; on an A12+ device's arm64e, frida needs a server for that architecture
- **The unpacked product has cryptid 0 but the code still looks wrong**: a decrypted Mach-O may keep an encryption stub or an abnormal section order — that is normal. Trust the actual decompilation. Some apps have anti-dump checks (re-encrypted after a restart). If one dump fails, try several times and keep the process alive
- **Without a jailbreak you cannot get an encrypted app**: an App Store encrypted binary cannot be unpacked with no jailbreak and no managed device — static analysis (strings/symbols) goes first, and the dynamic surface is explicitly given up (SKILL.md pitfall 3)

## class-dump tool-family pitfalls

- **arm64e (PAC) interferes with metadata walks**: class-dump crashes or prints nothing on arm64e — switch to a newer build or class-dump-swift, or unpack first; PAC is an A12+ device product. Simulators and old devices do not have this problem
- **Swift methods do not enter ObjC headers**: Swift classes do not export ObjC runtime metadata — find symbols with `strings` / `swift-demangle`, or export Swift declarations directly with class-dump-swift (SKILL.md pitfall 4)
- **The brew formula was removed**: `brew install class-dump` reports No available formula from 2026 (removed from homebrew-core); the latest nygard/class-dump release 3.4 is source only — follow tool setup and build from source, or use class-dump-swift. Do not keep fighting brew
- **A dump on an encrypted binary only gets shell classes**: when `cryptid 1`, unpack first and then dump — if the order is reversed, the output is always the shell's classes (SKILL.md pitfall 1)

## Jailbreak-environment pitfalls

- **The default ssh password is alpine**: after OpenSSH is installed and not configured, it is root/alpine; change it on the device side, but record the current credentials in the analysis environment
- **A failed usbmuxd forward: look at the service first**: on Linux, `systemctl status usbmuxd` / a manual `usbmuxd -f` confirms the daemon; if `iproxy` reports a bind failure, change the local port
- **A jailbreak-detection target's behavior jumps**: after the sample detects a jailbreak environment (Cydia paths, fork checks, sandbox-escape probes) it degrades or exits — identify the check points statically first ([[re-ios-jb]]), then decide to bypass or change how you observe; the jailbreak environment itself is part of the evidence chain. Record the device and the jailbreak-tool version

## Version differences

- **class-dump (nygard/class-dump)**: latest 3.4 (not updated after 2022), source only; `brew install class-dump` is no longer usable. The substitute class-dump-swift (mxms0/class-dump-swift) has not been updated for a long time (no commits after 2017). Evaluate it before use. It supports Swift
- **usbmuxd → libusbmuxd (homebrew)**: macOS `brew install usbmuxd` no longer works (the formula was renamed). Use `brew install libusbmuxd`; on Linux the Debian/Ubuntu package name is still `usbmuxd` (includes iproxy), and Arch is `libusbmuxd`
- **frida-ios-dump (legacy)**: the agent in `AloneMonkey/frida-ios-dump` depends on the static `Module` / static `Memory` API of Frida 16 and below, and is unusable on Frida 17 — keep it as a reference for the unpack algorithm and Mach-O rebuild logic; using it directly needs an old Frida or a port you do yourself. The current default picks a maintained implementation already adapted to the current Frida, by target iOS / jailbreak version (the [[re-frida]] common pitfall "Frida 17 removed the static Module lookup/enumeration API")
- **Jailbreak tools and iOS versions**: unc0ver (iOS 11.0-14.8, tiered A7-A14; last build v8.0.2/2022, discontinued), palera1n (the whole checkm8 device line), Dopamine (the iOS 15-16 line) — pick by device model and iOS version. A mismatched tool version will not install, or only half-jailbreaks

## Usage notes

- Static analysis may skip the sandbox (top principle in [[re-analyze/platform-tips]]); dynamic analysis on a jailbroken device runs in a controlled environment
- Archive sha256 and timestamps of unpacked products / headers / signature info ([[re-triage]]); write conclusions into [[re-analyze/analysis-contract]]
- Version-dependent behavior (jailbreak tools, frida, signature rules) follows what the target version actually does
