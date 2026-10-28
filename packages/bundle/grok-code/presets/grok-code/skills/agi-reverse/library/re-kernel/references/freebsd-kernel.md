# FreeBSD kernel: linker sets / SYSINIT / KLD

<CORE RULE>
FreeBSD looks a lot like Linux on the surface — **but one difference breaks the whole "reachability" argument**:

```
SYSINIT() does not generate "_start → call init"
It places a struct sysinit into a linker set
The kernel runs them together, sorted, at boot / module load
```

So:

```
foo_init()   ← no call cross-reference at all
```

**can be completely normal.** What you should recover is

```
func address → struct sysinit → linker set
```

and not mark it dead code. **On FreeBSD, "no caller" is first a clue about a linker set, not a clue about dead code.**
</CORE RULE>

## 1. SYSINIT / SYSUNINIT: numbered registration entries

- `SYSINIT()` creates a `struct sysinit` and puts it in the **startup linker set**; `SYSUNINIT()` puts one in the **shutdown linker set**
- The structure has four fields: **subsystem id (`SI_SUB_*`), order inside the subsystem (`SI_ORDER_*`), function pointer, and the data pointer passed to it**
- At boot the startup linker set is scanned, **a sorted table of init routines is built**, and they run in that order
- Sort key: **`SI_SUB_*` is primary, `SI_ORDER_*` is secondary**, both ascending
- **Two routines with the same sub and the same order have an undefined relative order** — do not infer runtime order from source order
- Entries such as `SI_SUB_DUMMY` are skipped; after an entry runs it is marked (for example `SI_SUB_DONE`)

## 2. The linker-set mechanism itself: recognize it before you talk about "registration"

- A linker set uses the linker to gather **statically declared data from many compilation units into one contiguous, addressable whole**
- The **modern ELF implementation** bounds the set with "magic ld symbols": **`__start_set_<set name>` / `__stop_set_<set name>`**, and the entries live in a section named like **`set_<set name>`**
- The **old implementation (a.out era)** was `struct linker_set { int ls_length; void *ls_items[...]; }`, **and the item list was NULL-terminated**
- **The modern list is not NULL-terminated** — **scanning until a NULL walks off the end**. The range can be computed only from the `__start_set_*` / `__stop_set_*` bounds
- The macro layer provides walk / count helpers (`SET_BEGIN` / `SET_LIMIT` / `SET_FOREACH` / `SET_COUNT`) — **what the decompiler sees is a raw array of data pointers, without those API names**

**General test (worth reusing across systems)**:

```
a long run of contiguous pointers / objects
 + a section name shaped like set_*
 → explain it as a linker set first, not as a jump table / obfuscation table
```

And linker sets are not used only for `SYSINIT` — the FreeBSD kernel has **many** sets of the form `set_...._set`. **A `set_` prefix should make you think linker set first.**

## 3. KLD: there is still a kernel linker at runtime

- **Preloaded modules** (brought in with the kernel by the boot loader): their startup linker set is scanned, sorted, and **merged into the kernel's startup table** when the **`SI_SUB_KLD`** subsystem initializes, then runs during boot
- **That produces a counter-intuitive result**: init routines in a preloaded module that **sort before `SI_SUB_KLD` actually run after `SI_SUB_KLD`** — "it was declared early, why does it run late" has a definite mechanism
- **Modules loaded at runtime** (`kldload`): on load, the startup set is scanned, sorted, and executed
- **Unload**: the shutdown set is scanned, sorted, and executed, **in the reverse of init order**
- **Teardown routines of the kernel and of already-loaded modules do not run at system shutdown** — the inference "shutdown should take that cleanup path" does not hold

## Decision tree

```
Got a FreeBSD kernel / module target
├─ some init / registration function has no call cross-reference
│    ├─ check whether SYSINIT / SYSUNINIT references it (func address → struct sysinit)
│    ├─ check which linker set it lands in (section name set_*)
│    └─ do not mark it dead code
├─ a long run of contiguous pointers / objects, section name set_*
│    └─ explain as a linker set (there may or may not be a count field; modern ELF has no trailing NULL)
├─ ordering questions
│    ├─ sort key is SI_SUB_* primary + SI_ORDER_* secondary
│    ├─ same sub + same order → relative order is undefined; do not infer runtime order from source order
│    └─ preloaded module: entries before SI_SUB_KLD actually run after SI_SUB_KLD
├─ module-related
│    ├─ load: scan-sort-execute the startup set
│    ├─ unload: execute the shutdown set, reverse of init order
│    └─ system shutdown does not run teardown routines of the kernel or loaded modules
└─ common misreads versus Linux → see "Pitfalls" below
```

## Tools and verification

- Locate registrations: walk back from the function address to `struct sysinit`, then from its section to the specific linker set
- Enumerate a set: compute the range and entry count from the `__start_set_*` / `__stop_set_*` bounds (**do not depend on a trailing NULL or a fixed count field**)
- Module lifetime: check the preload path and the `kldload` path separately (the sort timing differs)
- Verification: be able to state together "registration style (linker set / direct call) + owning set and sort key + load path (built-in / preloaded / runtime)"

## Pitfalls on this platform

- **No call cross-reference, so the init never runs**: `SYSINIT()` registers through a linker set; there is no call site at the source level
- **Scanning a linker set until a trailing NULL**: that is the old a.out structure; modern ELF is bounded by symbols, **and a NULL scan walks off the end**
- **Treating a `set_*` pointer array as a jump table / obfuscation table**: it is more likely the kernel's own registration set
- **Inferring init order from source order**: order is decided by `SI_SUB_*` + `SI_ORDER_*`, and the relative order of the same sub and same order is **undefined**
- **Assuming an early declaration in a preloaded module runs early**: those entries are merged into the kernel startup table only at `SI_SUB_KLD`
- **Assuming shutdown runs the kernel / module teardown routines**: it does not
- **Treating unload order as init order**: teardown is the reverse of init
- **Applying Linux `module_init` / `__initcall` directly to FreeBSD**: the registration mechanism and the sort key both differ (see [[linux-kernel]])
