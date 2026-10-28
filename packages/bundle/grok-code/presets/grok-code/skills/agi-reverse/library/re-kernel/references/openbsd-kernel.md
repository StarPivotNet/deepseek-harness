# OpenBSD: KARL relink / autoconf / pledge·unveil

<CORE RULE>
**The same kernel version can have a different internal address layout on every boot.**

OpenBSD **KARL** (kernel address randomized link) **randomly relinks** the kernel from the `.o` files in the link kit before the next reboot, so the kernel's internal layout changes. Therefore:

```
machine A: foo() in /bsd = X
machine B: foo() in /bsd = Y
and it also changes between two boots of the same machine
```

**That is not evidence the kernel was patched, and not evidence the versions differ.**

Second point: devices are not "hung on in the code"; they are **matched / attached recursively at runtime** — `foo_attach()` having no ordinary caller is completely normal.
</CORE RULE>

## 1. KARL is not KASLR

| | KARL | ordinary KASLR |
|---|---|---|
| What changes | **layout inside the binary** (relative positions of objects) | the same binary is loaded at a **random base** |
| Kernel load address | still at the same KVA | different every time |

Mechanism points:

- The kernel is linked as: **startup assembly (locore.o) fixed** at a known place → a **gap of random size** → **the remaining `.o` files randomly reordered**; there is also a random gap before `.rodata` / `.data` / `.bss`
- Because **the distances between functions and variables are new**, leaking one pointer does not locate the others; changed nested offsets also break polymorphism of the instruction stream and can reduce gadgets on variable-length architectures
- At runtime the kernel can **unmap its own startup code**; on architectures where large-page mappings make unmap impossible, that code is **trashed** instead
- The base system ships a **link kit** (every `.o` needed to build the kernel); an rc script **links a new kernel in the background after every boot** for the next boot — every reboot runs a freshly linked kernel, and produces the one after that as a side effect
- Install and upgrade also build a unique kernel; **if a developer copies a kernel to `/` (for example `/bsd`) for debugging, the relink mechanism disconnects until `make install` or an upgrade**

**RE test**:

```
/bsd differs byte for byte
  → ask first: is this a KARL / relinked kernel?
  → then do a symbol / semantic comparison
```

**Do not** treat a byte-for-byte difference as an anomaly by itself.

## 2. autoconf: devices are matched at runtime

- The device tree is produced by **recursive match / attach at runtime**: `config_found()` / `config_attach()` call each driver's **match / attach** from the configuration tables
- `detach` is allowed to **wait for processes using the device to exit** (it does not yank the device immediately)
- Therefore

```
foo_attach()    ← no ordinary call xref
```

**can be completely normal.** The real edge is:

```
autoconf table → match → config_attach → foo_attach
```

## 3. User mode: pledge / unveil make a "normal program" fail suddenly

This section is a **user-mode** mechanism, but it is **very easy to misread as "EDR / a sandbox is intercepting"**, so it lives here.

- **`pledge()` is a one-way ratchet**: later calls **can only reduce** the available subsystems; **a revoked subsystem cannot be regained**; trying to **raise** privileges fails with `EPERM` (there is another case — a child that inherited execpromises and tries to raise them is **ignored and the call returns success**)
- On a promise violation the process is usually **killed with an uncatchable SIGABRT** (leaving a core when possible) — **it is not a catchable error return**
- Note: **`pledge("everything", NULL)` is not the same as "never calling pledge"** — the promise list does not necessarily cover every ioctl
- `unveil()` shrinks the filesystem view to a set of paths; **`unveil` is itself a promise** — removing it (or passing two empty strings) can forbid further calls
- There is also an `error` promise: on violation **the process is not killed**; the call returns `ENOSYS` instead
- Field clues: a running process shows state `p` in `ps`; a process killed for a pledge violation is accounted by `lastcomm` with the `P` flag

**Typical picture**:

```
the program starts fine
  → some time later open("/etc/foo") fails
  → or it dies with SIGABRT
```

**Check whether pledge() / unveil() was called before suspecting an external interceptor** — **"it could access at startup, then suddenly cannot"** is exactly the usual design of this mechanism.

## Decision tree

```
Got an OpenBSD target
├─ compare two /bsd images (or two boots of the same machine)
│    ├─ byte-for-byte different → explain as KARL / relink first; do not call it patched
│    └─ a kernel diff → use symbol / semantic comparison, not a byte comparison
├─ the kernel source in the analysis environment looks suspicious
│    └─ a kernel copied by hand to / disconnects relink (until make install / upgrade) — it differs from production
├─ some attach function has no caller
│    └─ autoconf: config table → match → config_attach → foo_attach
├─ a user-mode program's behavior "changes halfway"
│    ├─ check pledge(): one-way ratchet, cannot be restored, violation is uncatchable SIGABRT
│    ├─ check unveil(): the filesystem view was shrunk
│    └─ do not attribute it to EDR / a sandbox first
└─ a process dies for no ordinary reason
     └─ ps state p / lastcomm's P flag is the clue
```

## Tools and verification

- Kernel: the link kit and the relink script on the rc side (how this kernel was produced); diff at the symbol / semantic level (not bytes)
- Devices: autoconf configuration tables and the match / attach relationship; the wait semantics of `detach`
- User mode: pledge / unveil call sites and promise strings; `ps` state and `lastcomm` accounting
- Verification: be able to state together "how the kernel was produced (relink vs hand install) + how the device was attached (autoconf) + how privileges were cut (pledge / unveil timing)"

## Pitfalls on this platform

- **Taking a byte difference as "the kernel was tampered with / the versions differ"**: KARL makes the same version's layout differ on every boot
- **Treating KARL as KASLR**: the former changes internal layout; the latter changes the load base
- **Assuming the kernel load address is random**: under KARL the kernel stays at the same KVA
- **No caller for attach, so it is dead code**: autoconf matches and attaches from the configuration tables at runtime
- **Assuming detach removes the device immediately**: it may wait for users to exit
- **Treating a pledge violation as an external intercept**: it is an uncatchable SIGABRT, and a revoked capability cannot be restored
- **Assuming "never calling pledge" equals `pledge("everything")`**: the latter can still fail to cover some operations
- **Ignoring that the filesystem view was already shrunk after unveil**: "the path exists but cannot be opened" can be by design
- **Inferring production behavior from a hand-installed kernel in the analysis environment**: copying a kernel by hand disconnects relink
