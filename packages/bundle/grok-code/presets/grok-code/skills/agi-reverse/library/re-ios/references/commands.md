# iOS app-analysis command cheat sheet and operation sequences

The tool family has four layers: unpack and signature check (unzip/file/codesign/otool), header export (class-dump / class-dump-swift), device channel (usbmuxd's iproxy + libimobiledevice's idevice_*), FairPlay decrypt/unpack (pick a backend for the environment + [[re-frida]]). Commands and parameters follow the official docs (nygard/class-dump, mxms0/class-dump-swift, libimobiledevice, and the chosen dumper's repo docs).

## Command-family cheat sheet

### Unpack and signature check

- `unzip app.ipa -d app/` unpacks the ipa (zip format)
- `file app/Payload/*.app/*` confirms the main binary architecture (arm64 / arm64e on device; x86_64 is a simulator product)
- `codesign -dv <App.app> 2>&1` signature type (Apple Distribution / Development / adhoc) and Team ID
- `codesign -d --entitlements - <App.app> 2>&1` exports entitlements (see the permission surface before debug/bypass)
- `security cms -D -i app/Payload/*.app/embedded.mobileprovision` reads the provisioning profile (macOS; includes certificate expiry and the device allowlist)
- `otool -l <App.app> | grep -B1 -A4 LC_ENCRYPTION_INFO` checks the encryption marker (cryptid 1 = App Store encryption)

### class-dump / class-dump-swift (ObjC/Swift headers)

- `class-dump -H <App.app> -o headers/` exports ObjC class headers (methods/properties/protocols)
- `class-dump-swift -H <App.app> -o headers/` Swift + ObjC metadata (prefer this for a Swift target)
- `class-dump --help` to verify; class-dump 3.4 is source only (xcodebuild), class-dump-swift is a source build (depends on LLVM + make, not the Swift toolchain)

### otool / llvm-otool (Mach-O structure)

- `otool -h <App.app>` architecture / cputype; `otool -L <App.app>` dependent dylib / framework list
- `otool -l <App.app>` all load commands; `otool -ov <App.app>` ObjC runtime segments (objc_classlist and others)
- Linux substitute: `llvm-otool` (`apt install llvm` / `brew install llvm`), parameters compatible with otool
- Deep parse (segments/entry/signature) goes to [[re-format-macho]]

### idevice toolchain (device channel)

- `idevice_id -l` lists UDIDs of connected devices; `ideviceinfo` device model / iOS version / serial-number class of info
- `iproxy 2222 22 &` forwards device port 22 (SSH) to local 2222 (provided by usbmuxd)
- `ssh -p 2222 root@127.0.0.1` logs into the jailbroken device through the forward (default password alpine)
- `ideviceinstaller -l` lists apps installed on the device (including Bundle ID, used to pick the ID for unpacking)

### Unpack (FairPlay decrypt; pick the backend for the environment)

- After `frida --version` matches the device frida-server, pick a dumper compatible with that Frida generation — Frida 17 removed the static `Module` lookup/enumeration API, and an old dumper that depends on it errors immediately ([[re-frida]] common pitfall)
- Legacy reference implementation `AloneMonkey/frida-ios-dump`: the agent uses old Frida APIs (`Module.ensureInitialized` / static `Memory.read*` / `Module.findExportByName(null, …)` / `Process.enumerateModulesSync`) and needs Frida 16 or below, or a port you do yourself — keep it as a reference for the unpack algorithm and Mach-O rebuild logic
- Another route: implementations based on `mremap_encrypted` (UnFairPlay / unfaird class), which do not depend on runtime instrumentation. Evaluate them against the target iOS version
- Prerequisites: a jailbroken device + frida-server (see [[re-frida]]) + usbmuxd forwarding; confirm parameters from the chosen dumper's `-h` output (BundleID / app name, frida-server port, and so on)

## Common operation sequences (combined playbooks)

### 1. Standard IPA static-analysis flow (unpack → signature → encryption verdict → headers → structure)

```
unzip app.ipa -d app/
file app/Payload/*.app/*                          # confirm arm64 device architecture
codesign -dv app/Payload/*.app/ 2>&1              # signature type
otool -l app/Payload/*.app/ | grep -B1 -A4 LC_ENCRYPTION_INFO   # cryptid
class-dump -H app/Payload/*.app/ -o headers/      # look at ObjC classes first
otool -L app/Payload/*.app/                       # framework dependencies
# cryptid 1 → unpack first (sequence 3), then dump headers; structure detail goes to [[re-format-macho]]
```

### 2. Dynamic debug on a jailbroken device (forward → log in → hook/debug)

```
iproxy 2222 22 &
ssh -p 2222 root@127.0.0.1                        # log into the jailbroken device
# start the target app on the device
# hook/bypass → frida ([[re-frida]], frida-server installed from the same source)
# breakpoint/single-step → debugserver + lldb ([[re-lldb]] remote)
```

### 3. Closed loop for unpacking an App Store encrypted app (pick backend → dump → confirm → rerun static)

```
frida --version                                    # fix the Frida generation first, then pick a matching dumper
iproxy 2222 22 &
<chosen dumper> <BundleID>                         # pull and decrypt (backend chosen for the target iOS / Frida version)
file <output>.ipa
otool -l <output>/Payload/*.app/ | grep -A4 LC_ENCRYPTION_INFO   # confirm cryptid 0
# the unpacked product returns to sequence 1 and is rerun (class-dump / otool / [[re-format-macho]])
```

### 4. Managed-device / no-jailbreak static fallback (boundary handling)

```
# no jailbreak: static first (sequence 1)
# dynamic needed: simulator (unencrypted apps only) or a managed device (Apple Configurator deploy + a development certificate)
# target is App Store encrypted only and there is no jailbreak → give up the dynamic surface; fall back to symbols/strings on the static surface
strings -n 6 <App.app> | grep -iE 'http|api|key'  # strings in an encrypted binary are still readable (outside the code region)
```

## Lessons internalized

- Look at `cryptid` before deciding what comes next: on an encrypted binary, class-dump/decompilation is all shell. Unpack first and save a round of rework
- headers are the first map of the business interface: ObjC class/method names are basically the feature list. Scan headers before going into the decompiler to locate things
- After an iproxy forward, ssh connects straight to 127.0.0.1. Do not treat the device IP as the target address (the forward is the stable channel)
- Jailbreak-detection targets: find the check points statically first ([[re-ios-jb]] jailbreak-detection methodology), then decide a frida bypass or a dynamic-side countermeasure. Do not start with a kitchen-sink hook
- Skip simulator products (x86_64) outright: the whole device dynamic surface (frida/lldb) does not apply, and it wastes time

## Usage notes

- Static work may skip the sandbox; dynamic analysis on a jailbroken device/simulator runs in a controlled environment under the top principle in [[re-analyze/platform-tips]]
- File each step's products (decrypted ipa, headers, signature info) against [[re-triage]]; write conclusions into [[re-analyze/analysis-contract]]
- A free developer signature expires in 7 days — timestamp signature-related results so they are not misjudged
