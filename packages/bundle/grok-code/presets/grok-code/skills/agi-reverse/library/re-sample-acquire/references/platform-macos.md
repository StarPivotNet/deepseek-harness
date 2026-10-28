# macOS platform branch: Mach task / VM region / Endpoint Security

The observation object is **Mach task + VM region** (not `/proc`, and not the Windows VAD model). The core difference is **permission**: on macOS "has permission" depends on the task port and the signature state, not on uid.

## 1. Static main line

```
task port → VM regions → filter RX/RWX/private regions → Mach-O/dyld provenance → thread PC/backtrace → dump
```

- Walk regions: `vm_region_recurse_64()` / `mach_vm_region*()` — returns the region's address range, **protection**, sharing, resident/private, and similar attributes
- Read contents: `mach_vm_read()` / `mach_vm_read_overwrite()` (needs read rights on the target task)
- Attribution: whether the thread PC and backtrace land inside an "executable region with no Mach-O/dyld backing"
- Related API family (all need a task port): `task_for_pid`, `mach_vm_region`, `mach_vm_read` / `mach_vm_read_overwrite`, `vm_region_recurse_64`, `mach_vm_protect`

## 2. Permission boundary (the easiest place to misjudge on this platform)

- **SIP** (System Integrity Protection, since 10.11): for a SIP-protected process, `task_for_pid()` / `processor_set_tasks()` return **EPERM**. An Apple-internal special entitlement is required (not provided externally). Under SIP, Mach special ports are reset at `exec`, dyld environment variables are ignored, and DTrace probes are unavailable
- **Hardened Runtime** (notarization requirement): by default **revokes** `task_for_pid` rights, and refuses dynamic-library injection, marking an arbitrary page executable with `mprotect(PROT_EXEC)`, `task_set_exception_ports`, and similar — unless the app declares an exception entitlement
- `com.apple.security.get-task-allow` (debug-tool entitlement): the **target process** must carry this entitlement before it can be attached / its task port taken (a release build should not have it; its presence is a suspicious signal)
- Conclusion: **root cannot read everything**. Before collection, confirm whether the target is SIP-protected, whether it has Hardened Runtime, and whether it can be attached. When it cannot be read, mark "insufficient permission" explicitly. Do not treat that as "nothing is in memory" (disabling SIP requires Recovery mode and weakens several system protections; not recommended outside authorized research)

## 3. Dynamic side (trigger): Endpoint Security

On macOS this should not be written as "hook `mprotect()`" — the system provides a proper observation interface, **Endpoint Security (ES)**:

- **Documented events** related to memory / execution:
  - `ES_EVENT_TYPE_NOTIFY_MMAP` — the process **maps a file into memory**
  - `ES_EVENT_TYPE_NOTIFY_MPROTECT` — the process **changes the protection of a mapped page** (RWX / made-executable signal)
  - `ES_EVENT_TYPE_NOTIFY_REMOTE_THREAD_CREATE` — the process **creates a thread in another process** (macOS 11.0+)
  - `ES_EVENT_TYPE_NOTIFY_GET_TASK` — the process **obtains another process's task control port** (macOS 10.15.4+; also `GET_TASK_NAME` / `GET_TASK_READ` / `GET_TASK_INSPECT`, 11.0/11.3+)
- **NOTIFY and AUTH**: `NOTIFY_*` only observes; `AUTH_*` (for example `AUTH_MMAP` / `AUTH_MPROTECT` / `AUTH_GET_TASK`) can **allow or deny** the operation — in an authorized scenario this can be blocking collection (collect evidence, then allow or deny)
- Subscribe with `es_subscribe` (constant type `es_event_type_t`; available items are gated by macOS version; check the target SDK headers)
- Division of labor on the collection side, same shape as Windows/Linux: **ES is responsible for "when" to trigger; Mach VM is responsible for confirming "what" it is**

**High-confidence combination** (several events correlated, not a single-point alert):

```
REMOTE_THREAD_CREATE (create a thread in another process)
  + GET_TASK (task port taken first)
  + MPROTECT (W→X protection transition)
  + anonymous/private executable VM region (confirmed on the Mach VM side)
```

## 4. Code-integrity compare (find a patch / replacement)

- **Compare Mach-O `__TEXT` memory pages with the on-disk copy** (by page / digest): they disagree when the code segment was rewritten (patch, inline hook, module replacement)
- Combine segment / signature parsing from [[re-format-macho]] with the signature and notarization view from [[re-macos]] (CDHash, signer) to judge "whether the in-memory image is still the one that was signed"

## 5. Tools and verification

- `lldb` ([[re-lldb]]): after attach, `image list`, `memory region`, `process save-core`
- `vmmap` / `otool` / `codesign -d`: region view, Mach-O structure, signature and entitlement check
- ES client: needs the matching entitlement and user authorization (approved in System Settings). Verify by subscribing to `MPROTECT` first and seeing whether events from normal processes on the system arrive

## Pitfalls on this platform

- **Assuming root can read everything**: under SIP / Hardened Runtime, `task_for_pid` returns EPERM directly — judge permission first, then design collection. Unable to read is not "no anomaly"
- **Copying the hook approach**: macOS has a proper interface such as ES. Prefer events over a user-mode hook (a hook also fails more easily under Hardened Runtime / SIP)
- **Ignoring the difference between AUTH and NOTIFY**: only AUTH events can block. NOTIFY events can only observe (usually enough for collection and evidence)
- **ES events are version-gated**: a new event constant is unavailable on an older system — check the available set against the target system version and SDK headers

## 6. Collecting a kernel-mode payload (KEXT / DEXT)

On macOS a "kernel-mode payload" comes in two generations, and the collection paths are completely different (analysis method: the macOS branch of [[re-kernel]]):

- **DEXT (System Extension / DriverKit) — treat it as a user-mode process**: it runs in user space, so follow this file's user-mode path (process enumeration, `mach_vm_read`, and so on). Kernel-mode means are not required. Confirm **activation state and entitlement** first (if it is not activated, or the entitlement does not match, the process never starts — do not misread that as "no payload")
- **KEXT (legacy) — confirm the running version first**: on macOS 11+ a third-party kext is folded into **AuxKC and loaded at boot**. Before a reboot after an update, **the old version may still be running** — before collection, record **disk bundle version / AuxKC version / running version / boot time**, or the copy collected / analyzed will not be the one that is running
- **Cross-view of the kext list**: disk kext directory / `kmutil` view / IORegistry bindings, cross-checked (same shape as the Linux module-list cross-check)
- **Reality of reading kernel memory**: under SIP and Hardened Runtime, `task_for_pid` returns EPERM for a protected target (see section 2 of this file) — kernel-memory collection usually requires SIP disabled or a mechanism with the matching authorization. That is an authorized-research scenario. Confirm permission and compliance requirements first
- File the collection product under [[re-analyze/analysis-contract]], and mark which of the three it came from: "collected from disk / AuxKC / running memory"
