---
name: re-cracking
type: gateway
description: >
  Software-cracking gateway. Orchestration: unpack first if packed → locate the license → patch/keygen.
  Sub-skills: [[re-license]] [[re-patching]] [[re-keygen]] [[re-drm]].
  Triggers: `破解`, crack, `注册码`, `序列号`, `授权验证`, `绕过验证`, `打补丁`, patch, keygen, `注册机`, `授权绕过`.
capabilities: [license-analysis]
---

# Software cracking (license location / patch / keygen)

## Authorization boundary (applies jointly to this gateway and the downstream skills [[re-license]] / [[re-keygen]] / [[re-patching]] / [[re-drm]])

- **Allowed cases**: license-verification analysis is limited to — analysis of software you own / wrote yourself, authorized testing and audit, CTF and research environments (challenge/sandbox samples), and vendor-authorized assessment targets
- **Forbidden**: unlocking unauthorized software, bypassing commercial software, and distributing after an authorization bypass (including spreading patch and keygen artifacts)
- **Dynamic-route permission gate**: dynamic steps such as watching a return value at a breakpoint, changing the environment, and verifying behavior are normal reversing methods, but before an agent runs them automatically the user must have stated who owns the target (one of: software ownership / test authorization / a CTF·research environment) — if that is not stated, do only static license-logic analysis, and do not run dynamic verification or land a patch

## Full workflow

Run in order; record an evidence path + sha256 for each step's artifacts (check-point address / algorithm pseudocode / patch file / keygen script) (see [[re-triage]] (capability: `triage`)) so the report can cite them.

1. **Judge packing and unpack: [[re-anti-analysis]] (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`)** — judge the packer before you act: [[re-packer-id]] (capability: `unpack`) identifies it (abnormal section names / entropy >7 / a tiny import table / the EP points outside the first section). Unpack first if packed (a simple packer is [[re-unpack-simple]] (capability: `unpack`), a strong packer is [[re-unpack-advanced]] (capability: `unpack`); archive the unpack artifact by sha256); if junk instructions / flattening / string encryption remain after unpack → [[re-deobfuscate]] (capability: `deobfuscation`). **Enter license location only after confirming there is no packer** (looking for a license function inside packer code is wasted effort; see pitfall 1)
2. **License location: [[re-license]] (capability: `license-analysis`)** — string / API cross-references find the check function (the registration dialog / MessageBox / a registry read) → the call graph and the success/failure branches → recover the algorithm (compare / decrypt / signature verification) → distinguish online activation from an offline check → identify machine-code binding. **Output: every check-point address + the check algorithm** (not only the first one; see pitfall 2)
3. **Dispatch**: pick a path from the check algorithm's nature and the goal —
   - The algorithm is reversible (a compare / transform / table lookup can be reversed) → **[[re-keygen]] (capability: `license-analysis`)** writes a keygen (generates any legal serial, does not modify the target file, suitable for distribution)
   - The algorithm is not reversible (a hash; asymmetric signature verification — the private key cannot be derived from the public verification process; RSA/ECC verification itself is a public algorithm, and what is unavailable is the signature-generation key) → **[[re-patching]] (capability: `binary-patching`)** (skip verification / change the decision branch); when a serial must be forced out of a comparison chain / a mathematical relation → [[re-z3]] (capability: `constraint-solving`) modeling is optional (see pitfall 4)
   - You only want a fast bypass (you do not care about the algorithm) → **[[re-patching]] (capability: `binary-patching`)** (the smallest edit: change the failure jump into the success jump)
   - Both can be done at once: a patch is usable immediately, a keygen stays valid long-term
4. **Patch: [[re-patching]] (capability: `binary-patching`)** — locate the patch point (the failure jump jz/jnz) → a byte edit (nop / rewrite the jump) → checksum / self-check handling → export the patch (a binary diff / a patch file) → multi-architecture adaptation (change a B instruction on ARM, and similar)
5. **Keygen: [[re-keygen]] (capability: `license-analysis`)** — from the check algorithm obtained by [[re-license]] (capability: `license-analysis`) → reverse a generation algorithm (forward derivation / constraint solving) → a python implementation → check-code / check-digit boundary handling → multi-platform CLI output
6. **Verify**: rerun inside the sandbox ([[re-sandbox]] (capability: `sandbox-setup`), [[re-analyze/platform-tips]] supreme rule) — the patched build and the serial the keygen generated must pass **every** check point (startup + feature points; see pitfall 2); behavior matches the unmodified sample; archive the artifacts and evidence paths

Record each step per [[re-triage]] (capability: `triage`); registration-algorithm fingerprints / patch bytes are YARA feature sources for [[re-ioc]] (capability: `threat-intel`).

## Which atomic skill to use (selection tree)

Branch by input features / goal:

- **The sample is packed** (abnormal section names / high entropy / a tiny import table) → [[re-anti-analysis]] first (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`; packer-id → unpack-* → deobfuscate when needed), then return to gateway step 2 after unpack
- **"What is the serial algorithm / generate a registration code for me"** → [[re-license]] (capability: `license-analysis`) recovers the algorithm → [[re-keygen]] (capability: `license-analysis`) generates it
- **"Bypass registration verification / unlock a feature"** → [[re-license]] (capability: `license-analysis`) locates the check points → [[re-patching]] (capability: `binary-patching`) makes the smallest edit
- **The check algorithm is not reversible (a hash; an asymmetric signature — the private key cannot be derived from the public verification process)** → [[re-patching]] (capability: `binary-patching`; skip verification); to force it out of a comparison chain → model it with [[re-z3]] (capability: `constraint-solving`)
- **Online activation** (the check contains a network request) → after [[re-license]] (capability: `license-analysis`) distinguishes online / offline, go to [[re-protocol]] (capabilities: `network-capture`, `protocol-recovery`, `crypto-identification`, `crypto-decryption`, `key-extraction`, `tls-analysis`) to capture and analyze the activation flow; handle the local side as the offline flow (see pitfall 3)
- **You only want to confirm whether a registration mechanism exists** ("does this program have a license") → step 1 of [[re-license]] (capability: `license-analysis`) is enough; do not continue
- **Confirmed there is no license mechanism** → this gateway is not needed; go to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) and analyze normally
- **The target is DRM content protection** (a PlayReady / Widevine license, content decryption) → not a traditional license check; go to [[re-drm]] (capability: `drm-analysis`; authorized research only; the compliance boundary is in that skill)

## Cross-domain joins

- **Entry dispatch**: this gateway is called by the [[re-analyze]] triage path "crack / license bypass / registration code" (re-cracking → re-anti-analysis if packed → license location re-license → patch / keygen re-patching / re-keygen)
- **Unpack before cracking**: a packed sample goes through [[re-anti-analysis]] first (packer-id → unpack-* → deobfuscate), and the unpack artifact returns to this gateway for license location; step 6 of the [[re-anti-analysis]] workflow likewise sends a cracking target back to this gateway
- **Decompiler workbench**: license-function decompilation goes through [[re-binary-core]] ([[re-ghidra]] / [[re-ida]] / [[re-radare2]])
- **Dynamic location**: [[re-gdb]] / [[re-x64dbg]] (breakpoints to see the check branch and the return value), [[re-lldb]] (macOS), [[re-tracing]] (strace / ltrace watching registry / file / API calls), [[re-memdump]] (the registration flag / check result in memory)
- **Online activation**: the check contains network interaction → [[re-protocol]] ([[re-netcap]] capture + [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]] handle activation-protocol encryption)
- **DRM content protection**: a PlayReady / Widevine license and content decryption belong to the DRM domain → [[re-drm]] (distinct from cracking a license check; authorized research only)
- **Obfuscation countermeasures**: a check function protected by junk instructions / flattening / string encryption → recover with [[re-deobfuscate]] and then locate it
- **Verification sandbox**: rerunning a patched build / a keygen serial must use [[re-sandbox]] ([[re-analyze/platform-tips]] supreme rule)
- **IOC output**: registration-algorithm fingerprints, patch bytes, and typical keygen features go into the [[re-ioc]] list

## Common pitfalls

- **Locating the license without unpacking**: symptom — the "check function" an xref locates is all packer decompression code, and a string search is also all garbage / packer information; cause — the sample is packed, and the license logic is decrypted only after the OEP; fix — in step 1, [[re-anti-analysis]] confirms it is fully unpacked (sha256 + a resolvable import table + a sandbox rerun) before license location
- **Patching only one check point**: symptom — the startup check passes, then using a core feature pops the registration dialog again / the feature locks; cause — the check runs several times (startup + feature points + a timer); fix — step 2 of [[re-license]] walks every xref / the call graph of the check function, makes an inventory of **all** check points, and the patch / keygen covers them one by one and verifies each
- **Treating online activation as an offline crack**: symptom — after every local decision branch is changed, the program still refuses to run; cause — serial verification is on the server, and the local side only has the request / response and a fake check; fix — step 4 of [[re-license]] distinguishes online / offline first; online activation goes to [[re-protocol]] to analyze the activation protocol, and the local side can only handle response verification and the offline fallback logic
- **Blindly chasing a keygen**: symptom — the check algorithm contains SHA / MD5 or RSA signature verification, the keygen cannot be written, and the plan is stuck; cause — the irreversible part is one-way (a hash cannot be reversed; in asymmetric verification the private key cannot be derived from the public verification process), so generating a serial by forward derivation is impossible; fix — dispatch per step 3: if it is irreversible, switch to [[re-patching]] and skip verification; when constraint solving is required, use z3-solver to model only the reversible part
- **A lost cloud config → guess the format from a same-series file**: symptom — the crack target depends on a cloud config file (for example `SSSSSPRO.json`), the author emptied the file and the program errors, and reversing the parser is slow; cause — the cloud file is unavailable; fix — guess another file in the same series (for example the version without PRO; the format is usually the same) → start a local server to simulate the data + replace the URL (hosts/proxy/a frida hook redirect); that is much faster than reversing the config format
- **A network-verification platform that allows self-registration → build your own backend instead of reversing**: symptom — a card-key verification server protocol is complex (sign/encrypt-decrypt/data format), and a server you write keeps reporting bad data; cause — fully implementing the verification-platform protocol is a lot of work; fix — inspect the verification platform itself first: locate the interface URL → scan subdomains → find the platform's interface docs / admin login page; if the platform **allows anyone to register** → register a self-built product and generate a config (the default encryption algorithm is RC4 and similar) → replace the config values inside the target; that is less work than writing a server; this is the general shortcut for cracking network verification: prefer "reuse the platform" over "rewrite the platform"
- **frida-gadget injection avoids a hijack inject**: symptom — the target main program is packed / self-checks, and a hijack inject is troublesome; fix — write a loader.exe: `CreateProcess` starts the target and immediately injects `frida-gadget.dll` (with gadget.config); compared with a hook-inject path it is simpler and more controllable
