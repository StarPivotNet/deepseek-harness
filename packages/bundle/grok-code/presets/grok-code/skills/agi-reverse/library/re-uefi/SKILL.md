---
name: re-uefi
description: >
  UEFI/BIOS firmware: SEC/PEI/DXE/BDS stage determination, DXE drivers, UEFI modules, bootkit.
  Triggers: UEFI, BIOS, DXE, PEI, SEC, PEIM, HOB, bootkit, Secure Boot, `EFI 固件`, runtime driver
capabilities: [uefi-analysis]
---

# UEFI firmware reverse engineering (DXE driver / UEFI module / bootkit)

<CORE RULE>
**Treating PE32/PE32+ as an ordinary Windows PE application is the first judgment error this domain must rule out.**

The first step is always **determine the stage and the module type**:

```
SEC → PEI → DXE → BDS → OS / Runtime (+ SMM as its own path)
```

Inside one firmware image, modules from different stages run in **completely different execution environments**: available memory differs, callable services differ (PPI / Protocol / Runtime Services), and lifetime differs (`DXE_DRIVER` and `DXE_RUNTIME_DRIVER` are not the same thing).

So the order is: **determine stage and type first, then talk about logic** — if the type is wrong, every later "why is it written this way" inference is wrong. Details are in [[pi-stages]].
</CORE RULE>

## Stage and module type (classify first)

| Type | Stage | Service form / lifetime |
|---|---|---|
| SEC | earliest | security and init entry; no general memory environment |
| PEIM | PEI | **PPI**; one of PEI's main jobs is to establish permanent memory |
| DXE driver | DXE | **Protocol**; exists only in the boot-services environment |
| **DXE runtime driver** | DXE + Runtime | **crosses lifetimes**: still present after `ExitBootServices()`, relocated at `SetVirtualAddressMap()` |
| UEFI driver / application | after DXE/BDS | a driver/application running in the UEFI environment; not the same as a firmware-built-in module |
| SMM/MM driver | independent | executes inside SMM; privilege level and lifetime are their own system |

Three high-frequency criteria (details and the decision tree are in [[pi-stages]]):

- **Reading a run of structures with no producer xref** → think **HOB** first (PEI→DXE one-way handoff; the DXE side is read-only)
- **`LocateProtocol(&guid)`** → do **GUID dictionary resolution**, recover `EFI_XXX_PROTOCOL_GUID` and the interface vtable; **the protocol graph is more meaningful than the direct call graph**
- **Firmware address ≠ OS runtime address** → not necessarily a hook or a relocation error. First confirm which stage's mapping you compared

## When to use / when not to use

- Prerequisite: you have a firmware image but are not sure it is a UEFI/PI structure or an embedded image → the firmware section of [[re-analyze/system-fingerprints]] (FV → FFS → section hierarchy)
- Use: the firmware image contains EFI structure (Firmware Volume / FFS file / DXE driver) — BIOS update packages (.fd/.rom/.bin), UEFI drivers, EFI applications
- Use: bootkit location (SMM handler, timer callback, boot-path hook) and verification
- Use: Secure Boot / boot-chain analysis (signatures, certificates, NVRAM variables) — needs lawful authorization; see pitfall 4
- Do not use: the firmware is a traditional Linux embedded rootfs (use [[re-fw-extract]] / [[re-fw-rootfs]]; the [[re-firmware]] gateway decides first)
- Do not use: Legacy BIOS Option ROM / non-EFI traditional firmware (binwalk goes to [[re-fw-extract]])
- Do not use: you only need a whole-image unpack to look at contents (first-pass with [[re-fw-extract]]; enter this skill only after confirming UEFI structure)
- Note: static analysis first (large-firmware principle). Emulating a bootkit = running malicious code, default sandbox (top rule in [[re-analyze/platform-tips]])

## Tool setup

Verify every tool before use. Firmware-image parsing / module static analysis may skip the sandbox. OVMF emulation (step 5) is dynamic execution: default sandbox + network isolation (top rule in [[re-analyze/platform-tips]]).

### UEFITool / UEFIExtract (primary firmware parser)

- Debian/Ubuntu: `apt install uefitool uefitool-cli` (official packages: GUI + CLI; the CLI includes UEFIExtract/UEFIFind)
- Arch: AUR `yay -S uefitool` (or `uefitool-git`; not an official repo)
- Fedora: no official package → Linux x64 binary from GitHub releases (https://github.com/LongSoft/UEFITool/releases) or build from source (qmake + Qt6)
- macOS: universal macOS binary from GitHub releases (same page)
- Windows: win64 binary from GitHub releases (or `choco install uefitool` if the mirror has it)
- Verify: `uefiextract --help` prints usage; GUI `uefitool` can open a firmware image

### UEFIFind (locate files by a pattern string; ships with uefitool-cli)

- The NE build has only positional syntax: `uefifind imagefile {header|body|all} {list|count} pattern`. There are no -g/-t options
- To locate by GUID, use UEFIExtract's GUID argument mode: `uefiextract fw.bin <GUID>` (below)
- Install is the same as above (Debian/Ubuntu uefitool-cli includes it)
- Verify: `uefifind --help`

### ghidra / ida (module decompilation; install in [[re-ghidra]] / [[re-ida]])

- A .efi module is PE/COFF (subsystem EFI_BOOT_SERVICE_DRIVER / EFI_APPLICATION). Both tools import it directly
- EfiRom plugin (optional): an EDK2 tool, for ROM ↔ .efi conversion and size queries
- Verify: importing the extracted .efi automatically recognizes the subsystem as an EFI boot service driver

### ovmf — OVMF (Open Virtual Machine Firmware, UEFI emulation firmware)

- Debian/Ubuntu: `apt install ovmf` (/usr/share/OVMF/OVMF_CODE.fd, OVMF_VARS.fd)
- Fedora/RHEL: `dnf install edk2-ovmf` (path **/usr/share/edk2/ovmf/OVMF_CODE.fd** — the old /usr/share/OVMF layout is retired)
- Arch: `pacman -S edk2-ovmf` (installs only **/usr/share/edk2/x64/OVMF_CODE.4m.fd**, 4m format)
- macOS: `brew install qemu` includes the firmware (`$(brew --prefix)/share/qemu/edk2-x86_64-code.fd`, with the qemu package)
- Windows: the QEMU installer includes it (edk2-x86_64-code.fd under share/qemu/)
- Verify: check the path for the distro — Debian/Ubuntu `ls /usr/share/OVMF/OVMF_CODE.fd`; Fedora/RHEL `ls /usr/share/edk2/ovmf/OVMF_CODE.fd`; Arch `ls /usr/share/edk2/x64/OVMF_CODE.4m.fd`; macOS uses the brew prefix path

### qemu-system-x86_64 (OVMF runtime host)

- Debian/Ubuntu: `apt install qemu-system-x86`
- Fedora: `dnf install qemu-system-x86-core` (the full virtualization group is `dnf install @virtualization`)
- Arch: `pacman -S qemu-system-x86`
- macOS: `brew install qemu`
- Windows: the installer from qemu.weilnetz.de
- Verify: `qemu-system-x86_64 --version`

## Steps

Run in order. Record evidence at each step (path + sha256; see [[re-triage]]). First look first: `file fw.bin` + entropy to confirm UEFI structure ([[re-triage]]).

1. **Firmware image parse (Firmware Volume → File → Section)**:
   ```sh
   file fw.bin
   uefiextract fw.bin all            # full recursive unpack (includes nested FVs and compressed sections; see pitfalls 1/2)
   ls fw.bin.dump/                   # tree: Volume0/ → File0/ → Section0/ → PE32 and so on
   ```
   - GUI: open fw.bin in UEFITool. The left tree is top-down FV → FFS File → Section. Count FV number and type first — the main DXE FV is usually the largest and holds hundreds or thousands of modules. The PEI FV and SEC Core are at the front
   - Confirm how many FV layers the image has (nested / recovery volumes). Do not stare only at the first layer (pitfall 1)

2. **DXE driver extraction**:
   ```sh
   ueifind fw.bin all list <GUID>    # locate a file by pattern string (including GUID text) — the NE build is positional only, no -g/-t
   # Extract a named file directly by GUID (UEFIExtract GUID argument mode):
   #   legal -m values: all|body|header|info|file; -t is the hex section type (PE32=0x10, that is -t 10)
   uefiextract fw.bin <GUID> -o driver.efi -m body -t 10
   file driver.efi                   # expected output: PE32+ executable (EFI boot service driver)
   ```
   - UEFITool GUI: right-click File → Extract body, and export a "bare PE" (FFS/section headers removed; see pitfall 3)
   - `sha256sum` the extract for evidence first ([[re-triage]]), then open it in a decompiler

3. **Module analysis (entry / Protocol services)**:
   - Open the .efi in [[re-ghidra]] / [[re-ida]]. The entry = the image entry (DriverEntry). That is the starting point for understanding the driver
   - Protocol services are UEFI's "API": `gBS->LocateProtocol(&guid,...)` (obtain a service), `gBS->InstallProtocolInterface(...)` (register a service), `gBS->CreateEvent(...)` (event/callback), `gST->ConOut` (console output)
   - A GUID is a "symbol" — recognizing the GUID passed to LocateProtocol is recognizing the API call. Use UEFITool's built-in GUID database (the UI shows the protocol name next to the GUID) or search the UEFI spec / UEFI GUID tables
   ```sh
   strings driver.efi | grep -iE 'protocol|runtime|efi_' | head -30
   ```
   - Record: the entry function, which Protocols were installed/obtained, and whether an event callback was registered (continues at step 4)

4. **bootkit location (SMM / timer callback / boot-path hook)**:
   - **Timer callback**: `gBS->CreateEvent(EVT_TIMER, TPL, Callback, ...)` + `gBS->SetTimer(..., PERIODIC/ONESHOT, ...)` → the callback is where malicious logic runs periodically (the most common hook point)
   - **SMM**: `SmiHandlerRegister` / SMST services → an SMM driver registers an SMI handler (code that executes inside SMM, a persistence layer at higher privilege than kernel ring0, executing inside SMRAM)
   - **Boot-path hook**: BDS-stage tampering (NVRAM variables BootOrder/BootNext, replacing an EFI boot entry, hooking the boot manager / PXE path); S3 resume path (AP wake code)
   - **Runtime-service hook**: intercept or replace Runtime Services pointers such as `gRT->SetVariable`/`GetVariable`
   - Decision features: the driver does not unload, it carries a custom GUID, DXE_DEPEX depends on another launcher module, strings contain a path/key/URL. After the suspicious module GUID and dependencies are confirmed, go to step 5

5. **OVMF emulation check** (running malicious code — inside a sandbox, network `-net none`):
   ```sh
   # read-only code firmware + writable variable firmware (the two-pflash standard); OVMF_CODE.fd path by distro:
   #   Debian/Ubuntu: /usr/share/OVMF/OVMF_CODE.fd
   #   Fedora/RHEL:   /usr/share/edk2/ovmf/OVMF_CODE.fd (the old /usr/share/OVMF layout is retired)
   #   Arch:          /usr/share/edk2/x64/OVMF_CODE.4m.fd (4m format)
   qemu-system-x86_64 -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE.fd \
     -drive if=pflash,format=raw,file=OVMF_VARS.fd \
     -m 1024 -net none -boot menu=on
   ```
   - Confirm the firmware can boot to the UEFI Shell/system → then load the extracted driver / firmware modification (insert with UEFITool or rebuild the firmware image) into the same OVMF and watch the behavior difference
   - When there is no real firmware, OVMF is the baseline environment (no Secure Boot signature constraint; see pitfall 4). Emulation details and the user-mode alternative are in [[re-fw-emulate]]
   - Dynamic behavior confirmed (callback fired / variable tampered) → sandbox + snapshot ([[re-sandbox]]), and behavior analysis hands off to [[re-malware]]. Archive each step's product

## Branches (references)

- [[pi-stages]] — **PI stage model**: how to determine SEC/PEI/DXE/BDS/Runtime/SMM and how their execution environments differ; **HOB** (starts with PHIT, produced one-way by PEI, read-only in DXE, `Build*Hob` asserts in DXE); **GUID dictionary resolution** (Protocol/PPI/FFS/HOB/variable namespace/configuration table); **FV → FFS → section → PE** hierarchy (do not carve on the PE magic); **`DXE_DRIVER` vs `DXE_RUNTIME_DRIVER`** (after `ExitBootServices` boot services are all unavailable, the `EVT_SIGNAL_VIRTUAL_ADDRESS_CHANGE` notification function must not call any service, `ConvertPointer`, and the `VirtualMode`/`AtRuntime` criteria on `EFI_RUNTIME_ARCH_PROTOCOL`)

## Related skills

- [[re-firmware]]: this skill is cited by the re-firmware gateway — the UEFI firmware branch. The overall flow is still the gateway's extract → rootfs → emulate orchestration
- [[re-fw-emulate]]: the OVMF/QEMU full-system emulation in step 5 is this skill's UEFI specialization of [[re-fw-emulate]]
- [[re-binary-core]]: static decompilation of DXE drivers ([[re-ghidra]] / [[re-ida]] / [[re-radare2]]), import table [[re-imports]]
- [[re-triage]]: first look (hash / architecture / entropy); archive each layer's product
- [[re-malware]]: bootkit dynamic verification goes into a sandbox ([[re-sandbox]]); malicious-behavior analysis hands off to [[re-malware]]
- Non-EFI firmware (traditional BIOS / embedded image) → [[re-fw-extract]] (binwalk first pass)
- Related branches of [[re-analyze/platform-tips]]: static first (large firmware samples), dynamic defaults to a sandbox (network -net none when emulating a bootkit), Linux/Windows platform branches

## Pitfalls

- **Firmware images nest many FVs**: symptom — UEFITool opens and shows only a few files/modules, and the driver you want is missing; cause — modern firmware nests FVs (a DXE FV inside a PEI FV, a recovery volume/Capsule, an FV inside an ACPI table). Analyzing only the outer layer naturally misses pieces; fix — `uefiextract fw.bin all` for a full recursive expand (nesting is handled automatically), or expand child FVs layer by layer in the GUI. Confirm the image structure before analysis
- **Compression / padding hides contents**: symptom — an FFS file section shows as compressed data or FREE_SPACE/FIXED padding, and there is no PE32 code; cause — the vendor compressed the whole DXE volume (EFI/LZMA compressed section). Empty regions are a normal layout; fix — UEFITool/UEFIExtract decompresses automatically and shows the decompressed Section (look there; do not use binwalk's raw bytes). "No code" in a binwalk result does not mean there is none. Go back to UEFITool and confirm
- **The PE header is offset inside the FFS**: symptom — a "file" carved out of the firmware fails to open in file/IDA, or decompilation is all garbage; cause — the PE32 body starts only after the FFS File Header (24/32 bytes) + Section Header + alignment padding. The PE header is not at file offset 0; fix — right-click Extract body in UEFITool, or `uefiextract fw.bin <GUID> -m body`, and export a bare PE. After export, `file` must contain "PE32+ executable (EFI boot service driver)" before you open a decompiler. A manual extract has to compute the offset from the Section layout
- **Secure Boot signature-bypass analysis needs lawful authorization**: symptom — you want to "bypass Secure Boot" / "re-sign the firmware" as an experiment, and touching a real signed firmware causes trouble; cause — signature bypass, extracting firmware keys/certificates, and verifying a bootkit on a real device all sit on a legal and authorization boundary; fix — by default analyze and verify behavior in OVMF development firmware (no signature constraint). Before touching real firmware, confirm the authorization scope (a device you own, a vulnerability-research authorization). Do not touch it without authorization. State the boundary in the report (the same kind of statement as the authorization boundary in [[re-hardware-io]])
- **Treating cross-stage data as an ordinary global with a missing producer**: symptom — a function reads a run of structures and you cannot find the constructor, so you suspect trimming or incomplete code; cause — that may be a **HOB** (the PEI→DXE one-way handoff; the DXE side is read-only, and a constructor call also asserts); fix — parse the HOB list first, and build the "which stage produces, who consumes" correspondence ([[pi-stages]])
- **Treating a GUID as a UUID with no meaning**: symptom — a large number of GUID constants cannot be explained, and analysis stops at "a constant was passed in"; cause — a GUID may be any of Protocol/PPI/FFS file/HOB/variable namespace/configuration table; fix — build a GUID→symbol dictionary, turn `LocateProtocol`-class calls back into semantic names and an interface vtable, and **use the protocol graph to fill in the call graph**
- **Not distinguishing `DXE_DRIVER` from `DXE_RUNTIME_DRIVER`**: symptom — you compare an address in the firmware with an address captured at OS runtime and decide it was hooked; cause — a runtime driver still exists after `ExitBootServices()` and is relocated according to the `SetVirtualAddressMap()` mapping. A firmware address is not equal to a runtime address; fix — determine the module type and which lifetime it is in first (`VirtualMode`/`AtRuntime` on `EFI_RUNTIME_ARCH_PROTOCOL` are ready-made criteria), then talk about consistency ([[pi-stages]])
