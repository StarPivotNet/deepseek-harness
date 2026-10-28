# macOS low-level branch: KEXT / DriverKit (DEXT) / System Extension / kernel collections

<CORE RULE>
The macOS pitfall is that **three completely different low-level models are mixed together**:

| Model | Where it runs | Era |
|---|---|---|
| KEXT + IOKit | **kernel mode** | traditional |
| DriverKit / DEXT | **user mode** | modern drivers |
| System Extension | **a user-mode framework** (it can host DriverKit / EndpointSecurity / NetworkExtension) | modern system capability |

Apple is explicit: a KEXT is in kernel mode, and DriverKit and System Extension are in user mode; from macOS 11 on, a function that can be done with a System Extension / DriverKit usually no longer takes the KEXT path. **So the first rule is not "disassemble first", but confirm which generation you are reversing.**

Four facts that most easily send the whole analysis chain off course:
① **a codeless KEXT may have no code at all**;
② **the KEXT on disk and the one currently running may be two versions** (AuxKC);
③ **an arm64e pointer cannot be interpreted as an ordinary 64-bit function pointer** (PAC);
④ **an `IOServiceOpen` failure may stop at the entitlement / activation layer**, and never reach your UserClient.
</CORE RULE>

## 1. Classify first (it decides everything after)

`KEXT` / `codeless KEXT` / `DEXT(DriverKit)` / `System Extension` — the four models differ, and one misclassification makes everything after it wrong.

## 2. KEXT: `Info.plist` first, do not disassemble first

The `Info.plist` under `Foo.kext/Contents/` is extremely valuable, because **`IOKitPersonalities` describes the match conditions directly**:

`IOClass` / `IOProviderClass` / `IONameMatch` / `IOPCIMatch` / `IOPCIPrimaryMatch` / `IOKitDebug` / `CFBundleIdentifier` / `OSBundleLibraries`

IOKit's matching model is "a personality dictionary decides which driver can bind which provider"; a PCI personality even contains the vendor / device ID match rules directly.

The correct order:

```
Info.plist → decide IOClass / Provider / hardware match → decide dependencies
  → Mach-O → recover the C++ class hierarchy → find Start / Stop / newUserClient / externalMethod
```

**And not chewing the CFG from `_start`.**

## 3. A codeless KEXT: no Mach-O does not mean the file is broken

Apple officially supports a **codeless KEXT**: it can have no executable at all, and do hardware matching from `Info.plist` alone, handing the device to an existing system driver.

```
Foo.kext/ └── Info.plist        (no Contents/MacOS/Foo — legal)
```

The correct analysis: `IOKitPersonalities` → `IOProviderClass` → matching properties → **which Apple driver it finally matches** → analyze the driver that actually runs. Do not waste time looking for "the payload that disappeared".

## 4. The KEXT on disk ≠ the KEXT currently running (worse than a Linux `.ko`)

- From macOS 11 on, a third-party KEXT is **no longer loaded on demand**; it enters an **Auxiliary Kernel Collection (AuxKC)** and is loaded with boot
- After a KEXT update, even if `/Library/Extensions/Foo.kext` is already the new version, **the machine may still be executing the old version until reboot**
- Unload is the same: `kmutil unload` / `kextunload` **does not mean it is pulled out of the running kernel immediately** — the new kernel collection takes effect only after a reboot, and the old KEXT may stay alive until then
- So "I clearly patched this KEXT, why is the behavior still the old one?" → **suspect disk = version B / running AuxKC = version A first**, not "the patch did not take / the analysis is wrong / the cache was not flushed"
- Runtime reversing has to distinguish at least three copies: **the bundle on disk / the image in the AuxKC / the image actually mapped in the current boot** (compare the running UUID with the disk UUID)
- Corollary: a reversing experiment that ignores this gets false results very easily — "the tool shows unload was requested" ≠ "the code is gone now"

## 5. Apple Silicon: arm64e and PAC are not obfuscation

- An Apple Silicon KEXT must support **arm64e**, so `pacibsp` / `autibsp` / `pacia` / `autia` / `braa` / `blraa` / `retab` appear often, along with pointers whose "high bits look wrong"
- **Do not** treat a 64-bit raw value as an ordinary canonical pointer — especially a **vtable / function pointer / callback / return address**
- A common misread: "the function pointer does not look like it is in `__TEXT_EXEC` → the pointer was corrupted" — it may only be a **PAC-signed pointer**
- Conclusion: **class / vtable reconstruction must be PAC-aware**

## 6. The point of a KEXT is the IOKit class graph, not an ordinary call graph

- A typical C++ IOKit lifetime: `OSObject → IORegistryEntry → IOService → YourDriver`, mainly around `init` / `probe` / `start` / `stop` / `free`
- What is really valuable is: **class hierarchy, vtable, OSMetaClass, the IOService inheritance chain**, not "which function is called the most"
- **One KEXT alone is not necessarily enough to recover the full class hierarchy** — it depends on the kernel and on other IOKit families' class / vtable; the practical method is to recover the kernel / dependency class metadata first, then attach this KEXT's classes back onto the full hierarchy
- So "a lot of unresolved virtual calls inside one KEXT" is not necessarily "stripped too hard"; **you may simply not have its kernel / superclass type universe**

## 7. The attack surface follows `newUserClient` first

```
IOService → newUserClient() → IOUserClient subclass → externalMethod()
```

The user-mode entry: `IOServiceOpen` → `IOConnectCallMethod` / `IOConnectCallScalarMethod` / `IOConnectCallStructMethod` / `IOConnectCallAsyncStructMethod`.

Practical strategy: **recover the `selector → handler` map first**, rather than analyzing the whole hardware implementation first.

## 8. A selector is not a function address; dispatch does an ABI check before the handler

- DriverKit keeps the same core model: `ExternalMethod(selector, arguments, dispatch, target, reference)` (when called inside the driver, `dispatch` is NULL; when non-NULL, arguments are checked against dispatch first, then its `function` is called)
- **Watch the field-name prefix**: the fields in the dispatch structure are `function` / `checkCompletionExists` / `checkScalarInputCount` / `checkStructureInputSize` / `checkScalarOutputCount` / `checkStructureOutputSize` (**with `check`**); the unprefixed `scalarInputCount` / `structureInputSize` / … are fields of **arguments** (`IOUserClientMethodArguments`); do not mix the two
- The kext-side dispatch table is positional (an 8-byte function pointer + four uint32s); a variable-length structure uses `kIOUCVariableStructureSize`
- **`kIOReturnBadArgument` is not necessarily returned by the handler itself**: the framework rejects against dispatch before the handler actually runs (scalar count / structure size / completion). Check order:

```
is the selector right → is the dispatch entry right → is the scalar count right → is the structure size right
  → is the async completion right → only then enter the handler itself
```

- In particular, when `checkCompletionExists = true`: **completion needs a valid notification Mach port** (the `IONotificationPortCreate` + `IONotificationPortGetMachPort` class); passing the wrong port (for example the main / master port) also yields `kIOReturnBadArgument` — that is not a logic problem in the handler
- DriverKit async: `IOUserClient::AsyncCompletion` replaces the kext's `sendAsyncResult64()`; note that **a small `structureOutput` (≤4096 bytes) cannot be filled asynchronously**, and must be returned immediately by `ExternalMethod` (only a large buffer that can go through `structureOutputDescriptor` can be filled later)

## 9. `IOServiceOpen` failed: check the authorization chain first, and suspect the selector last

```
does the service really exist → is the DEXT active → did matching succeed
  → entitlement → Team ID / signature → sandbox → UserClient policy
  → only then a selector / protocol problem
```

- Entitlement names: the client `com.apple.developer.driverkit.userclient-access` (declares which DriverKit services may be accessed); the driver side `com.apple.developer.driverkit.allow-any-userclient-access` (allows any application to connect)
- Common symptoms of this failure: `provider entitlements check failed` / `IOUserServer(...)::exit(Entitlements check failed)`

## 10. Do not reverse a `.dext` as a KEXT (user-mode model)

A DriverKit driver is essentially a **user-mode** extension, not a ring-0 module. The analysis model:

```
Mach-O userspace executable → DriverKit generated / runtime code → IOService subclass
  → IOUserClient → DriverKit IPC → kernel-mediated device access
```

**Signals to stop the KEXT model immediately**: Foundation / an ordinary user-mode runtime, ordinary Mach ports, a SystemExtension host app.

The debug model changes with it: **a dext can be debugged as an ordinary process** (a user-mode debugger), and a breakpoint will not stop the whole machine's kernel with it.

## 11. System Extension is not a synonym for DriverKit

`DriverKit` / `EndpointSecurity` / `NetworkExtension` can all run as a System Extension.

Seeing `*.systemextension` **cannot** be inferred to mean "a hardware driver" — a System Extension itself is only the install / lifetime framework of a "high-privilege user-space extension", and the business semantics may belong to a completely different API. Look first at: **entitlements / linked frameworks / bundle metadata**.

## 12. When the Host App and the DEXT are separate, reverse both

```
Host.app/Contents/Library/SystemExtensions/Foo.dext
```

The Host app is responsible for activation (it submits an activation request with the SystemExtensions framework), and the DEXT is responsible for the driver. A complete RE should analyze both:

- **Host app**: installation / activation, IOService discovery, `IOConnect` calls
- **DEXT**: matching, ExternalMethod, the actual driver

**The selector and the input structure are often easier to recover on the client-app side.**

## 13. "The DEXT file exists" ≠ "the DEXT is already running"

A System Extension has its own activation lifetime, and the six states must be kept separate:

```
bundle exists → registered → approved → activated → matched → started
```

`Foo.dext` existing inside an `.app` only means "the installer package contains it"; registration / approval / activation / matching / start each have to be checked (bundle identifier, filename, Team ID, signature, and notarization all have to satisfy the rules).

## 14. On Apple Silicon a KEXT cannot rely on Rosetta

- Apple's documentation is explicit: **Rosetta does not translate kernel extensions** (and it does not translate a VM app for a virtualized x86_64 platform)
- An x86_64 kext fails to load on Apple Silicon:

```
Error Domain=KMErrorDomain Code=71
"Incompatible architecture: Binary is for x86_64, but needed arch arm64e"
```

- This is **not** a security setting / SIP / permission problem — only the developer can rebuild it as arm64e (or universal)
- So "the host app starts normally but the driver never loads" is not a UserClient bug, and it is not you using the wrong API

## 15. Kernel Collection: the runtime is not "one kernel + a pile of bundles loaded independently at any time"

- A modern macOS runtime involves **Kernel Collections**: the kernel / Apple KEXTs / third-party KEXTs (third-party goes through **AuxKC**)
- Address attribution, KEXT inventory, symbolication, and a runtime-vs-disk comparison all have to count the KC structure
- Contrast: it is not the Linux model of `insmod → runtime relocate → it appears immediately`

## 16. Panic symbolication: `__TEXT` vs `__TEXT_EXEC`

- On arm64 / arm64e, a KEXT load address in a panic **cannot be used directly as the code image base**
- A common layout: `__TEXT` starts at 0, and the executable code is in `__TEXT_EXEC` → **`__TEXT_EXEC.vmaddr` must be added to the load address** before handing it to `atos -l`

```sh
# take the vmaddr of __TEXT_EXEC (for example 0x4000)
otool -arch arm64e -l Foo.kext/Contents/MacOS/Foo | grep -A4 __TEXT_EXEC
atos -arch arm64e -o Foo.kext.dSYM/Contents/Resources/DWARF/Foo \
     -l <load_address + __TEXT_EXEC.vmaddr> <panic_addr>
```

- Without that offset, `atos` / `lldb image lookup` returns garbage (for example it resolves into `__TEXT.__cstring` instead of an instruction)
- A kernel backtrace is isomorphic: compute the difference between `__TEXT_EXEC.vmaddr` and the first segment first, then **subtract** it from the panic's "Kernel text exec base", and run atos with the base you get

## 17. Symbolication must match UUID / build, not only the version number

- A panic / crash report records the related image's **UUID** and address range; in the crash-report format the UUID is "the build identifier used to match the corresponding symbol file / dSYM"
- The same version number (`Foo.kext 1.2.3`) is **still not enough** — it takes **UUID + architecture + exact build**
- Symptom check: "the function name is roughly right, the line number is weird, the offset keeps drifting" → the symbol file is probably not the same build

## 18. A KEXT will not enter the kernel: a legal signature ≠ the system will load it

On Apple Silicon a traditional KEXT is constrained by the whole boot policy:

```
Reduced Security (1TR mode downgrade + check allow user management of kernel extensions + administrator password)
  + user approval + UAKL + AuxKC rebuild + reboot
```

- **UAKL** (User-Approved Kernel Extension List): the SHA384 hash of the user-authorized kext list goes into LocalPolicy; on the kernel side kmd checks that **only a kext inside the UAKL can enter the AuxKC**
- **SIP and signature**: with SIP on, each kext's signature is checked before it enters the AuxKC; with SIP off it is not enforced (permissive security, used to test an unsigned kext)
- **AuxKC integrity**: after creation its measurement is signed by the Secure Enclave into an **Image4** structure and evaluated by iBoot at boot; a kext receipt is also generated (it may be smaller than the UAKL because kexts were disabled), and its hash goes into LocalPolicy
- So "it will not load at all" has to be judged separately: **architecture / code signature / user approval / UAKL / boot security policy / AuxKC inclusion**

## 19. SIP off ≠ every Apple Silicon restriction is gone

Do not treat macOS as "SIP off equals Linux root". Above that layer there is still: secure boot policy / LocalPolicy / AuxKC measurement / **KIP** / PAC.

- **KIP (Kernel Integrity Protection)**: enabled after kernel initialization completes; iBoot loads the kernel and kexts into a **protected physical-memory region**, and after boot completes **the memory controller refuses writes to that region**, while the MMU also blocks "mapping privileged code from outside the region" and "a writable mapping inside the region"; hardware that enables KIP is **locked** after boot (so `csrutil disable` is not "patch the kernel freely")
- Related: PPL (iOS / iPadOS / watchOS), **SPTM / TXM** (A15+ / M2+ and later), SCIP (coprocessor firmware), KTRR
- Before a dynamic patch / hook experiment, figure out which layer you are hitting: **SIP / KIP / secure boot / PAC / code signing**

## 20. Rootkit / malware analysis: landing sites are not only a syscall hook, and they are strongly era-dependent

- Historical KEXT rootkit landing sites: `syscall`, **`kauth`**, IOKit, process structures, the network stack, inline patch, **kernel symbol lookup** (public cases: a malicious KEXT resolves kernel symbols and modifies kernel state to hide a process)
- **The era difference must be part of the judgment**:

```
10.x Intel          ≈ the traditional KEXT world
11+ Intel           ≈ the KC / modern-policy transition
11+ Apple Silicon   ≈ arm64e + PAC + AuxKC + a strict boot policy
```

- On modern Apple Silicon, "load an arbitrary KEXT → inline-patch the kernel" is already much harder than on old Intel
- **A 2012 KEXT rootkit technique cannot be used directly to explain 2026 Apple Silicon** — sample behavior is strongly related to the era

## 21. Dynamic debugging: a KEXT was always meant for two machines, while a DEXT is debugged as an ordinary process

- Apple is explicit: a KEXT / the kernel **cannot be debugged on the same machine the way an ordinary user-mode process can** (the debugger itself also depends on the kernel). The official options: logs / **two-machine KDP + LLDB** / a panic core dump / a **KDK** (matching kernel symbols); when an early or deadlock scene is needed, trigger an **NMI** so the target stops and waits for the remote debugger (the Apple Silicon NMI key combination and boot debug flags have official documentation)
- So "attach lldb to the kernel failed" **must not** be chased down the ordinary userspace anti-debug path
- The other way around is DriverKit's biggest difference: **a dext is in user mode → prefer a userspace debugger**, and do not start by building a two-machine KDP environment

## Decision tree

```
Got a macOS low-level target
├─ classify first: KEXT / codeless KEXT / DEXT(DriverKit) / System Extension
├─ KEXT
│    ├─ Info.plist / IOKitPersonalities (IOClass / Provider / match)
│    ├─ Mach-O architecture (arm64e? PAC?)
│    ├─ class / vtable / OSMetaClass (needs the kernel / dependency type universe)
│    ├─ IOService lifetime init / probe / start / stop / free
│    └─ newUserClient → externalMethod (the selector table first)
├─ no executable → codeless KEXT → find the system driver it actually matches
├─ disk contents and runtime behavior disagree
│    ├─ is the AuxKC still the old version? did the reboot finish? disk UUID vs running UUID?
├─ Apple Silicon constraints
│    ├─ arm64e? PAC? KIP? Reduced Security? UAKL / AuxKC / LocalPolicy?
│    └─ x86_64 kext → KMErrorDomain 71 (Rosetta does not translate a kext)
├─ a UserClient cannot be called
│    ├─ is the service matched / started → selector → dispatch (count / size / completion)
│    ├─ entitlement → Team ID → sandbox
├─ symbolication is wrong
│    ├─ UUID / exact build (KDK) / architecture / __TEXT vs __TEXT_EXEC / runtime load address
└─ dynamic debugging
     ├─ KEXT / kernel → KDK + two-machine KDP / LLDB or a panic core
     └─ DEXT → userspace debugger
```

## Tools and verification

- Structure: `otool -l` (segments and `__TEXT_EXEC.vmaddr`), `vmmap`, `ioreg` (IORegistry: who bound which device), `codesign -d --entitlements :-`
- Collection and lifetime: `kmutil` (kext and kernel collection), the extension list in System Information / System Settings (UAKL / approved items)
- Symbolication: `atos -arch arm64e -o <dSYM> -l <adjusted base>`, `lldb image lookup` (adjust the base per §16 first)
- Debugging: KEXT → KDK + two-machine KDP / LLDB; DEXT → a userspace debugger (lldb attaches to the process directly)
- Verification: be able to state together "which generation of model + which copy of the version (disk / AuxKC / running) + the authorization-chain state of that pipeline (signed / approved / activated)"

## Pitfalls on this platform

- **Treating a dext as "a new kext"**: it runs in user mode, and both the analysis model and the debug model differ
- **Analyzing only the kext on disk**: align the disk / AuxKC / running versions and UUIDs first
- **Assuming the code is gone after `kextunload`**: it may still be running until reboot
- **Treating a codeless kext as a broken package**: reverse the system driver it actually binds
- **Treating arm64e PAC instructions as obfuscation / treating a PAC pointer as corruption**
- **`IOServiceOpen` will not connect, so suspect the selector**: check activated / entitlement / Team ID / sandbox first
- **Treating `kIOReturnBadArgument` as a logic failure in the handler**: check the dispatch count / size / completion first (including the notification port)
- **Treating every `*.systemextension` as a hardware driver**: look at entitlements and linked frameworks first
- **Reversing only the .dext and not the Host app**: the selector and the input structure are often easier to recover on the client side
- **Subtracting the KEXT base directly for panic symbolication**: `__TEXT_EXEC.vmaddr` was missed
- **Using the version number as a build match**: it takes UUID + arch + exact build (KDK)
- **A legal signature means it can load**: it also takes UAKL / user approval / Reduced Security / AuxKC rebuild / reboot
- **Assuming SIP off means the kernel can be patched freely**: there is still KIP / secure boot / LocalPolicy / PAC
- **Applying an old Intel KEXT rootkit technique to Apple Silicon**
- **Grinding same-machine debugging on a KEXT**: a KEXT was meant for two machines (KDK + KDP); but a DEXT can use a user-mode debugger directly
