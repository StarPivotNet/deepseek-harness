---
name: re-ios-jb
description: >
  iOS jailbreak reversing environment: identifying and bypassing jailbreak detection, tweak analysis and development.
  Triggers: `越狱`, jailbreak, tweak, Theos, `LLDB 远程`
capabilities: [jailbreak-analysis]
---

# iOS jailbreak reversing environment (jailbreak detection / tweak)

## When to use / when not to use

- Use: the target app has jailbreak detection (crash on launch / features restricted), and you need to identify the check points and analyze the implementation
- Use: an existing tweak / Substrate plugin needs reverse analysis of what it hooked
- Use: dynamic analysis on a jailbroken device ([[re-frida]] instrumentation, [[re-lldb]] remote attach) — the jailbreak environment is the prerequisite
- Use: you develop a tweak yourself (Theos + Logos) to assist reversing (hook a check function to test a hypothesis)
- Do not use: iOS dynamic analysis with no jailbroken device (static first; see [[re-ios]] pitfall 3)
- Do not use: you only want app static structure / unpacking (go to [[re-ios]])
- Note: jailbreak and dynamic execution follow the top principle in [[re-analyze/platform-tips]] and happen on a controlled device (a dedicated test device, not a daily/production device)

## Tool setup

Jailbreak/dynamic analysis is dynamic execution: a controlled device + network isolation (top principle in [[re-analyze/platform-tips]]). Static work (tweak binary analysis) needs no sandbox. Verify every tool before use.

### Jailbroken device (palera1n and similar)

- **palera1n has no distro package**. Official install path ([docs.palera.in](https://docs.palera.in)):
  ```sh
  # official one-shot script (recommended)
  sudo /bin/sh -c "$(curl -fsSL https://static.palera.in/scripts/install.sh)"
  # or download the binary by hand from GitHub releases (palera1n/palera1n)
  curl -LO https://github.com/palera1n/palera1n/releases/download/v2.0.2/palera1n-linux-x86_64
  chmod +x palera1n-linux-x86_64 && sudo mv palera1n-linux-x86_64 /usr/bin/palera1n
  ```
- Limit: only checkm8-vulnerable devices (A8–A11) and the iOS versions they support (version matching is pitfall 2); **running it inside a VM segfaults** (unusable without PCI passthrough)
- Verify: `palera1n --help`; after jailbreak, Sileo appears on the device (the rootless package manager)
- After jailbreak, install OpenSSH: search "openssh" in Sileo and install it

### Theos — tweak build toolchain (official git install, no distro package)

- Official install ([theos.dev/docs/installation](https://theos.dev/docs/installation), **must be a git install; the official docs explicitly say do not download the ZIP**):
  ```sh
  export THEOS=~/theos
  git clone --recursive https://github.com/theos/theos.git $THEOS
  echo "export THEOS=~/theos" >> ~/.zprofile && echo "export PATH=$THEOS/bin:$PATH" >> ~/.zprofile
  ```
- Dependencies: macOS `brew install ldid xz`; Linux needs packaging dependencies such as `sudo apt install dpkg-dev fakeroot` (Debian/Ubuntu)
- iOS SDK: `curl -LO https://github.com/theos/sdks/archive/master.zip`, unpack the `*.sdk` files into `$THEOS/sdks`
- Update: `$THEOS/bin/update-theos` (rolling release)
- Verify: `$THEOS/bin/nic.pl` can list the New Instance Creator templates

### frida ([[re-frida]]) — instrumentation and bypass execution

- Jailbroken device: add the source `https://build.frida.re` in Sileo/Cydia and install frida; or install after `ssh root@<device IP>`
- Host: `pip install frida-tools`
- Verify: `frida-ps -U` lists device processes

### Remote lldb ([[re-lldb]]) + usbmuxd/iproxy

- lldb: macOS `xcode-select --install` (bundled); Linux `apt install lldb` / `dnf install lldb` / `pacman -S lldb`
- usbmuxd/iproxy: macOS `brew install usbmuxd`; on Linux **iproxy is in the libimobiledevice-utils package** (Debian/Ubuntu/Fedora) / **the libimobiledevice package** (Arch). Installing only usbmuxd does not include iproxy: `apt install usbmuxd libimobiledevice-utils` / `dnf install usbmuxd libimobiledevice-utils` / `pacman -S usbmuxd libimobiledevice`
- Verify: `lldb --version`; after `iproxy 2222 22`, `ssh -p 2222 root@127.0.0.1` can log into the device
- Device-side debug service debugserver: provided by the jailbreak tool / DeveloperDiskImage (see [[re-ios]] and [[re-lldb]])

## Procedure

Run in order. Record an evidence path + sha256 for each step's products (device info, hook list, tweak analysis notes) (see [[re-triage]]) so the report can cite them.

1. **Build the jailbreak environment (device / toolchain)**:
   ```sh
   # device: enter palera1n from DFU mode
   sudo systemctl stop usbmuxd && sudo usbmuxd -f -p &    # some environments need usbmuxd restarted
   sudo palera1n                                          # rootless is the default, no flag needed (the v2 option set [-DEhpvVdsSLRnPI] has no -l)
   # after jailbreak: install OpenSSH from Sileo → forward → log in
   iproxy 2222 22 &
   ssh -p 2222 root@127.0.0.1                              # default password alpine (change it immediately after rootless)
   ```
   - Toolchain: install Theos (tool setup) + the SDK; frida-server is installed through Sileo
   - Record: device model, iOS version, jailbreak tool and version, the rootless mount prefix (palera1n rootless is `/var/jb`)

2. **Identify and bypass jailbreak detection**:
   - Static identification: strings in the app binary for jailbreak-path features (`/Applications/Cydia.app`, `/usr/sbin/sshd`, `/var/jb`, `cydia://`, and similar). [[re-ghidra]] / [[re-ida]] follow xrefs to the check function
   - Dynamic identification (fast) — frida batch-hooks the APIs checks commonly use and records the paths that were queried:
     ```js
     // hook.js —— record which jailbreak-feature paths the app checked
     ['access', 'stat', 'lstat', 'open', 'dlopen'].forEach(function(n) {
       var f = Module.findGlobalExportByName(n);      // Frida 17+: the old Module.findExportByName(null, n) was removed
       if (f) Interceptor.attach(f, { onEnter: function(a) {
         var p = (n === 'dlopen') ? a[0] : a[0].readCString();   // read a C string with the NativePointer instance method (Memory has no readCString)
         if (p && (p.indexOf('Cydia') >= 0 || p.indexOf('/var/jb') >= 0 || p.indexOf('jb') >= 0))
           console.log(n, '->', p, 'ret_pending');
       }});
     });
     ```
   - Common check families: file/directory existence, URL scheme (cydia://), the parent process after `fork()`, a write test outside the sandbox (`/private/`), a jailbreak-detection library (a jailbreak detection SDK); bypass = change the return value at each check point (frida or a tweak). See pitfall 3
   - Product: a check-point list (path/API/location + bypass plan)

3. **Tweak analysis (MobileSubstrate/Substrate hook)**:
   ```sh
   # an existing tweak deb: unpack and look at the dylib + the filter plist
   dpkg-deb -x tweak.deb /tmp/tweak/                      # install dpkg on Linux/macOS, or unpack with ar
   find /tmp/tweak -name "*.dylib" -o -name "*.plist"
   cat /tmp/tweak/Library/MobileSubstrate/DynamicLibraries/*.plist   # Filter: which processes are hooked
   ```
   - Reverse the dylib: strings for class/method names (Logos `%hook ClassName` keeps the class-name string) → locate with [[re-ghidra]] / [[re-ida]]
   - Substrate principle: `MSHookMessageEx` (an ObjC method) changes the class-method implementation pointer; `MSHookFunction` (a C function) changes the function-head jump — in the decompilation, find `MSHookMessageEx` / `MSHookFunction` call sites. The arguments (target class/method/new implementation address) are the hook list
   - After Logos syntax `%hook` / `%orig` in a Theos project is expanded, it is those calls (understanding Logos helps read the compiled product)
   - Product: a hook-target list (class/method/what the new implementation does) + the filter condition

4. **Dynamic debugging (remote lldb attach)**:
   ```sh
   iproxy 1234 1234 &                                      # forward the debug port
   # device side: after the target app starts, run debugserver as root and attach
   # host side:
   lldb
   (lldb) platform select remote-ios
   (lldb) process connect connect://127.0.0.1:1234
   (lldb) process attach --pid <pid>                       # or by process name
   (lldb) image lookup -n '-[ViewController viewDidLoad]'  # symbol lookup ([[re-lldb]])
   (lldb) breakpoint set -n ptrace                          # anti-debug function breakpoint (see pitfall 4)
   ```
   - On a jailbroken device, frida `-U -f <bundleID>` spawn mode can also cover early logic
   - Product: a breakpoint list + disassembly/register scene of key functions

5. **Unpack and analyze (together with [[re-ios]])**:
   - If the target app is an App Store encrypted binary (`otool -l` shows cryptid 1) → unpack first per [[re-ios]] step 5 (FairPlay decrypt; pick the backend for the target iOS / Frida generation). After unpacking, return to steps 2-3 for static work
   - Unpack/re-sign: a free certificate is valid for 7 days ([[re-ios]] pitfall 2). A repack uses an adhoc re-sign, or an unpack tool outputs an installable ipa directly
   - Product: the unpacked ipa (cryptid 0 verified) + sha256

## Cross-domain

- [[re-ios]]: unpack (FairPlay decrypt), static analysis (class-dump / Mach-O), signature — the static base of this skill
- [[re-frida]]: spawn/attach instrumentation, hook check APIs and JNI/ObjC functions, bypass execution
- [[re-lldb]]: remote attach, breakpoints, expressions, symbol lookup (debugserver + iproxy)
- [[re-mobile]]: the gateway — dynamic analysis on a jailbroken device is the environment prerequisite of re-mobile workflow steps 3-4
- [[re-binary-core]]: the decompiler base for a tweak dylib / app binary ([[re-ghidra]] / [[re-ida]])
- [[re-analyze]]: called by the "mobile app analysis" path in triage (re-mobile → iOS dynamic → this skill)
- [[re-analyze/platform-tips]]: the controlled-device top principle for jailbreak/dynamic execution; [see the macOS/iOS branch]

## Common pitfalls

- **After jailbreak, system integrity is still restricted**: symptom — the jailbreak succeeded but some paths cannot be written, tweak injection does not take effect, and the app still behaves "sandboxed"; cause — iOS system-integrity protection (AMFI / SSV signed volume) is still on. A rootless jailbreak (the palera1n 2.x default) deliberately keeps the system volume read-only, and every jailbreak change is under the `/var/jb` prefix; fix — be clear about rootless vs rootful: under rootless, dependencies, tweaks, and frida are all in `/var/jb`, and writing system-partition content does nothing; an old tool that needs to write the system partition must be confirmed rootless-compatible, or use rootful mode (only older iOS supports it)
- **Device version matching (toolchain version)**: symptom — palera1n reports unsupported, a Theos-built tweak installs and does nothing, frida-server fails to start; cause — palera1n only supports specific iOS versions on A8–A11; the Theos SDK version does not match the device iOS; the frida-server version does not match the host frida; fix — before jailbreak, check the official support matrix (docs.palera.in) and pick the tool by device/iOS; download the SDK for the matching iOS major version (theos/sdks); frida-server and the host `frida --version` match exactly ([[re-frida]] pitfall 1); back up before the jailbreak. A failed DFU can be retried
- **Detection countermeasures (a jb detection library)**: symptom — the app crashes as soon as it runs / says "device not supported", and frida cannot attach in time; cause — the app integrates jailbreak detection (file paths / URL scheme / a fork test / a jailbreak detection SDK), and the check runs early at startup; fix — spawn mode catches the early phase (`frida -U -f <bundleID>`), and bypass item by item against the hook list in step 2; analyze the detection library statically first (strings + xref). Dynamic work only verifies; record the bypass plan before applying it (controlled device in [[re-analyze/platform-tips]])
- **Debugger detection**: symptom — after lldb attach succeeds, the app exits immediately / stops responding / goes white; cause — the app detects ptrace (`ptrace(PT_DENY_ATTACH)`), the P_TRACED flag from `sysctl`, getppid, and similar anti-debug methods; fix — breakpoint `ptrace` / `sysctl` first and change the return value (the step 4 example), or write an anti-anti-debug tweak in Theos for a global bypass; on a jailbroken device some checks also target the debugserver process name. Rename/hide it when needed
- **A double check**: symptom — after the jailbreak detection is bypassed it still crashes; cause — jailbreak detection is stacked with SSL pinning; fix — disable both at once. Do not handle only one
- **Hooking a system function hits yourself**: symptom — after hooking stat the app hangs; cause — a system-level hook affects normal logic; fix — filter by caller, and hook only calls triggered by the app's own code
- **The certificate-trust switch**: symptom — after installing a mitmproxy certificate there is still an SSL error; cause — iOS 14+ needs the certificate trust setting turned on by hand; fix — after installing the certificate, go to General → About → Certificate Trust Settings and enable it
- **A jailbreak-detection hook template**: symptom — a common check needs a quick bypass; cause — common checks concentrate on file existence and process-capability queries; fix — intercept the file-existence check (a jailbreak path list returns not-present) + fork returns -1 (a jailbroken device can fork; a non-jailbroken device returns -1)
- (Source: reverse-skill field-journal, MIT)
