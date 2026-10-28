# System-identification fingerprint table

**Use**: judge from evidence **which system the target belongs to**. [[cross-system-models]] answers "what to suspect first when something looks abnormal". This file answers the step before that — **"what am I looking at"**.

**Where the criteria come from**: this file introduces no new assertions. Every criterion is taken from a skill branch already checked in this library (the "tools and verification" section at the end of each branch).

## Two-axis annotation of a criterion (important)

**A criterion has two independent properties, "how unique" and "how easy to see".** Mixing them pulls the conclusion off course:

| Axis | Value | Meaning |
|---|---|---|
| **Specificity** | `unique` | only that system has it |
| | `high` | a few systems share it; exclusion is also required |
| | `weak` | can only narrow to a family |
| **Observability** | `stable` | usually still visible after symbols are stripped (in-structure magic, container magic, required export names) |
| | `build-dependent` | depends on whether it was stripped / whether strings were kept / whether config ships with the product |
| | `runtime-only` | obtainable only from a running system, traffic, or a runtime interface |

**An annotation looks like `unique·stable`.** A typical misuse: treating a `unique·build-dependent` criterion (such as a module-name suffix) as "must be visible", then concluding "not that system" for a stripped product — **not seeing it does not mean it is absent**. The Chinese annotation tokens, kept as search literals, are `独有`, `高`, `弱`, `稳定`, `视构建`, `仅运行期`.

## 0. Attribute the evidence first (evidence_scope)

**The same string, attributed to different objects, points at completely different conclusions.**

| scope | Meaning | Typical source |
|---|---|---|
| `container` | the container itself | firmware package, disk image, update package |
| `executable` | the executable currently being analyzed | main binary |
| `embedded payload` | an embedded payload inside the container (**it may belong to another system**) | a rootfs embedded in firmware, an MCU blob |
| `guest` | a guest under virtualization / partitioning | VM image, partition image |
| `dependency` | a linked or depended-on component | static library, third-party `.a`, sysroot |
| `toolchain artifact` | a toolchain product (not the runtime subject) | compiler sysroot, sample config, debug symbols |
| `documentation` | documentation / comments / examples | README, sample config |

**Rule: first decide "who this evidence belongs to", then decide "which system it is".**

When a firmware image contains a Linux rootfs, an MCU blob, a guest image, and a compile-time sysroot at the same time, finding any one of `procnto`, ARXML, `seL4_*`, or a FreeRTOS signature string **cannot** answer "what system is the subject currently being reversed" — **the evidence is true and the attribution is wrong**. That is the most common way this kind of target goes off the rails.

**What to do**:

```
1. List every recognizable object in the container and mark each scope
2. Decide which scope the analysis subject (the user's target) belongs to
3. Compare fingerprints only inside the same scope
4. A hit across scopes is recorded only as "existence", not as evidence of the subject's identity
```

**The richer the fingerprint table, the more this matters**: once there are more criteria, false hits across scopes increase with them.

## 1. Four-layer flow

```
(1) Carrier and format: what did I receive (module / image / config / dump / traffic)
(2) Super-family narrowing: a few questions place it in one family
(3) Identification inside the family: rule out row by row on that family's table
(4) Easy-to-confuse pairs and negative criteria: when an easy-to-confuse pair hits, use the special criteria; close with "seeing X means it is not Y"
```

**The order must not be reversed**: settle scope, then format, then family, then system. Skipping the early layers and guessing a system produces a string of conclusions that "look familiar but none of them fit".

## 2. Super-family: carrier and format

| Carrier | Conclusion or next step |
|---|---|
| ELF and the type is **ET_REL** | **[weak·stable]** only says "this is a **relocatable ELF**" (kernel modules often use this form, but not only kernel modules) → also hit a symbol such as `.modinfo` / `__this_module` / `vermagic` before raising it to "Linux loadable kernel module" |
| ELF executable, `EI_OSABI` is not 0/3 | identify the system from the OSABI table in section 6 |
| ELF with `.note.openbsd.ident` / `.note.netbsd.ident` / `.note.tag` (FreeBSD) | **[unique·stable]** the matching BSD → section 3.1 |
| PE32/PE32+, subsystem = EFI-related | UEFI module → section 3.6; otherwise section 3.1 Windows |
| PE, `.sys` extension, exports `DriverEntry`/`GsDriverEntry` | Windows driver model → section 3.1 |
| Mach-O (KEXT bundle / `.dext`) | macOS family → section 3.1 |
| no standard container, contains `0x00ff7eeb` + `"imagefs"` | **[unique·stable]** QNX IFS image → section 3.2 |
| firmware structure (FV → FFS → section) | UEFI/PI → section 3.6 |
| XML config + partition / major-frame vocabulary | partitioned hypervisor or partitioned RTOS → section 3.4 / section 3.5 |
| config in the form of a C source file (contains something like `struct config`) | static partitioned hypervisor → section 3.5 |
| ARXML | AUTOSAR → section 3.8 |
| a large amount of EBCDIC text, record-oriented data sets | mainframe → section 3.7 |
| a single image containing init-table sections and a set of `uk_*` symbols | Unikraft → section 3.9 |
| OCaml source / Lwt calls | MirageOS → section 3.9 |

## 3. Identification inside the family

### 3.1 UNIX / Windows family kernels and drivers

| System | Carrier and structure | Criteria |
|---|---|---|
| **Linux** | `.ko` = ET_REL; may have a signature trailer, livepatch sections, BTF/split BTF | `.modinfo` / `__this_module` / `vermagic` **[unique·stable]**; `module_init` **[unique·build-dependent]** |
| **Android** | also an ELF module, constrained by KMI | ACK branch string, KMI symbol list, protected symbol **[high·build-dependent]** |
| **FreeBSD** | `.ko` (KLD, ELF); **linker-set registration** | `set_sysinit_set` / `__start_set_*` **[unique·build-dependent]** (invisible after strip) |
| **NetBSD** | `.kmod` | `module_autoload` / `MODCTL_*` **[unique·build-dependent]** |
| **OpenBSD** | the kernel is **relinked at random on every boot** (KARL) | user-mode `.note.openbsd.ident` **[unique·stable]**; link kit / rc relink script **[high·build-dependent]** |
| **illumos / Solaris** | `.so` kernel module (DDI/DKI) | `_init`/`_fini`/`_info` + `modlinkage`/`modldrv`/`dev_ops`/`cb_ops` **[unique·stable]** (required exports); `nulldev` and `nodev` both present **[unique·build-dependent]** |
| **macOS** | KEXT (Mach-O, inside AuxKC) / DEXT (user mode) | `IOKitPersonalities` **[high·build-dependent]**, `__TEXT_EXEC` segment **[unique·stable]**, `Info.plist` **[unique·stable]** (present in the bundle) |
| **Windows** | `.sys` (PE) | **split the driver model first**: WDM (`DriverEntry` + `MajorFunction[]` **[unique·stable]**), KMDF (points at `Wdf01000.sys` **[unique·build-dependent]**), minifilter (`FltRegisterFilter` **[unique·build-dependent]**), NDIS (`Miniport*`/`Ndis*` **[unique·build-dependent]**) |

### 3.2 Capability / user-mode-driver kernels

| System | Criteria | Structure clues |
|---|---|---|
| **seL4** | `seL4_*` / `seL4_Call` **[unique·build-dependent]** | **capDL `.cdl`** and CAmkES ADL are worth more than the symbol table |
| **Fuchsia / Zircon** | `zx_*` / `fidl_*` **[unique·build-dependent]** | component manifest, bind-rules bytecode, driver-host split |
| **Genode** | service names `session` / `ROM` / `IO_MEM` / `IO_PORT` / `IRQ` **[high·build-dependent]** | init XML (`<route>` / `<start>`) **[unique·stable]** (when the config is at hand) |
| **HelenOS** | `driver_ops_t` / `devman_driver_register` / `ddf_fun_*` **[unique·build-dependent]** | fibril (user-mode cooperative scheduling) **runtime-only** |
| **Redox** | `:SCHEME_NAME` / SQE-CQE / `relibc` / `redox-rt` **[unique·build-dependent]** | initfs and the driver directory **[high·stable]** |
| **Haiku** | module name ends in `driver_v1` / `device_v1` **[unique·build-dependent]** (**may not be visible after symbols are stripped**) | device_node tree, KDL |
| **MINIX 3** | service label + endpoint, RS/SEF **[high·runtime-only]** | user-mode services and `REQ_*` messages |
| **Plan 9 / 9front** | 9P messages (`Tversion`/`Tattach`/`Twalk`) **[unique·runtime-only]** | `/srv`, fid, per-process namespace |
| **HIC** | **self-describing module metadata** (UUID/version/endpoints/resources/dependencies/signature) **[unique·stable]**; **entry-page IPC shape** **[unique·runtime-only]** | same privilege level + MMU isolation; capability accounting has generation differences |
| **QNX Neutrino** | `procnto` / `"imagefs"` / IFS magic `0x00ff7eeb` **[unique·stable]** | `io-*` / `devb-*` / `devc-*` **[high·build-dependent]**; `devnp-*.so` **[unique·build-dependent]** |

### 3.3 RTOS

| System | Criteria | Structure clues |
|---|---|---|
| **FreeRTOS** | `"FreeRTOS"` string, `pxCurrentTCB`, `pxReadyTasksLists` **[unique·build-dependent]** | `pcTaskName`, stack fill `0xa5` **[high·build-dependent]** |
| **ThreadX** | `tx_kernel_enter`, `_tx_thread_created_list` **[unique·build-dependent]** | **object-header magic** (THRD `0x54485244`, QUEU, SEMA, MUTE, ATIM…) **[unique·stable]** |
| **ThreadX Modules** | `txm_*`, `_txm_module_kernel_call_dispatcher` **[unique·build-dependent]** | **the module preamble must be at the module's first address** **[unique·stable]** |
| **RT-Thread** | `rt_thread_ready_priority_group`, `rt_thread_priority_table` **[unique·build-dependent]** | `rt_system_scheduler_start` |
| **Zephyr** | `DEVICE_DT_DEFINE` / `SYS_INIT` **[unique·build-dependent]** | devicetree + Kconfig **[high·build-dependent]**; iterable section **[unique·build-dependent]**; `__init_PRE_KERNEL*` sections in the map |
| **NuttX** | `syscall.csv` / `drivers_early_initialize` **[unique·build-dependent]** | three builds, FLAT/PROTECTED/KERNEL **[high·runtime-only]**; upper/lower half **[unique·build-dependent]** |
| **VxWorks** | `tIdle` / `tRootTask` **[unique·build-dependent]** | `WIND_TCB` / `td_*` **[unique·build-dependent]**; `.out` (DKM) / `.vxe` (RTP) **[unique·stable]**; VSB/VIP **[unique·stable]** |
| **RTEMS** | `CONFIGURE_INIT` / `Device_drivers` **[high·build-dependent]** | `confdefs.h` build-time config, `rtems_driver_address_table` **[unique·build-dependent]** |
| **eCos** | `CYG_*`, `cyg_hal_invoke_constructors`, `hal_vsr_table`, `CYG_ISR_CALL_DSR` **[unique·build-dependent]** | CDL, `mlt_*.ldi`, RedBoot, virtual vector table **[unique·build-dependent]** |
| **µC/OS (Micrium)** | `OSIntEnter` / `OSIntExit` / `OSSchedLock` **[unique·build-dependent]** | `OS_TCB`, `OS_TmrTask` |
| **TI SYS/BIOS** | `ti.sysbios.knl.*`, `Swi_*` / `Hwi_*` / `Task_*` **[unique·build-dependent]** | Hwi > Swi > Task layering **runtime-only** |
| **SAFERTOS** | something like `xMPUSetTaskRegions` **[high·build-dependent]**; **same origin as FreeRTOS but not the same binary** | ESM ACP / OACP / indirect object ID **[unique·build-dependent]** |
| **CMSIS-RTX5** | `osRtxError*` / `RTX_Config.h` / `OS_SAFETY_FEATURES` **[unique·build-dependent]** | `osThreadZone` / safety class / thread watchdog **[unique·build-dependent]** |
| **T-Kernel** | `tk_def_dev` / `tk_rea_dev` / `tk_wai_dev` **[unique·build-dependent]** | three execution contexts **runtime-only** |
| **TOPPERS** | `act_tsk` / `sta_cyc` **[high·build-dependent]** | **identify the family first** (ASP3 / HRP3 / FMP3 / HRMP3) **[high·build-dependent]** |
| **OSE / OSEck** | `hunt` / `attach` / `send` / `receive` / `SIGSELECT` **[unique·build-dependent]** | the signal queue belongs to the process **runtime-only** |
| **Nucleus** | `NU_Create_*` / `NU_Allocate_Partition` **[unique·build-dependent]** | `NU_PARTITION_POOL` (**do not mix this with a spatial isolation domain**) |

### 3.4 Partitioned / safety RTOS

| System | Criteria | Structure clues |
|---|---|---|
| **INTEGRITY / INTEGRITY-178** | ARINC 653 APEX service names **[high·build-dependent]** | space / time / resource, three domains; static startup table **[unique·build-dependent]** |
| **PikeOS** | **APEX service table linked at a fixed address** **[unique·stable]** | three layers: partition scheduler → system thread → guest scheduler **runtime-only** |
| **ARINC 653 / VxWorks 653** | `major frame` / `partition window` / `SET_PARTITION_MODE` **[unique·build-dependent]** | partition mode, sampling port vs queue port **runtime-only** |
| **Deos** | three scheduling models coexist (ARINC 653 + RMS + POSIX) **[unique·build-dependent]** | cross-core aligned time windows + per-core scheduler, slack, SafeMC **[unique·build-dependent]** |

### 3.5 Hypervisor

**Host-side vendor strings** (CPUID leaf 0x40000000): `KVMKVMKVM`, `Microsoft Hv`, `VMwareVMware`, `XenVMMXenVMM` — **[unique·runtime-only]**.

| System | Criteria | Structure clues |
|---|---|---|
| **Xen** | XenStore path, `backend-id`, `ring-ref`/`event-channel` keys **[unique·runtime-only]**; `/dev/xen/evtchn` **[unique·stable]** | grant table / shared ring / event channel; `shared_info` bitmask |
| **Hyper-V / VMBus** | VMBus bus, `netvsc` / `storvsc` **[unique·runtime-only]** | VSC/VSP, GPADL, SR-IOV data-plane switch |
| **ACRN** | `IVSHMEM_ENABLED` / `IVSHMEM_REGION` / `acrn-dm`; `dm:/` and `hv:/` prefixes **[unique·build-dependent]** | Service VM / pre-launched / post-launched, three layers |
| **Jailhouse** | `.cell` config **[unique·stable]**; console string `Parking CPU n (Cell: ...)` **[unique·runtime-only]** | cell descriptor (memory-region flags, PCI/IRQ ownership) |
| **Bao** | C source config `struct config` / `shmemlist` / `vmlist` / `shmem_id` **[unique·build-dependent]** | exclusive CPU/memory/interrupt; vCPU and pCPU 1:1 |
| **XtratuM** | XM_CF XML (`<Partition>` / `<CyclicPlanTable>` / `<PortTable>`) **[unique·build-dependent]** | Plan 0 init / Plan 1 maintenance; IPVI |
| **QNX Hypervisor** | shmem **factory-page** fields (`name`/`size`/`shmem`/`vector`/`status`) **[unique·build-dependent]** | three address layers; vdev |
| **LynxSecure** | thin criteria: **no driver or I/O stack in the kernel**, no management-console entry **[unique·runtime-only]** | immutable boot partition; kernel function limited to three duties |
| **Quest-V** | thin criteria: **one monitor per sandbox**, very few VM-exits, no global clock **[unique·runtime-only]** | the monitor intervenes only at boot / fault / shadow page tables / channel setup |

> **Two systems with thin criteria** (LynxSecure / Quest-V) are not settled by strings — they are settled by **structure and behavior** (see each branch).

### 3.6 Firmware and boot

| System | Criteria | Structure clues |
|---|---|---|
| **UEFI / PI** | PE32/PE32+ and the subsystem is an EFI class; dense GUIDs **[unique·stable]** | **FV → FFS file → section → PE32/TE**; HOB; `MODULE_TYPE`; PPI (PEI) vs Protocol (DXE) vs Runtime Services |

### 3.7 Mainframe

| System | Criteria | Structure clues |
|---|---|---|
| **z/OS** | EBCDIC text + record-oriented data sets + JCL **[high·stable]** | load module / program object; TCB/SRB; AMODE/RMODE; whether XPLINK |
| **IBM i** | `library/object` qualified name, object types `*PGM` / `*SRVPGM` / `*MODULE` **[high·runtime-only]** | single-level store; MI/TIMI/SLIC layers; activation group. The qualified-name literal is `库/对象` |
| **OpenVMS** | **`ELFOSABI_OPENVMS` = 13** **[unique·stable]**; DCL command files **[high·stable]** | `.EXE` image, `SYS$SHARE:`, logical names, AST / `$QIO`, RMS, descriptor calling standard |

### 3.8 Automotive software

| System | Criteria | Structure clues |
|---|---|---|
| **AUTOSAR Classic** | ARXML + `Rte_*` interfaces **[unique·stable]** | Runnable / RTEEvent / OS Task mapping; `E_OS_ACCESS`; BSW |
| **AUTOSAR Adaptive** | three Manifests (Execution / Service Instance / Machine) **[unique·stable]** | `ara::com`, Function Group State / Machine State, `Checkpoint` (PHM), UCM and Persistency |

### 3.9 unikernel

| System | Criteria | Structure clues |
|---|---|---|
| **Unikraft** | `uk_*` symbols + `uk_syscall_e_*` / `uk_syscall_r_*` appearing as a pair **[unique·build-dependent]** | init-table sections (constructor / early / platform / library / rootfs / system / late); Kconfig |
| **MirageOS** | OCaml source + Lwt calls **[unique·stable]** | a single static ELF; device wiring comes from build-time config |

## 4. Easy-to-confuse pairs

| Easy to mix | Criteria that separate them |
|---|---|
| FreeRTOS / ThreadX / µC/OS / RT-Thread | look at the object-header **magic** (ThreadX-only, and strip does not remove it) → then look at unique symbols |
| Zephyr / NuttX | both have a Kconfig-style build; **Zephyr has devicetree + iterable sections**; **NuttX has `syscall.csv` + upper/lower half** |
| VxWorks / QNX | `.out`/`.vxe` + `tIdle` vs **IFS magic + `procnto` + `devnp-*.so`** |
| FreeBSD / NetBSD / OpenBSD | **linker set `set_*`** vs **`.kmod` + autoload** vs **KARL relink + `.note.openbsd.ident`** |
| illumos / Linux | illumos has `_init`/`modlinkage`/`dev_ops`; it does **not** have `module_init`/`file_operations`; `nulldev` and `nodev` are two placeholders |
| seL4 / Fuchsia / Genode | `seL4_*` + capDL vs `zx_*` + bind rules vs `session` + init XML |
| Jailhouse / Bao / XtratuM | `.cell` vs **C source `struct config`** vs **XM_CF XML** |
| ACRN / Xen | ACRN has the Service VM three layers and `dm:/` `hv:/` prefixes; Xen uses XenStore paths + grant/event |
| QNX Neutrino / QNX Hypervisor | the former is a resource-manager ecosystem; the latter has `qvm` config and a shmem **factory page** |
| MINIX 3 / Plan 9 / Redox | RS + endpoint vs 9P + `/srv` vs scheme + SQE/CQE |
| Haiku / BeOS | Haiku module names end in `driver_v1`/`device_v1`; **the debug interface and filesystem API are incompatible with BeOS** |
| HIC / Fuchsia | HIC has **self-describing module metadata** and an **entry-page IPC shape**; Fuchsia has a driver host and bind rules |
| z/OS / IBM i / OpenVMS | EBCDIC + data sets + JCL vs `library/object` (`库/对象`) vs **`ELFOSABI=13`** + DCL |
| INTEGRITY / PikeOS / Deos / ARINC 653 | all talk about partitions; **PikeOS's APEX service table is linked at a fixed address**, and **Deos's three scheduling models coexist**, which can separate them |
| LynxSecure / Quest-V | both have "no central scheduler"; the former is an **immutable static partition**, the latter is **one monitor per sandbox** |

## 5. Negative criteria (seeing X means it is not Y)

| See | Can rule out directly |
|---|---|
| `set_sysinit_set` / `__start_set_*` | Linux (that is FreeBSD's linker set) |
| `_init` + `modlinkage` + `dev_ops` | Linux, FreeBSD (that is the illumos/Solaris DDI/DKI skeleton) |
| `0x00ff7eeb` + `"imagefs"` | any Linux/BSD |
| `procnto` / `devnp-*.so` | any non-QNX system |
| ARXML / `Rte_*` | general RTOS and desktop OS |
| large-scale EBCDIC records | any Unix family |
| `.cell` | Xen / ACRN / Bao / XtratuM |
| `struct config` + `shmem_id` | hypervisors other than Bao |
| ThreadX object-header magic | FreeRTOS / µC/OS / RT-Thread |
| `ELFOSABI` = 9 / 2 / 12 / 13 | FreeBSD / NetBSD / OpenBSD / OpenVMS respectively. **Do not treat them as "BSDs are all about the same"** |

## 6. `EI_OSABI` value reference

NONE=0, HPUX=1, **NETBSD=2**, LINUX=3, HURD=4, 86OPEN=5, **SOLARIS=6**, AIX=7, IRIX=8, **FREEBSD=9**, TRU64=10, MODESTO=11, **OPENBSD=12**, **OPENVMS=13**, NSK=14, ARM=97, STANDALONE=255.

- **The note segment and OSABI are two independent identifiers**: BSD notes are more common (see section 3.1). OpenVMS uses OSABI=13
- Note: in 2000 there was a proposal FREEBSD=4 / NETBSD=5 / OPENBSD=6, **different from the current values** — this table uses the current values
- OSABI 0 (NONE) is the common case. **It cannot be inverted into "not some system"**

## 7. Identification flow (one page)

```
0. Evidence attribution: which objects are in the container? What is each scope? Which one is the subject?
1. Carrier and format: PE / ELF (ET_REL?) / Mach-O / imageless container / config / dump / traffic
2. ELF: read EI_OSABI and the note segment first → often settles the system in one step
3. Imageless container: look for magic and signature strings (IFS, firmware volume, RTOS signature strings)
4. Config present: the config format itself is a strong criterion (.cell / XM_CF / ARXML / manifests / Kconfig+devicetree)
5. Symbols and names: rule out row by row; an easy-to-confuse hit goes to section 4
6. Still unsettled:
   ├─ look at "what is missing": no driver and I/O stack? no central scheduler?
   └─ look at the runtime-visible surface: system-info interface, debugger commands, debug-interface type
7. After it is settled → [[cross-system-models]] for that system's "normal abnormalities", then enter the matching branch from table A in [[rerouting]]
```

## 8. Usage notes

- **Settle scope before settling the system**: a hit across scopes is recorded only as "existence", not as evidence of the subject's identity (section 0)
- **Keep the two axes separate**: not seeing a `unique·build-dependent` criterion **does not mean it is absent** — on a stripped product, a missing criterion is not counter-evidence
- **A `weak` criterion must be combined**: ET_REL only narrows to "relocatable ELF". It cannot settle Linux directly
- **An easy-to-confuse pair's decision outranks a single feature**: when section 4 hits, follow that row's special criteria
- **If you cannot decide, do not force a decision**: a settled family with an unsettled system is better than guessing a system and sending the whole analysis chain off course. Advance on the family-level branch (for example the [[re-rtos]] main document)
- When adding a system branch, **add a row to this table in the same change** (the criterion must carry the two-axis annotation and a scope note)
