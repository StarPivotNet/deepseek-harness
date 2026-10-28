# License-verification analysis decision tree and evidence grading

## Scenario decision tree (entry → branches)

### 1. Does an authorization mechanism exist (level 1)

```
The sample has a registration/activation flow (registration UI / license file / registry key / serial input)
├─ Packed / obfuscated → unpack with [[re-anti-analysis]] / recover with [[re-deobfuscate]] first, then enter the main line
├─ No authorization features at all → honestly report "no authorization mechanism". Do not invent check points
└─ Authorization features exist → enter the location main line (section 2)
```

### 2. Location main line (finding check points)

```
String / API cross-references
├─ A hit on an "invalid/register/license/trial/expired"-class string → xref → candidate check function
├─ A hit on a registry API (RegQueryValueExW) → xref → the license-value read point
├─ A hit on a machine-code API (GetVolumeInformationW and similar) → xref → the machine-binding branch (section 4)
├─ A hit on a time API (GetSystemTimeAsFileTime/time) → xref → the time-based branch (section 5)
└─ A hit on a network API (InternetOpen*/WinHttp*/socket) → the online-activation branch (section 6)
↓
List every candidate check function → locate them one by one:
├─ Success/failure jump structure (jz/jnz) → confirm it is a real check (otherwise a fake check/honeypot; see pitfall 5)
├─ The registration-flag global → xref every consumer → the full check-point list
└─ A dynamic breakpoint confirms branch direction and return value (grade-A evidence)
```

### 3. Algorithm-type branches (reversibility judgment)

```
Internal structure of the check function
├─ Compare type (strcmp / byte by byte) → reversible → recover the derivation → the [[re-keygen]] route
├─ Decrypt type (XOR/base64/hand-rolled) → reversible (symmetric) → inverse map → the [[re-keygen]] route
├─ Signature-verify type (RSA/ECC verify) → irreversible → the [[re-patching]] route (honest report)
├─ Hash type (SHA/MD5 compare) → irreversible → the [[re-patching]] route
└─ Mixed type (reversible segment + irreversible segment) → mark by segment; recover the reversible segment and send the irreversible segment to a patch
```

### 4. Machine-binding branch

```
The check function reads a machine code (volume serial / MachineGuid / /etc/machine-id / hostname)
├─ Binding confirmed → the report notes "bound to a machine code"; keygen generation logic must take the input as a parameter
├─ The machine code participates but can be swapped → a VM / registry-value replacement can bypass it (environment-side verification)
└─ Read only and not part of the check (false positive) → confirm the data flow against the decompilation. Do not conclude from the API existing
```

### 5. Time-based branch (validity / subscription / trial)

```
Expiry prompt / time-API references
├─ Where the expiry time is stored (registry/file) → locate the compare logic
├─ Clock-rollback detection (current time < last recorded) → locate the check point before talking about changing the time
├─ Grace period (the license is expired but still usable for N days) → the fallback logic is an independent check point and goes on the list
└─ Coexists with a serial check → both independent check points go on the full list
```

### 6. Online-activation branch

```
Network API + activation flow
├─ Disconnect test: failure/timeout → online dependence is confirmed
├─ The local side only checks response format (a fake check) → the real verification is on the server → capture and analyze with [[re-protocol]]
├─ There is an offline fallback (grace / offline activation code) → recover the local fallback path independently
└─ Server verification cannot be bypassed → report it honestly, go to protocol analysis, or stop
```

### 7. Disposition routes converge

```
The full check-point list (with evidence grades)
├─ All reversible → [[re-keygen]] (generator + every check point verified in the sandbox)
├─ Partly reversible → keygen covers the reversible segment + [[re-patching]] covers the irreversible segment
├─ All irreversible → [[re-patching]] (jump/branch modification)
└─ Online-dominated → protocol-layer analysis with [[re-protocol]]
```

## Evidence grading table

| Level | Evidence form | Example | Use |
|---|---|---|---|
| A strong | Dynamically confirmed | A breakpoint hits the check function, the branch direction matches the static inference, and the registration flag actually flips | You may conclude "this check point holds" |
| B medium | The static chain is complete | The xref chain + data-structure recovery is complete, with no dynamic verification | Mark "static inference, pending dynamic confirmation" |
| C weak | A static feature | Only a string/API exists, and the call relationship is not closed | Candidate only. Do not conclude |
| Counterevidence | A fake check | Changing the branch does not change behavior; a honeypot path | Record and exclude it, so it does not mislead |

- Grade each check point independently: A/B/C coexisting on the full list is normal. Mark them clearly when handing downstream
- A dynamic conclusion that "the program is registered" must include the registration flag / behavior evidence. It cannot be a static re-judgment alone

## Lessons internalized

- A string xref only locates a candidate. A dynamic breakpoint is what decides: a candidate function must be verified as "changing the branch really changes behavior" (the fake-check counterexample)
- The registration flag is a global index: xrefing the flag variable covers feature check points more completely than searching strings one by one
- The license model comes before the algorithm: node lock / subscription / feature switch / floating license decides the disposition route. A wrong model wastes the whole chain
- Take online and offline evidence separately: a disconnect test is the fastest way to distinguish models. Distinguish first, then go deep
- Time-based checks are often missed: they exist independently of the serial check — look up time-API references and where the expiry is stored
- File each conclusion with an evidence grade ([[re-analyze/analysis-contract]]). Downstream (patch/keygen) decides trust from the grade

## Usage notes

- Every dynamic step is inside a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]); a packed/obfuscated sample is recovered before it is located
- This skill only does authorization-mechanism analysis method and structural description. It does not cover a crack procedure for a specific product. Product delivery is limited to an authorized scope (your own software / testing / research)
