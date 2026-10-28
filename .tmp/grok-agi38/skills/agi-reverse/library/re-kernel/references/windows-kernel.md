# Windows driver branch (model identification → callback / device stack / I/O path)

<CORE RULE>
**Identify the driver model first, then recover the real callback / device stack / I/O path.**
Walking a `.sys` down the single line "DriverEntry → MajorFunction[] → IOCTL" misses a large batch of real drivers — KMDF, an NDIS miniport, a StorPort miniport, a file-system minifilter — whose WDM dispatch is held by the framework / port driver, and whose real business entry is a **callback registered with the framework**.

The seven points that most easily produce factual errors: ① treating every `.sys` as WDM; ② treating `GsDriverEntry` as the business entry; ③ explaining an empty `MajorFunction` as "no I/O"; ④ not knowing KMDF / NDIS / minifilter callback registration; ⑤ not knowing **IRP completion is asynchronous control flow**; ⑥ not knowing **an IOCTL's Method decides buffer semantics**; ⑦ still using the old Windows driver-signing assumptions in 2026.
</CORE RULE>

## 1. First confirm which kind of Windows driver this actually is

```
.sys
├─ raw WDM / NT driver
├─ KMDF
├─ PnP function driver
├─ upper / lower filter
├─ file-system minifilter
├─ legacy file-system filter
├─ NDIS miniport / filter
├─ StorPort / storage miniport
├─ AVStream / PortCls / other miniport
└─ a special security / virtualization-class driver
```

Also: **a UMDF driver is usually not a kernel `.sys` business body**; it is a **user-mode DLL** loaded by `Wudfhost.exe`.

WDM handles an IRP directly; KMDF has the framework catch the IRP, then call the event callback the driver registered.

> **Experience**: `MajorFunction[]` looking like it has nothing **≠** this driver has no I/O interface — it may not be raw WDM at all.

## 2. DriverEntry is not necessarily the real DriverEntry

The PE header's entry point may land on **`GsDriverEntry`** (an initialization wrapper the toolchain generates automatically), and only then call the `DriverEntry` the developer wrote:

```
AddressOfEntryPoint → GsDriverEntry → security/runtime init → the real DriverEntry
```

Do not trust a decompiler that names the entry function `DriverEntry` either: see whether it **calls another** `NTSTATUS f(PDRIVER_OBJECT, PUNICODE_STRING)` and finishes callback initialization. Otherwise the compiler wrapper layer is easily analyzed as business code.

## 3. WDM: what really matters is the `DRIVER_OBJECT` assignment graph

The key initialization of traditional WDM:

```
DriverObject->DriverUnload / DriverObject->DriverExtension->AddDevice
DriverObject->MajorFunction[IRP_MJ_CREATE / _CLOSE / _READ / _WRITE
                            / _DEVICE_CONTROL / _INTERNAL_DEVICE_CONTROL / _PNP ...]
```

`MajorFunction` is the function-pointer array of "IRP major code → dispatch routine". So the most effective way to reverse a stripped WDM driver is to **find the assignment sites**:

```asm
mov [DriverObject + xx], handler
```

Then recover them as a map:

```
IRP_MJ_DEVICE_CONTROL → sub_140003820
IRP_MJ_CREATE         → sub_140001A00
IRP_MJ_CLOSE          → sub_140001A00
IRP_MJ_PNP            → sub_140004C10
```

That is much more meaningful than an ordinary call graph. What to watch when reading each handler:

- `IRP_MJ_DEVICE_CONTROL` (0x0E, user-mode interaction), `_INTERNAL_DEVICE_CONTROL` (0x0F), `_CREATE` (0x00) / `_CLOSE` (0x02), `_READ` (0x03) / `_WRITE` (0x04)
- Each handler takes parameters with `IoGetCurrentIrpStackLocation(irp)` → branch handling (IOCTL-code dispatch)
- **Parameter checks** (InputBufferLength / OutputBufferLength) — a missing length check is a common cause of driver-class bugs (vulnerability-surface analysis moves to the [[re-vuln]] approach)

**Device object and symbolic link**:

- The DeviceName of `IoCreateDevice` (`\Device\MyDriver`); the SymbolicLinkName of `IoCreateSymbolicLink` (`\DosDevices\MyDriver` → user-mode `\\.\MyDriver`)
- With no symbolic link, user mode can `DeviceIoControl` the `\\.\` name directly (or, with no symbolic name, it can only be referenced internally)
- Dynamic check: `!drvobj <name>` for the device-object chain, `!devobj <device>` for the device name and AttachedDevice — cross-check against the static strings, and confirm the runtime was not changed
- A multi-layer device stack (a filter driver): seeing `IoAttachDevice` / `IoAttachDeviceToDeviceStack` means an intercepting driver (file / keyboard filter, and similar)

**Service registration and the load entry**:

- SCM registration: `CreateServiceW` (Type=SERVICE_KERNEL_DRIVER, Start=2 automatic / 3 manual / 0 boot) or an INF install; a malicious loader often uses `Start=3` + a manual start
- Registry: `ImagePath` of `HKLM\SYSTEM\CurrentControlSet\Services\<driver name>` points at the `.sys`
- Start-failure codes: 577 = a signature error, 1275 = an unsigned driver was refused (x64) — check the test-signing state before looking at the code
- Work backward from the create-service call in the user-mode sample ([[re-binary-core]]) to the driver name, and match it to the static `.sys`

## 4. KMDF: do not search it the WDM way

In KMDF **the framework itself registers the WDM dispatch**, then turns the IRP into a `WDFREQUEST` / `WDFDEVICE` / `WDFQUEUE`, and calls what the driver registered:

`EvtDriverDeviceAdd` / `EvtIoRead` / `EvtIoWrite` / `EvtIoDeviceControl` / `EvtIoInternalDeviceControl` / `EvtDevicePrepareHardware` / `EvtDeviceD0Entry` …

The typical path:

```
DriverEntry → WdfDriverCreate → EvtDriverDeviceAdd → WdfDeviceCreate → WdfIoQueueCreate → EvtIoDeviceControl / EvtIoRead / ...
```

> **The special case**: most of the MajorFunction that `!drvobj` shows **points at `Wdf01000.sys`** — that is completely normal.
> **Do not conclude "the driver logic is in Wdf01000.sys"**: the real business entry is the callback it handed to WDF.

## 5. After KMDF is stripped, no obvious callback assignment can be found

WDF initialization uses `WDF_*_CONFIG` / `WDF_OBJECT_ATTRIBUTES` structures heavily:

```c
WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&cfg, ...);
cfg.EvtIoDeviceControl = Handler;
WdfIoQueueCreate(..., &cfg, ...);
```

The optimizer may split that process into pieces: stack-struct initialization → a function address written at some offset → `WdfIoQueueCreate`.

So **do not only search `xref → WdfIoQueueCreate`**; do dataflow forward:

```
WDF_IO_QUEUE_CONFIG → which offset had a function address written → which EvtIo* that corresponds to
```

Otherwise you see `sub_140017260` and do not know it is actually `EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL`.

## 6. A `.sys` with no pretty DriverEntry → IRP path may be a **miniport**

Windows has a large number of "**miniport + Microsoft port / framework driver**" structures:

- **NDIS**: `vendor.sys` + `ndis.sys` together form one driver layer — the vendor NDIS miniport's AddDevice and part of the IRP dispatch **are both provided by ndis.sys**, and the vendor participates through miniport callbacks
- So `DriverObject->MajorFunction[]` being almost entirely not the vendor's **does not mean the vendor driver has no function**
- What to find is `NdisMRegisterMiniportDriver` / `NdisFRegisterFilterDriver` and the callbacks inside the registration structure
- The same idea applies to **StorPort / PortCls / AVStream / other class or port-miniport architectures**

## 7. NDIS: do not treat it as an ordinary IRP network driver

What to recover is the miniport / filter callback graph:

```
miniport: MiniportInitializeEx / MiniportHaltEx / MiniportPause / MiniportRestart
          MiniportOidRequest / MiniportSendNetBufferLists / MiniportReturnNetBufferLists …
filter:   FilterAttach / FilterDetach / FilterRestart / FilterPause
          FilterSendNetBufferLists / FilterReceiveNetBufferLists / FilterOidRequest …
```

The data body is `NET_BUFFER_LIST` / `NET_BUFFER`, and a filter module **is stacked above the miniport**:

```
protocol → NDIS → filter A → filter B → miniport → NIC
```

> So **not seeing `IRP_MJ_READ` / `IRP_MJ_WRITE` is not strange at all for a NIC driver**; do not force a search for the handler that corresponds to `ReadFile()`.

## 8. The device stack must be recovered (the behavior can come from any layer)

The PnP world: `Upper Filter → Function Driver (FDO) → Lower Filter → Bus Driver (PDO)`; the I/O Manager hands the IRP to **the topmost device object**, and the driver continues it downward.

A typical misread:

> the application opened Device X → some behavior happened → it must have been X's function driver

**Not necessarily** — the behavior can come from an upper filter / lower filter / class filter / bus filter. What dynamic analysis should really recover:

```
DeviceObject → AttachedDevice chain → DriverObject → image owner
```

and not only `\Device\Foo → foo.sys`.

## 9. An INF often explains what the driver is faster than the `.sys`

A driver package is usually `.sys + .inf + .cat (+ coinstaller / DLL / firmware)`. The INF gives directly:

`Hardware ID` / `Compatible ID` / `service name` / `ServiceBinary` / `StartType` / `class` / `AddService` / **`UpperFilters` / `LowerFilters` / `AddFilter`**

- From Win10 1903 on, a device filter can declare upper / lower / filter level with `AddFilter`; older drivers largely insert themselves into the device stack through the registry `UpperFilters` / `LowerFilters`
- With only `foo.sys`, what you lost is not only the install file — **it is `foo.sys`'s position in the whole device stack**

## 10. A file-system minifilter: a completely different world

Seeing `FltRegisterFilter` should switch the model immediately:

```
FLT_REGISTRATION → FLT_OPERATION_REGISTRATION[]
   IRP_MJ_CREATE → PreCreate / PostCreate
   IRP_MJ_READ   → PreRead / PostRead
   IRP_MJ_WRITE  → PreWrite / PostWrite
   IRP_MJ_SET_INFORMATION → ...
```

**FltMgr orders minifilters by altitude**: pre-operation walks from high altitude to low, and post-operation runs in reverse on the way back. So:

```
PreRead A → PreRead B → filesystem → PostRead B → PostRead A
```

**That is not strange recursion. It is the normal Filter Manager pipeline.**

## 11. Altitude is not a version number written at random

A minifilter's `Altitude = "320000"` is not a build ID, a priority number, or a version number — it decides that filter's **position** in the minifilter stack, and Microsoft allocates altitude ranges.

So analyzing how several filters interact ("A sees the file first", "why B sees the modified request") **must consider altitude**.

`CmRegisterCallbackEx` (a registry callback) also carries an altitude, and it is used for callback ordering.

## 12. Decode `CTL_CODE` before an IOCTL

An IOCTL (for example `0x222004`) should not be kept as a magic integer — split it into `DeviceType` / `Access` / `Function` / **`Method`**:

| Method | Where the data is |
|---|---|
| `METHOD_BUFFERED` | `Irp->AssociatedIrp.SystemBuffer` |
| `METHOD_IN_DIRECT` / `METHOD_OUT_DIRECT` | `MdlAddress` and the locked / mapped pages |
| `METHOD_NEITHER` | **it may carry a raw user-mode virtual address directly** |

Microsoft states explicitly that the transfer method of `DeviceIoControl` comes from **the IOCTL's own TransferType**. So it is best to recover `switch (IoControlCode)` into comments with semantics before reversing the handler:

```
IOCTL_800: Function = 0x800, Method = BUFFERED, Access = ANY
IOCTL_801: Function = 0x801, Method = NEITHER
```

## 13. "The kernel directly dereferences a very low address": confirm first whether it is a `METHOD_NEITHER` user pointer

- BUFFERED cares about `AssociatedIrp.SystemBuffer`; DIRECT involves `MdlAddress`
- **NEITHER may even carry a raw user-mode virtual address directly**, and the I/O Manager is not responsible for locking or validating it for you (Microsoft states explicitly that a neither-I/O user address can be accessed safely only in the proper calling-thread context)

So a decompilation that shows the kernel dereferencing a "very low" address:

> **Do not immediately judge "the kernel pointer is corrupted"** — confirm first whether it is a METHOD_NEITHER user pointer.

In a security audit this should also raise priority immediately: `ProbeForRead` / `ProbeForWrite`, `try/except`, `RequestorMode`, and thread context become critical.

## 14. IRP control flow is not an ordinary function-call graph (the completion edge)

One of WDM's largest pitfalls is **asynchronous completion**:

```
Dispatch → IoCopyCurrentIrpStackLocationToNext → IoSetCompletionRoutine
  → IoCallDriver → STATUS_PENDING → ……the lower layer completes asynchronously → CompletionRoutine
```

- **`IoCallDriver` returning ≠ this I/O has ended**
- A completion routine that returns `STATUS_MORE_PROCESSING_REQUIRED` **stops the I/O Manager from continuing to complete the original IRP**, and lets the current driver take over the later processing (Microsoft states this explicitly)

A reversing CFG should add a class of edge: the **completion edge** — otherwise a lot of critical cleanup / copy-back / retry code looks like "nobody calls it" in an ordinary static call graph.

## 15. `STATUS_PENDING` is not a failure

When reversing a driver protocol, `status = IoCallDriver(...); if (status == STATUS_PENDING) ...` **must not** be read with user-mode intuition as "the request did not complete / the call failed" — this is normal asynchronous I/O.

The real final state is in `IRP->IoStatus.Status` and the completion path. When recording a protocol, distinguish:

- **dispatch return status**
- **final I/O completion status**

## 16. A `PAGE` section is semantics, not only a section name

Every section whose name starts with `PAGE` (`PAGE` / `PAGEABC` / `PAGEDATA` …) is treated as a **pageable section**.

- A function in `PAGE` → by design it should run only at an **IRQL that allows a page fault**
- The other way: code that corresponds to an ISR / DPC / spinlock-held path / `DISPATCH_LEVEL+` **must be resident**

So **the section itself is a clue to the calling context**.

## 17. An occasional 0xD1 is not necessarily random memory corruption

`DRIVER_IRQL_NOT_LESS_OR_EQUAL` (0xD1) is checked first for: the current IRQL, the fault address, read / write / execute, the faulting instruction, and **whether the target code / data is pageable** (the typical cause: accessing pageable memory / executing pageable code at DISPATCH_LEVEL or higher, or touching an invalid or already-freed pointer).

One particularly nasty class:

> 99.99% of the time it is fine, and a stress test suddenly explodes

It may only be that the `PAGE` section stayed resident the whole time, **until memory pressure actually paged it out**. So "it runs fine normally" ≠ "the IRQL / pageability is correct".

## 18. With Driver Verifier on, behavior can be **deliberately "abnormal"**

Verifier can actively do: Special Pool / Force IRQL Checking / Pool Tracking / I/O Verification / Deadlock Detection / DMA Verification / **Low Resources Simulation** / **Force Pending I/O Requests** / IRP Logging / synchronous-delay fuzzing / Code Integrity checking …

That is, it deliberately makes allocation fail, forces pending, changes timing, and evicts pageable memory more aggressively. Therefore:

- The experiment machine produces a lot of `STATUS_INSUFFICIENT_RESOURCES` as soon as Verifier is on → **do not misread that as "malware is exhausting resources"**; it may be verifier fault injection
- "It BSODs only with Verifier on" usually means the opposite: **a latent driver bug was amplified**

## 19. Verifier caught an IRP error: do not look only at the top of the crash stack

I/O Verification tracks the IRP lifetime and detects an illegal `IoCallDriver` argument, a repeated / wrong complete, completing an IRP that still has a cancel routine, a wrong IRQL change, an already-freed IRP, an event / IOSB whose stack lifetime has ended…… A violation triggers **0xC9 `DRIVER_VERIFIER_IOMANAGER_VIOLATION`**.

The **last function in this kind of crash may only be where verifier noticed the problem**; the real mistake may be dozens of steps earlier. Follow the whole chain:

```
allocation → forward → pending → cancel → completion → free
```

## 20. A static address ≠ a runtime address: think PE relocation first

A `.sys` is still a PE image; when it cannot be loaded at the preferred `ImageBase`, the loader applies base relocation from `.reloc`.

So `IDA: sub_140012340` vs `runtime: fffff806'72b12340` is normal. Before a memory-vs-disk comparison you must first:

```
runtime VA → subtract the runtime image base → RVA → compare the matching section
```

Otherwise you get a large number of false mismatches.

## 21. Finding a PDB still may not mean complete symbols

Windows RE's huge advantage is the PDB, but **public symbols** must be distinguished from **private / full symbols**: public usually does not give complete local variables, static functions, or source lines / the type universe.

So `nt!KeSomething` has a name, but a lot of internal `sub_xxx` do not, and **that does not mean symbol load failed** — you may only have public symbols.

## 22. The same PDB name does not mean a match (signature + age)

The symbol store selects the version by **signature + age** — the same file name means nothing. When you hit:

```
*** WARNING: Unable to verify timestamp / symbols could not be loaded
```

check exact binary / PDB matching first; in general `.symfix` → `.reload /f` → `!sym noisy` is more reliable than forcing on a PDB that "looks like the same version" by hand.

## 23. `!analyze -v` is an entry, not a conclusion

`Probably caused by : foo.sys` **cannot be written directly as "foo.sys is certainly the root cause"** — it may only be:

- the last one to dereference a bad pointer (the victim)
- a lower layer that already corrupted the memory
- the last identifiable module in a filter stack

In a pool-corruption / UAF / DMA-corruption scene, **the driver that really wrote the bad memory has often already left the stack**. Continue with `lm` / `locks` / `process` / `memory` / the bugcheck parameters.

## 24. UMDF: seeing a DLL + Wudfhost, switch thinking immediately

A UMDF driver is a DLL, loaded by **`Wudfhost.exe`**; Wudfhost is responsible for I/O dispatch, driver load, driver layering, the thread pool, and talking to the kernel reflector — **one Wudfhost can also host several UMDF drivers / device stacks at once**.

So `Wudfhost.exe` crashing **cannot be inferred as "Wudfhost itself has a bug"** — decide first: which UMDF DLL, which device stack, which callback.

`!wdfkd.wdfumdevstacks` can enumerate UMDF device stacks directly (usable from kernel debugging, or from user-mode debugging attached to wudfhost.exe):

```
!process 0 0 wudfhost.exe          # find the host process
.process /P <addr>                 # switch to that process
!wdfkd.wdfumdevstacks              # device stack / PDO name / UMDriver image path / transfer mode
```

Other useful commands: `!wdfkd.wdfumtriage`, `!wdfkd.wdfldr`, `!wdfkd.wdfumirps`, `!wdfkd.wdfumfile`, `!wdfkd.wdflogdump <drivername.dll> -m`.

## 25. A UMDF crash ≠ a kernel crash

UMDF runs inside a user-mode host, so a driver access violation **usually kills Wudfhost first**, rather than immediately bugchecking all of Windows.

- A UMDF dump is at **`%ProgramData%\Microsoft\WDF`** (from UMDF 2.15 / Win10 1507 on; before that it was `%windir%\system32\LogFiles\WUDF`); open it with `WinDbg -z <dmp>`, and **`!analyze` works on it too**
- A WER report has three event classes: `WUDFHostProblem` / `WUDFUnhandledException` / `WUDFVerifierFailure` (including ExitCode, Operation, Message (encoding the IRP's Major / MinorFunction), HardwareId)
- So once it is confirmed to be UMDF: a **userspace dump / process context** is usually more direct than grabbing a kernel dump first

## 26. "The driver exists but will not load": check signature and policy first, do not suspect DriverEntry first

From Win10 1607 on, a new release kernel driver in principle has to go through the Microsoft Hardware Dev Center (WHCP) signing path; a PnP package, a catalog, and a boot driver each have their own details. And **now (2026) there is a harder change**:

> Microsoft's Windows Driver Policy is explicit: **after the April 2026 security update, an old-style cross-signed driver is no longer trusted by default**, and the kernel accepts only a WHCP-signed driver by default (there is also a Microsoft-maintained allow list). It applies to Win11 24H2 / 25H2 / 26H1 and Server 2025 and later versions.

The rollout is staged: **it enters evaluation mode first** (audit only, no block; the system has to meet about 100 hours of uptime + 2–3 boot-related conditions before it switches to enforcement; if a non-compliant cross-signed driver is found during that time, it stays in evaluation mode and the counter resets); an enterprise can override it with an **Application Control for Business** (formerly WDAC) policy (the policy must be signed by an authority in the Secure Boot PK / KEK).

So when you hit:

> a ten-year-old `.sys`, the signature looks completely present, it used to load, and a new system suddenly blocks it

**do not judge "the signature is corrupt" directly** — it is very likely **the legacy signing policy has expired**.

## 27. Test Mode is also not "anything unsigned can run"

- Even with `TESTSIGNING ON`, in an environment with **HVCI / Memory Integrity** enabled, a test driver **still requires a digital signature** (it can just be a self-built test certificate)
- And HVCI **can still reject** a test-signed driver (in practice Memory Integrity has to be turned off temporarily to install / test)
- Also, with Secure Boot on, `bcdedit /set testsigning on` may be blocked or fail (most scenes require Secure Boot off)

So `TESTSIGNING=ON + unsigned .sys + load failed` **cannot be said to mean "Test Mode did not take effect"** — also look at HVCI / Memory Integrity, Secure Boot, and the signature. The typical load-failure code: **0xC0000428 (STATUS_INVALID_IMAGE_HASH)**, CodeIntegrity log **Event ID 219**.

## 28. A strange failure of an old driver under HVCI: it may be **the design itself that is incompatible**

The core of HVCI (Memory Integrity): **a kernel memory page can never be writable and executable at the same time (W+X)**, executable code cannot be modified directly, and kernel memory can become executable only through CI verification. The official compatibility requirements:

- NX by default, allocate with NX (`NonPagedPoolNx`)
- **Do not use a section that is both writable and executable**; **do not modify executable system memory directly**
- **Do not use dynamic code in the kernel** (a self-decrypting stub, JIT, code generated at runtime)
- Do not load a data file as executable; section alignment is an integer multiple of 0x1000

So if an old driver has: allocating an RWX pool / generating a trampoline / runtime-patching kernel text / JIT code — **it may run with HVCI off, and fail outright with HVCI on**.

> Do not think first "new Windows changed an undocumented API" — **what you may be hitting is CI / VBS policy**.

A time point to add: Microsoft plans, from **2026-10-13**, to **enable Memory Integrity by default** on qualifying Win11 devices (one precondition is exactly "there is no incompatible kernel driver").

## 29. The "kernel patching from an old tutorial" mindset is especially dangerous on x64

Microsoft explicitly requires that an x64 driver **should not** modify kernel code, the IDT / GDT, or undocumented kernel structures — that kind of behavior can trigger `CRITICAL_STRUCTURE_CORRUPTION` (the historical KPP exists to protect kernel code and critical structures).

So when analyzing a modern legitimate driver, if you **do not see** an SSDT hook / an inline ntoskrnl patch / an IDT hook, **that is not "it has less function"** — a modern driver should observe and control through a documented callback, a filter model, WFP, a minifilter, Ob callbacks, process / thread / image notify, and a registry callback.

## 30. A security product can monitor processes deeply without hooking the SSDT

Windows officially provides `PsSetCreateProcessNotifyRoutineEx*`, `ObRegisterCallbacks`, and similar; Microsoft's own sample demonstrates the combination "process-creation notification + process-handle access restriction".

So seeing an EDR / AV driver **with no SSDT hook absolutely cannot conclude "it does not monitor processes"**. Search the **callback-registration graph**:

```
PsSetCreateProcessNotifyRoutine* / PsSetCreateThreadNotifyRoutine*
PsSetLoadImageNotifyRoutine* / ObRegisterCallbacks / CmRegisterCallbackEx
FltRegisterFilter / Ndis*Register* / StorPort / WDF registration sites ...
```

That fits modern Windows better than looking for an inline hook.

## 31. A function with no xref at all can still be a callback

The Windows kernel is as callback-driven as Linux: DriverObject dispatch, PnP, ISR / DPC, timer, work item, completion routine, KMDF event, NDIS callback, FltMgr callback, Ob callback, registry callback, process notify……

So a decompiler showing **0 callers cannot automatically be marked dead code**. See first whether its address is:

```
written into a registration structure / passed to a registration API
written into the DriverObject / written into a WDF config
```

Windows driver RE should maintain both a **call graph and a callback-registration graph**.

## 32. The same IRP being touched by many drivers is normal

```
app → upper filter → function driver → lower filter → bus
```

Each layer may: modify the stack location, set a completion routine, forward, complete. So seeing "the same MajorFunction has a handler in four `.sys` files" **is not a duplicated implementation** — that is exactly the Windows layered I/O model.

When reversing, it is better to recover an **IRP flow graph**, not only each driver's separate CFG.

## 33. Completion behavior after a minifilter unloads is not necessarily a UAF

Filter Manager is specifically responsible for the minifilter lifetime, and it can coordinate operations that have not fully ended at unload time (it also allows a minifilter to unload dynamically and safely).

So a trace that shows "unload started → there is still an old I/O completion → only then it is fully gone" **does not automatically mean "unloaded code is still being called"**. Four states have to be distinguished precisely:

```
unload initiated → instance detach → outstanding operations drain → image actually gone
```

## Decision tree

```
Got a Windows driver
├─ decide the model first: WDM / KMDF / UMDF / minifilter / NDIS / miniport / filter driver
├─ the entry looks strange
│    ├─ GsDriverEntry? a framework wrapper? is the real DriverEntry one layer down?
├─ the IRP handler cannot be found
│    ├─ a KMDF callback? an NDIS / miniport callback? a minifilter callback? UMDF?
├─ recover the install context: INF / service / hardware ID / UpperFilters·LowerFilters / AddFilter
├─ recover I/O
│    ├─ DriverObject MajorFunction / IOCTL CTL_CODE / buffering method
│    ├─ IRP stack / pending / completion edge
├─ file system: FltRegisterFilter / FLT_REGISTRATION / pre-post callback / altitude
├─ addresses · symbols look wrong
│    ├─ PE relocation? runtime image base? PDB exact match? public vs private PDB?
├─ a random crash
│    ├─ IRQL? PAGE section? UAF / pool? pending / completion lifetime? DMA?
│    └─ is Driver Verifier on?
├─ the driver failed to load
│    ├─ architecture? signing? the 2026 legacy cross-sign policy? Secure Boot? HVCI? INF / PnP binding?
└─ suspect a rootkit
     ├─ do not look only for the SSDT → callback ownership / filter · device stack / registered notify callbacks
     ├─ loaded image · executable memory · runtime code integrity
     └─ cross-view + dump analysis
```

## Tool preparation

See [[re-analyze/platform-tips]] — driver load / kernel debugging is dynamic execution, and by default it happens inside a sandbox (the debugger VM); the static-analysis part does not need a sandbox.

- **Decompilation and driver types**: [[re-ghidra]] (the default; Data Type Manager imports Windows kernel types, and field names participate in decompilation directly) / [[re-ida]] (FLIRT kernel signatures + a type library). Verification: after importing the `.sys`, functions with parameter signatures can be decompiled
- **WinDbg kernel debugging** ([[re-windbg]]): two-machine / VM serial or KDNET. Verification: `lm` sees the target driver, `.reload /f <driver name>` loads symbols
- **Symbols**: the Microsoft public symbols `srv*C:\symbols*https://msdl.microsoft.com/download/symbols`; a driver-supplied PDB is placed under the same name; on a match problem use `.symfix` + `!sym noisy`. Verification: `!process 0 0` output has the `nt!` prefix
- **Test signing** (the debug VM only, and watch HVCI): `bcdedit /set testsigning on` and reboot (most scenes need Secure Boot off); verify `bcdedit /enum {current}` is Yes
- **WDF / UMDF extensions**: `!wdfkd.wdfumdevstacks` / `wdfumtriage` / `wdfldr` / `wdfumirps` / `wdflogdump`; a UMDF dump is in `%ProgramData%\Microsoft\WDF`
- **Verifier**: `verifier` (when analyzing a target bug, confirm first whether it is on; see §18–19)

## Pitfalls on this platform

- **Treating every `.sys` as WDM**: the WDM dispatch of KMDF / NDIS / miniport / minifilter is held by the framework
- **Treating `GsDriverEntry` as the business entry**; **treating an empty `MajorFunction` as "no I/O"**
- **Looking for an `IoCallDriver` chain on KMDF**: `!drvobj` pointing at Wdf01000.sys is normal; go find the Evt* callback (including the dataflow of `WDF_*_CONFIG`)
- **Looking for an IRP handler on a miniport**: go find the `Ndis* / StorPort / PortCls` registration callback; a NIC driver with no READ / WRITE is also normal
- **Attributing device behavior only to the function driver**: recover the AttachedDevice chain and the image owner first
- **Missing the INF**: `UpperFilters` / `LowerFilters` / `AddFilter` decide its position in the device stack
- **Treating a minifilter's pre / post pipeline as recursion**; **treating altitude as a version number**
- **Treating an IOCTL as a magic integer**: decode `CTL_CODE` first (especially Method)
- **Treating a `METHOD_NEITHER` user pointer as "a corrupted kernel pointer"**
- **Treating `IoCallDriver` returning as the I/O having ended**; **treating `STATUS_PENDING` as a failure**
- **Ignoring the IRQL semantics of a `PAGE` section**, and treating an occasional 0xD1 as random corruption
- **Treating Driver Verifier fault injection as malicious behavior**; **looking only at the top of a 0xC9 stack**
- **Doing a memory-vs-disk comparison and forgetting PE relocation**; **treating the same file name as a PDB match**
- **Treating `!analyze -v`'s "Probably caused by" as a conclusion**
- **Treating a Wudfhost crash as its own bug**; **analyzing a UMDF crash as a kernel crash**
- **Still judging "it will not load" by the old signing assumptions in 2026** (legacy cross-sign is no longer trusted by default; Test Mode also requires a signature under HVCI)
- **Treating a failure under HVCI as "the API changed"** (it is a design incompatibility such as W+X / dynamic code)
- **Judging whether a security product monitors by looking only for an SSDT hook**; **treating 0 xrefs as dead code**

## Appendix: two Windows-only appendices

- [[windows-gotchas]] — **the version-difference group**: structure layout (EPROCESS / DRIVER_OBJECT / _KPCR offsets change with the build), exported symbols (`KeServiceDescriptorTable` is not exported from Win8 on), signing requirements (attestation and similar), PatchGuard getting stronger with the version — the same piece of experience can give opposite conclusions on different Windows versions
- [[windows-decision-tree]] — the Windows-only scenario decision tree and **evidence grading** (target type → static mainline / interaction loop / rootkit branch)
