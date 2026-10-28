# macOS app-reversing decision tree and evidence grading

## Scenario decision tree (entry → branches)

### 1. Target-form branches (level 1)

```
Target object
├─ .app bundle → unpack Contents/, and read Info.plist and the executable first
├─ A single binary (command-line tool / daemon) → codesign / Mach-O analysis directly
├─ dylib / framework → dependencies and the export surface are primary (otool -L / nm)
├─ An installer (pkg/dmg) → unpack and extract the payload first (pkgutil --expand)
└─ Unsigned / adhoc signature → skip the signature surface and go straight to static analysis
```

### 2. Signature and distribution-state branches (level 2; decides the dynamic plan)

```
codesign -dv result
├─ Apple developer / distribution signature
│  ├─ Notarization passed (spctl -a passes) → legitimate distribution; still analyze the malicious surface (notarized ≠ safe)
│  ├─ Notarization failed / not notarized → Gatekeeper will block it; it can still be analyzed locally
│  └─ Hardened Runtime on → injection is restricted (see branch 3)
├─ Third-party / self-signed → a large injection surface, but it may carry a custom check
└─ Unsigned → the easiest to run dynamically, but note that the system will block execution (Gatekeeper/AMFI)
```

### 3. Dynamic-feasibility branches (level 3)

```
You want to execute dynamically (lldb attach / DYLD_INSERT_LIBRARIES / frida)
├─ Hardened Runtime and no cs.allow-dyld-environment-variables
│  └─ DYLD injection is not feasible → lldb attach or static analysis ([[re-ghidra]])
├─ PT_DENY_ATTACH (ptrace interception) → patch the call site first ([[re-patching]]), then attach
├─ Sandbox on → dynamic observation is limited to sandbox capabilities (entitlements are the authority)
└─ No restrictions at all → the standard lldb / frida flow (inside a sandbox environment, [[re-analyze/platform-tips]])
```

### 4. Data-target branches (level 4)

```
What you want
├─ Network behavior → capture ([[re-netcap]]) + confirm sandbox network permission
├─ Keychain items → locate SecItemCopyMatching call sites, and read purpose and access conditions (accessibility / access control; do not export contents; red line)
├─ A Secure Enclave key → confirm tokenID and record the purpose (not extractable; do not look for the bytes)
├─ Local files / preferences → analyze the container path (under a sandbox, ~/Library/Containers/)
└─ Authorization / registration logic → check-API call sites → the [[re-license]] methodology
```

## Evidence grading table

| Level | Evidence form | Example | Use |
|---|---|---|---|
| A strong | Dynamic + static cross-check closes | Network exfiltration is observed dynamically, and the static code agrees with entitlements (network.client) | You may conclude "malicious behavior" |
| B medium | A complete evidence chain on one side | The call chain is fully recovered statically (including the trigger condition) and was not confirmed dynamically | You may conclude "highly suspicious" |
| C weak | A static feature | Only a high-risk entitlement (for example device.* fully on) + heavy obfuscation | Only supports "needs a deeper look" |
| Counterevidence | A benign explanation | The declared permissions match the function, and behavior matches the declaration | Record and archive |

- The capability boundary follows dynamic behavior: a capability declared in entitlements ≠ a capability actually used. Record both
- State the signature/notarization conclusion separately from the malicious conclusion ("distribution state" and "behavior verdict" are two dimensions)

## Lessons internalized

- Read Info.plist + entitlements before deciding the dynamic plan — hardened runtime / the sandbox directly decides injection and observation methods
- Signature info can be checked locally (codesign -d -r- / -dv). Notarization status needs the network — when offline, substitute local info and mark that
- TCC data is read-only analysis and contents are not exported (red line); Full Disk Access is the prerequisite for reading. Confirm authorization first
- Record the purpose of a Secure Enclave key and do not look for the bytes; for a keychain item, record access conditions and access points rather than password contents
- Dynamic observation happens inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]])
- Evidence-chain record: signer / Team ID, the entitlements text, TCC dependency points, the dyld dependency list, and the dynamic-behavior cross-check

## Usage notes

- Dynamic execution is inside a sandbox ([[re-sandbox]]); TCC/keychain data is read-only and not exported (red line)
- Mark conclusions by this table's grades. State the signature/notarization dimension separately from the behavior dimension
