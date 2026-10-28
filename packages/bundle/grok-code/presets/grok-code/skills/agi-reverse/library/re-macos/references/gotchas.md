# macOS reversing methodology pitfalls and boundaries

## Signature and notarization group (the easiest misjudgment)

- **Notarized ≠ safe**: notarization only proves Apple scanned it and found no known-malicious signature. Notarized malicious/gray apps exist — state "notarization state" separately from "behavior verdict"
- **An offline `spctl` result cannot be trusted**: notarization and revocation (OCSP) checks need the network — offline, `spctl -a` may fail or look abnormal; substitute local signature info from codesign and mark "notarization not verified"
- **`codesign -dv` does not show the full requirements**: the designated requirement needs `codesign -d -r-`; looking only at the default output misses extra requirement checks
- **Stapling and notarization are two different things**: `xcrun stapler validate` checks whether the ticket travels with the package (verifiable offline); `spctl -a` checks the overall assessment (it may go to the network) — one failing does not mean the other failed
- **Changing the signature breaks the original signature chain**: after a patch you must re-sign (`codesign -s -` adhoc, or a developer certificate), and nested signatures (framework/helper) are handled layer by layer; losing notarization status after re-sign is expected
- **Quarantine interferes with testing**: a downloaded `com.apple.quarantine` triggers a Gatekeeper check (crash/prompt) — in the test environment, `xattr -dr com.apple.quarantine` removes it and you retest. Note that this changes provenance evidence

## Injection and dynamic group (hardened-runtime boundary)

- **DYLD_INSERT_LIBRARIES is limited by hardened runtime**: without the `com.apple.security.cs.allow-dyld-environment-variables` entitlement, injection does not take effect (an Apple-signed app enables runtime protection by default) — do not treat "injection did nothing" as a bug. Switch to static analysis or lldb
- **PT_DENY_ATTACH refuses attach**: after the target calls `ptrace(PT_DENY_ATTACH)`, attach is refused — locate the ptrace call site statically, patch it out ([[re-patching]]), then go dynamic
- **AMFI/kext-level checks are outside user mode**: under System Integrity Protection (SIP), injection/mounting on system paths does nothing; kernel-level checks (kext signatures) are outside this skill's capability
- **Attach inside a sandbox is itself restricted**: process-permission inheritance in a sandbox environment ([[re-sandbox]]) affects target behavior — mark observation conclusions with the environment difference
- **Apple Silicon differences**: arm64e pointer authentication (PAC) affects hooks and patches (pointers are signature-checked); under the Rosetta translation layer, x86_64 behavior differs from native — verify separately per target architecture

## TCC and privacy group (red-line boundary)

- **TCC.db is itself protected by TCC**: without Full Disk Access, reading TCC.db fails on permissions — confirm authorization first. Do not try to bypass system permissions (red line)
- **TCC data is read-only and not exported**: authorization records are system privacy. Analyze read-only (who requested which permission). Do not export database contents (red line)
- **TCC records change over time**: authorization can be revoked or added, and a snapshot is not the full history — mark the conclusion with the sample time
- **System-level vs user-level TCC**: `/Library/Application Support/com.apple.TCC/` (system) and `~/Library/...` (user) cover different scopes. Look up the matching database for the target's ownership

## Keychain and Secure Enclave group

- **A Secure Enclave key cannot be extracted**: a private key bound to `kSecAttrTokenIDSecureEnclave` never leaves the SE — a memory/file search necessarily finds nothing. Record the purpose and access conditions (counterexample: not getting the bytes ≠ the analysis failed)
- **Accessibility ≠ access control (do not lump them as ACL)**: `kSecAttrAccessible` governs device state (when it is readable: not locked / after first unlock / this device); `kSecAttrAccessControl` / `SecAccessControl` (biometrics / passcode gate) is the access control; traditional macOS ACL is separately `SecAccess` / `kSecAttrAccess` — analyzing the access point (SecItemCopyMatching arguments) is more valuable than exporting contents
- **Keychain data is sensitive**: item contents are credentials. Analyze the read-only call surface. Do not export password contents (red line)
- **Keychain migration**: after a system upgrade / backup restore, the access-control policy may change — watch this when reproducing a historical environment

## Counterexample and boundary group

- **Sandbox on ≠ no network surface**: when `com.apple.security.network.client` is present, a sandboxed app still connects out — look at entitlements before judging the behavior surface
- **Missing entitlements ≠ no capability**: dynamic behavior may exceed the static declaration (an exploit / an undeclared call) — the capability boundary follows dynamic behavior
- **A well-known signer ≠ not malicious**: a legitimate developer account can be stolen or abused; the verdict follows behavior evidence
- **An unsigned app can still be analyzed**: Gatekeeper blocks the run entry. Static analysis is unaffected; before running, remove the quarantine attribute and put it in a sandbox

## Usage notes

- Dynamic execution is inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]])
- TCC/keychain is read-only and not exported (red line); mark conclusions by the [[decision-tree]] grades, and keep the signature dimension separate from the behavior dimension
