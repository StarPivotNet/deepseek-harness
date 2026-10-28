# VxWorks: DKM / RTP / the global symbol environment

<CORE RULE>
The first step is not parsing ELF. It is **separating the two execution models**:

| Model | Artifact | Where it runs | Address space |
|---|---|---|---|
| **DKM** (Downloadable Kernel Module) | `.out` | **kernel mode** (supervisor mode) | the same address space as the kernel |
| **RTP** (Real-Time Process) | `.vxe` | **user mode** | each one independent, MMU-protected |

**Do not parse `.out` as a Linux `.ko`.** What is special is not the format. It is the **symbol environment**: a DKM is "linked against the kernel symbol table". Look at it without the target image and the global symbol environment and **you will always see a pile of unresolved symbols** — that is not corruption. It is the model.
</CORE RULE>

## 1. DKM: kernel mode, symbols come from the running image

- It runs in supervisor mode and **can be statically linked into the kernel image or loaded dynamically**
- **`.out` is dynamically linked against the kernel symbol table** — its external references point at **the target image's global symbol environment**
- How it is loaded: `ld < my_first_dkm.out` in the target shell (the module's `usrAppInit` then runs automatically), or `module load <path>` through the debugger
- On-target checks: `lkup "symbol name"` looks up a symbol; `moduleShow` / `taskShow` show modules and tasks
- **The typical load failure is `undefined symbol`**: the DKM calls a component that **was not included when the VIP kernel was built** — the fix is to add the component to the VIP configuration and rebuild the VIP (then rebuild the DKM), **not "fix the DKM itself"**
- To make later diagnosis easier, the VIP can turn on `INCLUDE_STANDALONE_SYM_TBL` (a built-in symbol table) so crash / startup information gives a more meaningful call stack

## 2. RTP: user mode, standard ELF and `.so` linking

- Each RTP has its own virtual address space and MMU protection; **one RTP crashing does not affect the kernel or other RTPs**; kernel services are entered through system calls
- The artifact `.vxe` is a **standard ELF executable**; a dynamically linked `.vxe` resolves `.so` at runtime by **NEEDED / SONAME / RPATH**
- It can be loaded from ROMFS / NFS / an SD card, or through the debugger; it can also be started with environment variables, for example `LD_LIBRARY_PATH=/romfs/lib` with `rtp exec ... demo.vxe &`
- The load-failure path matches ordinary ELF: **library not found** (`Shared object not found`; check `LD_LIBRARY_PATH` and filesystem mounts) → **name / version mismatch** (compare NEEDED / SONAME / RPATH with `readelf -d`) → a broken second-level dependency → or it was built static to begin with
- `shl` / `shl info` shows which shared libraries are actually loaded
- Debug hint: **do not stop the debugger before the dynamic linker has finished registering symbols** (an early stop shows the false picture "symbols are not registered")

## 3. Global symbol environment: a standalone ELF "looking incomplete" is normal

This is the minimum set a DKM **must be recovered as a whole**:

```
VxWorks image (the target running image)
 + VSB / VIP configuration
 + global symbol table
 + the DKM itself
 → then do relocation / symbol resolution
```

- **Looking at one DKM alone**: a large number of unresolved symbols is the expected result, not malformed
- The converse also holds: **which call targets you can "resolve" during analysis depends on which symbol environment you treat as truth** — the wrong image's symbol table shifts every function name
- So the RE spine should be written as: **locate the target image and configuration first, then talk about logic inside the module**

## 4. "The same VxWorks version" is not "the same system ABI environment"

- The SDK itself is **generated for a specific VSB/VIP**; a DKM is also compiled against a specific VIP, so that it matches that kernel image's API/ABI
- So when "this DKM does not work on another **same-version** VxWorks": **check the concrete image configuration first**, not only the version string
- Likewise, **do not load an RTP `.so` as a DKM module** (or the reverse) — the two artifact classes use two load and resolution mechanisms, and mixing them is a common mistake

## 5. Continuing into task / TCB analysis

DKM-side tasks and kernel objects still follow the task-table method in the [[re-rtos]] main document (`taskSpawn` / `taskCreate` + `WIND_TCB` field offsets recovered from the context-switch site). What this branch adds is **"can this code load, where do its symbols come from, and which side does it run on"** — **settle identity and the symbol environment first, then talk about task structure**; reversing that order produces conclusions whose offsets are right and whose semantics are entirely wrong.

## Decision tree

```
Given a VxWorks target
├─ Classify first: .out (DKM) / .vxe (RTP) / the whole image
│    ├─ .out → kernel mode: symbols come from the target image's global symbol environment
│    ├─ .vxe → user mode: analyze as ordinary ELF; .so goes through the dynamic linker
│    └─ image → extract the global symbol table and configuration first, as the baseline for other analysis
├─ You see many unresolved symbols
│    ├─ First ask: did I only get the DKM, and not its symbol environment?
│    └─ Then ask: did the target VIP simply not include that component (the real cause of undefined symbol)
├─ The module will not load
│    ├─ DKM → check whether the VIP includes the component; check whether the ABI matches the target image
│    └─ RTP → check library path / NEEDED / SONAME / RPATH / second-level dependencies / whether it is a static build
├─ Same version, different behavior
│    └─ Check the image configuration (VSB/VIP), not the version string
└─ After identity and the symbol environment are confirmed → then enter task-table / TCB analysis ([[re-rtos]] main-document method)
```

## Tools and verification

- On-target enumeration: `lkup` (symbols), `moduleShow` (modules), `taskShow` (tasks), `shl` / `shl info` (loaded shared libraries)
- Loading: `ld < module.out` (DKM), `rtp exec ... demo.vxe` (RTP)
- ELF side: `readelf -d` (compare NEEDED / SONAME / RPATH), ordinary symbol and relocation tools
- Configuration side: VSB / VIP configuration and the image build products (they decide the symbol environment and the component set)
- Verification: you can state together "model (DKM/RTP) + target image and configuration + the basis of symbol resolution + the load path"

## Pitfalls on this platform (summary)

- **Parsing a DKM `.out` directly as a Linux `.ko`**: execution model, symbol model, and load mechanism all differ
- **Looking at a single DKM and concluding "the file is incomplete / stripped"**: it is linked against the target image's symbol environment; in isolation it necessarily has a pile of unresolved symbols
- **Editing the DKM when you see `undefined symbol`**: the real cause is usually that the VIP did not include that component; what you change is the image configuration, then you rebuild
- **Using the wrong image's symbol table**: every function name shifts, which is more dangerous than "no symbols"
- **Using the version number as proof of ABI compatibility**: both the SDK and the DKM are generated for a specific VSB/VIP; check the configuration
- **Loading an RTP `.so` as a DKM module** (or the reverse): the two load / resolution mechanisms must not be mixed
- **Drawing a conclusion before the dynamic linker finishes registering symbols**: an early stop shows the false picture "symbols are not registered"
- **Jumping into task / TCB analysis before identity and the symbol environment**: you get conclusions whose offsets are right and whose semantics are entirely wrong
