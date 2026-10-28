# PI stage model: SEC / PEI / DXE / BDS / Runtime / SMM

<CORE RULE>
**Treating PE32/PE32+ as an ordinary Windows PE application is the first judgment error this domain must rule out.**

The first step is always **determine the stage and the module type**:

```
SEC → PEI → DXE → BDS → OS / Runtime
```

Inside one firmware image, modules from different stages run in **completely different execution environments**: available memory differs, callable services differ, and lifetime differs. **If the module type is wrong, every later "why is it written this way" inference is wrong.**
</CORE RULE>

## 1. Classify first (this decides everything after)

| Type | Stage | Notes |
|---|---|---|
| SEC | earliest | security/init entry; no general memory environment yet |
| PEIM | PEI | early init; the service form is **PPI** |
| DXE driver | DXE | the service form is **Protocol**; exists only in the boot-services environment |
| **DXE runtime driver** | DXE + Runtime | **crosses lifetimes**: still present after `ExitBootServices()` |
| UEFI driver / UEFI application | after DXE/BDS | closer to "an application running in the UEFI environment"; not the same as a firmware-built-in module |
| SMM/MM driver | independent | executes inside SMM; privilege level and lifetime are their own system |

**Criterion priority**: INF `MODULE_TYPE` (if you can get it) > section/file type > imported services (PPI vs Protocol vs Runtime Services) > behavior.

## 2. What is special about PEI: there may be no "ordinary memory" yet

- Early PEI **may have no ordinary DRAM yet**. One of PEI's main jobs is to **establish permanent memory** and hand the information to DXE as a **HOB**
- PEI uses **PPI**, not Protocol — **not finding `LocateProtocol` in a PEI module is normal**. What you look for is PPI install/locate
- Strictly, the DXE stage does not depend on PEI existing: **the minimum requirement for DXE to execute is "a legal HOB list"**

## 3. HOB: cross-stage data. "An input with no producer" is usually this

**When "a function reads a run of structures with no ordinary producer cross-reference" — consider the HOB list first.**

- The HOB list is the handoff state PEI gives DXE: a contiguous table that starts with the **PHIT HOB** (first, required) and ends with End of HOB List
- The table usually contains: memory resource descriptors (DXE uses them as physical memory), firmware volume (FV) HOBs, memory-allocation module HOBs, the BSP stack HOB, and so on
- **One-way handoff**: only the PEI stage can add/modify HOBs. **After it is handed to DXE the whole table is read-only**
- Therefore **a DXE-side call that constructs a HOB (the `Build*Hob` family) asserts** — seeing those call sites in DXE code means either this is PEI code misclassified, or it is leftover/debug code
- HOB self-consistency constraints are also recognizable: length is 8-byte aligned, it must not contain a pointer to other data inside the HOB table (it must be copyable as a whole without adjusting internal pointers), and it is **append-only, never deleted**
- When DXE wants to express a state change such as "enter recovery mode" it **cannot modify the HOB**. It can only take a reset call — so "Boot Mode in the HOB disagrees with current behavior" is usually not tampering

## 4. A GUID is not ordinary UUID metadata: do GUID dictionary resolution

The same GUID string can be completely different things in UEFI:

```
Protocol / PPI / Firmware File / HOB / Variable namespace / Configuration table
```

**An RE system should resolve a GUID into a symbol** (equivalent to symbol recovery):

```
LocateProtocol(&some_guid)
  → recover as LocateProtocol(EFI_XXX_PROTOCOL_GUID)
  → interface vtable
  → method calls
```

- **The protocol graph is often more meaningful than an ordinary call graph**: modules decouple through Protocol. The call relationship hides in "who installs, who locates", not in a direct call
- Variable namespaces are the same: seeing only `GetVariable`/`SetVariable` without the GUID means you did not understand what it reads

## 5. A firmware dump cannot only carve PE magic

The spec itself defines the hierarchy:

```
Firmware Volume → FFS file → section → PE32/TE image
```

- "The firmware has many PEs" because there are hundreds or thousands of modules. But **carving directly on the PE magic drops ownership** (which FV, which FFS file, what section type)
- Ownership goes through the FV/FFS/section hierarchy (tools are in [[re-uefi]] main document steps 1–2). **Nested FVs and compressed sections are normal**. Expanding only the outer layer misses pieces

## 6. Lifetime: `DXE_DRIVER` and `DXE_RUNTIME_DRIVER` are not the same thing

- **`DXE_DRIVER`**: exists only in the boot-services environment, and is destroyed at `ExitBootServices()`
- **`DXE_RUNTIME_DRIVER`**: runs in **both** the boot-services and runtime-services environments. Its services remain available after `ExitBootServices()`, while the OS is running. When `SetVirtualAddressMap()` is called, **this class of module is relocated according to the virtual-address map the OS supplies**
- After `ExitBootServices()`: **Boot Services, DXE Services, and services provided by boot service drivers are all unusable** — the DXE Foundation itself belongs to boot services, so **no DXE Foundation code may remain into runtime**
- Two actions related to `SetVirtualAddressMap()` must be recognizable:
  - The driver registers an `EVT_SIGNAL_VIRTUAL_ADDRESS_CHANGE` event at entry (for example `CreateEventEx` with `gEfiEventVirtualAddressChangeGuid`)
  - The notification function uses **`ConvertPointer()`** to change pointers in self-managed data structures from physical addresses to virtual addresses
- **The virtual-address-change notification function must not call any Boot Services / Console Services / Protocol Services** (directly or indirectly) — because those services are already unavailable. **Seeing "it calls nothing" inside the notification function is often a design constraint, not trimmed code**
- `EFI_RUNTIME_ARCH_PROTOCOL` carries two states that work as criteria: **`VirtualMode`** (whether `SetVirtualAddressMap()` has been called) and **`AtRuntime`** (whether `ExitBootServices()` has been called) — a ready-made basis for judging "which lifetime we are in" on site

**Key corollary**: **firmware address ≠ OS runtime address**. The same runtime code has different addresses in the two stages. **That is not necessarily a hook, and not necessarily a relocation error**. To judge tampering, you must first state "which stage's mapping you compared".

## Decision tree

```
You have a .efi / firmware module
├─ Determine stage and module type (SEC / PEIM / DXE / DXE runtime / UEFI app / SMM)
│    ├─ PPI semantics only → PEI
│    ├─ uses Protocol → DXE environment
│    └─ has runtime services / registered a virtual-address-change event → DXE_RUNTIME_DRIVER
├─ An input has no producer cross-reference
│    └─ treat it as a HOB list first (PEI→DXE one-way, DXE read-only); not finding a constructor in DXE is normal
├─ A run of GUIDs is unreadable
│    └─ do GUID dictionary resolution: separate Protocol/PPI/FFS/HOB/variable namespace/configuration table
│         → recover the protocol graph from "who installs, who locates", instead of chasing direct calls
├─ File ownership is unclear
│    └─ locate by the FV → FFS → section hierarchy (nesting and compression are normal); do not carve directly on the PE magic
└─ Address/behavior does not match
     ├─ which stage's address map was compared? (firmware address vs OS runtime address)
     ├─ did the runtime code go through SetVirtualAddressMap + ConvertPointer
     └─ what are AtRuntime / VirtualMode right now
```

## Tools and verification

- Stage/type: prefer the module's own type information (INF `MODULE_TYPE`, section type, kind of imported service). If you cannot get it, infer from "which layer the services it calls belong to"
- HOB: parse the HOB list item by item starting at the PHIT HOB, and build the "which stage produces, who consumes" correspondence
- GUID: build a GUID→symbol dictionary (protocol name, PPI name, FFS file, variable namespace), and turn `LocateProtocol`-class calls back into semantic names
- Ownership: restore the FV → FFS → section hierarchy. Do not talk about a PE outside that hierarchy
- Verify: you can state at once "stage + module type (runtime or not) + service layer depended on (PPI/Protocol/Runtime) + which stage the address map is in"

## Pitfalls of this platform (summary)

- **Treating PE32/PE32+ as an ordinary Windows PE application**: determine stage and module type first. The execution environment is completely different
- **Looking for `LocateProtocol` in a PEI module**: PEI's service form is PPI
- **Treating a HOB as "ordinary global data"**: it is the PEI→DXE one-way handoff, and the DXE side is read-only. Looking for a constructor in DXE finds nothing, and a constructor call also asserts
- **Thinking a HOB can be modified by DXE**: a state change can only take a reset call. You cannot modify the HOB
- **Treating a GUID as a UUID with no meaning**: it may be any of Protocol/PPI/FFS/HOB/variable namespace/configuration table, and must be resolved into a symbol
- **Looking only at the direct call graph and ignoring the protocol graph**: the real coupling between modules is "who installs, who locates which Protocol"
- **Carving firmware directly on the PE magic**: drops FV/FFS/section ownership, and also misses nesting and compression
- **Not distinguishing `DXE_DRIVER` from `DXE_RUNTIME_DRIVER`**: the former no longer exists after `ExitBootServices()`, and the latter crosses lifetimes and is relocated by `SetVirtualAddressMap()`
- **Treating "the runtime notification function calls no service" as an anomaly**: that is a hard constraint (the services are already unavailable), not a code problem
- **Comparing a firmware address directly with an OS runtime address and calling it a hook**: first confirm which stage's mapping it is, and whether it went through `ConvertPointer`
