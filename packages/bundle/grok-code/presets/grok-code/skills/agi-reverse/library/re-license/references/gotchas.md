# License-verification analysis methodology pitfalls and boundaries

## Location-misdirection group (the easiest way to waste the effort)

- **A string xref is not a conclusion**: the function that references "Invalid serial" may only be UI display (a dialog wrapper), and the real check is elsewhere — every candidate needs a dynamic breakpoint confirming "does changing the branch change behavior", or you may spend a long time analyzing a honeypot/wrapper function
- **Fake checks and honeypots**: a program can deliberately offer a branch that "looks like a check" (changing it exits or does nothing) and pull the analysis off course — a fake-check feature: after the change, program behavior does not change at all; a real-check feature: the registration flag flips and a feature unlocks
- **The same string is referenced in several places**: an error-prompt string is often shared by several check points (a wrapper function) — walk each xref caller. Do not take only the first
- **Wine environment differences**: under Wine, RegQueryValueExW behaves differently from native Windows (registry location / return value) — mark a Wine conclusion with the environment, and recheck on native Windows when needed

## License-model boundary group

- **The "fake check" trap of online activation**: every local branch is changed and the program is still locked — the real verification is on the server; a disconnect test is the first way to distinguish. A local "activation succeeded" response may only be a cache / offline fallback (grace period), and it still expires later
- **Treating a subscription type as a perpetual type**: the expiry-time check is independent of the serial check — changing only the serial branch does not solve expiry; time-API xrefs and where the expiry is stored must be on the list
- **Feature-switch check points are scattered**: freemium check points are scattered at each feature entry, and the startup check is only one of them — xref the registration flag for full coverage, or "startup is bypassed and the feature is still locked"
- **A floating license has no local algorithm**: a license issued by a license server means the local side is only a protocol client — a complete local algorithm still cannot recover a license "issued by the server". Go to [[re-protocol]]
- **Grace-period counterexample**: the expiry date in the license file has passed but the program is still usable for N days (grace logic) — the grace period is an independent check point (a fallback branch). Changing the expiry time does not necessarily take effect immediately. The fallback logic must be handled at the same time

## Machine binding and fingerprint group

- **Fingerprint-source variety**: volume serial / MachineGuid / hostname / username / NIC MAC / SMBIOS UUID may all participate — checking only one source misses the others (enumerate read points the way [[re-crypto-keys]] does)
- **"Participates" is not "bound"**: an API existing does not mean the value entered the check computation — confirm the data flow against the decompilation; a machine-code API that is only read and unused is a common false-positive source
- **A binding judgment needs dynamic confirmation**: change the machine code / registry value and rerun the program, and see whether the serial stops working — behavior verification is more reliable than static inference
- **Virtualization-environment fingerprint differences**: a volume serial / NIC feature inside a VM differs from a physical machine — when verifying binding behavior inside a sandbox, an environment-fingerprint change can interfere with judging "whether the binding took effect". Record an environment-fingerprint baseline first

## Time-based check group

- **Clock-rollback detection**: the program records the last run time and detects "current time < recorded" — changing the system time directly triggers an anti-rollback error; locate the check point first (where the last time is stored + the compare logic) and only then touch the time
- **The time source is not only the wall clock**: `GetSystemTimeAsFileTime` / `time()` is the wall clock; `GetTickCount64` / QPC is uptime — some programs cross-check two sources (wall clock + uptime), and changing only the system time gives it away
- **Expiry time is stored in several forms**: registry / license file / hidden file / checksum-protected storage — ProcMon/strace on license-related reads and writes locates the storage point

## Tool and environment group

- **Filter ProcMon to the license path**: a full ProcMon recording is large. Filter by process + registry path (license-related keys) before analysis. Do not fish in the full event stream
- **Record debugger changes to time/return values**: times and return values changed during dynamic verification are "environment intervention", and the report must say so — a before/after behavior comparison is what is convincing
- **Limits of debugging without symbols**: when PDB/symbols are missing, the registration flag and structures are identified by hand — cross-check a public-symbol version plus behavior verification (the same idea as [[re-kernel]])

## Usage notes

- All dynamic verification is inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]); license-bypass operations are used only inside an authorized scope (your own software / testing / research). No crack procedure for a specific product is provided
- File conclusions by the [[decision-tree]] evidence grades ([[re-analyze/analysis-contract]]): dynamic confirmation A / static inference B / candidate C are marked separately, and the grade is transparent when handing downstream
