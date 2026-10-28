# Kernel-reversing decision tree and evidence grading

## Scenario decision tree (entry → branches)

### 1. Target-type decision (first level)

```
Got a .sys or kernel-related sample
├─ standalone .sys (no user-mode sample) → static mainline (section 2)
├─ .sys + user-mode sample              → static mainline + interaction loop (section 2 + IOCTL branch)
├─ rootkit suspicion (hide / hook behavior report) → rootkit-feature branch (section 3)
├─ crash dump / blue-screen location    → go straight to [[re-windbg]] !analyze -v
└─ loader / service installer contains a driver → recover the install chain (service registration) first, then the static mainline
```

### 2. Static mainline (driver analysis)

```
Locate DriverEntry (EP or a stub jump)
├─ MajorFunction registration (28-slot array assignment / RtlCopyMemory)
│  ├─ has IRP_MJ_DEVICE_CONTROL(0x0E) / INTERNAL_DEVICE_CONTROL(0x0F) → IOCTL branch
│  ├─ has IRP_MJ_READ / WRITE → data-flow handler branch
│  └─ all default handlers        → may work through a minifilter / callbacks (check Flt* / Ps* imports next)
├─ IoCreateDevice / IoCreateSymbolicLink → device name → user-mode entry \\.\name
├─ IoAttachDevice* present     → filter driver (file / keyboard / network filter) → check attach point and callbacks
├─ FltRegisterFilter present   → minifilter → check FLT_REGISTRATION and Instances configuration
└─ PsSet* / CmRegister / ObRegister callback registration → callback branch (section 3)
```

### 3. Rootkit-feature branch (grouped by technique)

```
Rootkit-suspicion features
├─ function prologue rewritten (jmp rel32 / mov rax;jmp rax) → inline hook → byte-compare the original image (≥16 bytes)
├─ table-slot address abnormal (!ssdt cross-check) → SSDT hook → note: symbol not exported from Win8 on + x64 PatchGuard
├─ process / driver enumeration set difference → DKOM unlink → debug cross-check + forensic plugin review
├─ callback-array address abnormal → callback abuse → check callback type and registration site
├─ file operations hijacked → minifilter attach → check the FLT_REGISTRATION callback table
└─ no static feature but behavior is abnormal → dynamic: kernel-debug breakpoints + memory-forensics cross-check
```

### 4. IOCTL interaction branch

```
DeviceIoControl call site (user-mode sample)
├─ take the IOCTL code → decode CTL_CODE (high 16 bits device type, bit14-15 access, bit2-13 function, bit0-1 method)
│  ├─ Method 0 (BUFFERED)  → SystemBuffer handling
│  ├─ Method 3 (NEITHER)   → Type3InputBuffer (must probe yourself / ProbeForWrite)
│  └─ Method 1/2 (DIRECT)  → MDL mapping
├─ decompile the driver handler → align the input structure field by field (type-propagation review)
└─ closed-loop verification: user-mode trigger → kernel breakpoint hit → parameter check
```

## Evidence grading table

| Level | Evidence shape | Example | Use |
|---|---|---|---|
| A strong | dynamic + static closed | kernel breakpoint hits the handler and parameters match static analysis; hook bytes vs original image diff is on record | a "certain" conclusion is allowed |
| B medium | static chain complete | DriverEntry → IRP → handler fully recovered, IOCTL structure aligned | a "high confidence" conclusion is allowed |
| C weak | static feature | import table merely contains Flt* / callback APIs, suspicious strings | supports only "suspected"; do not conclude |
| Counter-evidence | benign explanation | callback is a legitimate filter (EDR / backup), hook is a debugger breakpoint | record and archive |

- Kernel evidence must carry version context: structure offsets, symbol availability, and PatchGuard behavior all change with the OS version — label the target OS version on the conclusion
- A rootkit conclusion needs two independent evidence lines (debug session + forensic dump) that corroborate each other; a single line drops one grade

## Lessons internalized

- Symbols before offsets: when a symbol server / PDB is available, use symbol field names throughout; bare offsets only when there are no symbols, and label the version
- The IRP table is the driver's heart: starting from the 28-slot dispatch table covers more behavior than reading DriverEntry in order
- A closed interaction loop is more trustworthy than one-way static analysis: whether an IOCTL structure guess is right is checked by a user-mode trigger plus a kernel breakpoint, which is faster than re-reading the decompilation
- Classify rootkit features by "what was changed": table slot (SSDT) / code (inline) / linked list (DKOM) / callback / filter — each class has its own cross-check method; do not mix them
- PatchGuard is both an analysis boundary and a safety boundary: modifications of protected structures are verified only in a debug VM, and the report states whether the technique is still viable on the target version
- Snapshot before every driver load; roll back on a crash — a blue screen is normal, not an accident

## Usage notes

- Every dynamic step stays inside a sandboxed debug VM ([[re-sandbox]], the top rule in [[re-analyze/platform-tips]]); turn test signing on only on the analysis VM (see [[windows-gotchas]])
- Kernel-analysis conclusions touch system integrity (rootkit techniques); keep the report inside the authorized analysis scope and do not supply a complete payload usable against a real environment
