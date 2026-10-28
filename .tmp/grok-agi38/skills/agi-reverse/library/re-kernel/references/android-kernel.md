# Android kernel-module branch (GKI / vendor module)

**Premise**: an Android kernel **cannot be treated as ordinary Linux** — module identity (GKI / vendor), the KMI symbol allowlist, and the partition plus load stage all decide whether this module can load and why a load fails.

## 1. Separate module identity first

- **GKI module** (Google-supplied, signed with the GKI kernel) vs **vendor module** (OEM / in-house, unsigned)
- The three symbol-permission classes differ: **protected GKI module / unprotected GKI module / vendor module** each have their own accessible symbol set; a vendor (unsigned) module **may use only KMI symbols**, and anything outside that set is refused at load
- Build-time check: ACK `kernel/build`'s `abi/check_buildtime_symbol_protection.py` — every undefined symbol in an unsigned module must be on the **KMI symbol list**, or defined by another unsigned module; otherwise **the module can still build and then be refused at runtime** (the build-time check is only an early warning)
- Runtime symptoms: `module: Protected symbol: xxx (err -13)` / `module: exports protected symbol xxx`
  → **do not treat this as ordinary Linux "symbol missing → patch the address"**: it is GKI symbol-protection policy; identify the GKI protection / KMI boundary first
- KMI symbol-list location: `android/abi_gki_aarch64.xml` and the per-subsystem fragment files

## 2. A KMI branch is not a kernel version

- KMI stability **exists only inside one LTS plus one Android major-version combination** (for example `android14-6.1`, `android15-6.6`, `android16-6.12`); `android-mainline` does not guarantee a stable KMI
- Therefore **`android12-5.10` and `android13-5.10` are both Linux 5.10 and are still KMI-incompatible**: a module built against one branch's `Module.symvers` will not match the other branch's kernel / GKI modules; a GKI module is signed by Google and "is compatible only with the GKI kernel it was built against"
- The correct analysis / porting criteria are exact **`androidXX-X.Y` + KMI generation + symbol list + `Module.symvers` / CRC**, not `5.10 == 5.10`

## 3. Where the module is, and whether it will be loaded

- Search locations (**do not hard-code `*_dlkm` backing paths**; AOSP recommends that external logic use `/vendor/lib/modules` and `/odm/lib/modules`):
  `/vendor/lib/modules`, `/odm/lib/modules`, `/system/lib/modules` (early modules live in the vendor ramdisk at `/lib/modules`)
- The actual backing partition may be: `vendor_dlkm` / `odm_dlkm` / `system_dlkm`
- Load order and dependencies: `modules.load`, `modules.dep`, `modules.softdep`
  - first-stage init loads early modules in order from the vendor ramdisk's `/lib/modules/modules.load`; **the real order changes with hard / soft dependencies**
  - late vendor modules may come from vendor / ODM DLKM
- **A file existing does not mean it will be loaded**; and a dependency **may live on another partition / another boot stage**

## Tools and verification

- `modinfo` (vermagic / dependencies / signature), `readelf -S` (`.modinfo` / `.BTF`), `/proc/kallsyms`, `/sys/module/<name>/`
- GKI side: compare against the target branch's symbol list and `Module.symvers`; signing is `scripts/sign-file` (GKI is signed by Google, vendor by the OEM; the key must be inside the AVB trust chain)
- Verification: be able to state together "module identity (GKI/vendor) + KMI branch + partition + whether it is in the `modules.load` plan"

## Pitfalls on this platform

- **Treating `android12-5.10` and `android13-5.10` as the same kernel**: the KMIs are incompatible
- **Seeing `Protected symbol` and patching the symbol as on ordinary Linux**: that is GKI policy, not a missing symbol
- **Hard-coding `*_dlkm` paths to find modules**: follow the AOSP entry points such as `/vendor/lib/modules`
- **Assuming "the file is there = it is loaded"**: check `modules.load`, dependencies, and partitions
- **Forgetting the module may be built-in**: the Android side has the same case (same reasoning as the Linux branch)
