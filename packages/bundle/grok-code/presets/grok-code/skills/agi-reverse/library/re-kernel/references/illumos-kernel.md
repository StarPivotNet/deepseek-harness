# illumos / Solaris: DDI/DKI driver skeleton / dev_ops / cb_ops

<CORE RULE>
The illumos driver skeleton is **very fixed**, which makes it easy to recover — **the point is not to treat it as load/unload + file_operations**:

```
_init / _fini / _info
  → modlinkage
  → modldrv
  → dev_ops        (device-level ops: getinfo / probe / attach / detach / power / quiesce …)
  → cb_ops         (character / block ops: open / close / read / write / ioctl / mmap/devmap …)
```

The second point is that **placeholders have meaning**:

| Placeholder | Meaning |
|---|---|
| **`nulldev`** | a legal no-op (this entry has nothing to do) |
| **`nodev`** | **the operation is not supported, and it returns `ENXIO`** |

**Collapsing both to "unused" gets "what this driver supports" wrong.**
</CORE RULE>

## 1. The three module entry points

| Entry | Job |
|---|---|
| **`_init`** | one-time, module-level init (for example soft-state init, the driver's global mutex); then call **`mod_install(&modlinkage)`**; if install fails, **roll back the init already done and return the matching error** |
| **`_fini`** | call **`mod_remove(&modlinkage)`**; **only on success** release resources allocated in `_init` |
| **`_info`** | return module information, usually by handing `modlinkage` to `mod_info()` |

Two easy-to-miss constraints:

- **Per-instance init belongs in `attach()`, not in `_init()`** — looking in `_init` for "init of some device instance" comes up empty
- **After `_init` calls `mod_install()`, do not modify data structures hung off `modlinkage`** (the system may copy or change them)
- **`_fini` may be called while hardware instances are still attached**: then `mod_remove()` fails, and **the driver must not release resources** — "the unload function always frees" does not hold

## 2. modlinkage / modldrv: the bridge from the entry to dev_ops

- **`modldrv`** holds: the module type (`&mod_driverops`), a description string, and **a pointer to this driver's `dev_ops`**
- **`modlinkage`** holds: `MODREV_1` and a pointer to `modldrv` (NULL-terminated after that)
- That `modlinkage` is exactly what is passed to `mod_install()` / `mod_remove()` / `mod_info()`

**RE meaning**: `_init`'s first argument / locals point at `modlinkage` — **follow that static reference chain and you get both `dev_ops` and `cb_ops` in one walk**, which is much faster than searching backward from `open`.

## 3. dev_ops: device-level operations (every field is set at compile time)

| Field | Notes |
|---|---|
| `devo_rev` | driver build revision, set to `DEVO_REV` |
| `devo_refcnt` | reference count, set to `0` |
| `devo_getinfo` | get driver / device information |
| `devo_identify` | **obsolete**; by convention set to `nulldev` |
| `devo_probe` | probe the device (set `nulldev` when a self-identifying device needs no probe) |
| `devo_attach` | attach / resume: `int (*)(dev_info_t *dip, ddi_attach_cmd_t cmd)` |
| `devo_detach` | detach / suspend: `int (*)(dev_info_t *dip, ddi_detach_cmd_t cmd)` |
| `devo_reset` | not supported in this version; **set `nodev`** |
| `devo_cb_ops` | a leaf driver points at `cb_ops` |
| `devo_bus_ops` | used by a nexus (bus) driver; `NULL` for a leaf driver |
| `devo_power` | power management |
| `devo_quiesce` | quiesce the device; may be set to a "no quiesce needed" implementation |

Plus placeholders such as `devo_getinfo` / `devo_identify`: **the choice of `nulldev` vs `nodev` is itself the encoding of "what this driver supports"**.

## 4. `attach` / `detach` command values: not just "first attach"

The meaning of `attach(9E)` is **"attach the device, or resume the device"**, distinguished by `cmd`:

- **`DDI_ATTACH`** (required): initialize one device instance; **called once per instance**; ordinary kernel services are available; **before attach succeeds, very few driver entries can be called** (there is also `getinfo`)
- **`DDI_RESUME`** (optional; needed only if suspend / resume is supported): called after `detach(9E)` returns success with **`DDI_SUSPEND`**; it must **restore hardware state** (power may have been removed), continue suspended requests, and service new requests; **do not assume the hardware's current state**
- Version difference: older Solaris material also has **`DDI_PM_RESUME`** (paired with `DDI_PM_SUSPEND`), which belongs to the **obsolete PM interface** (`pm(9P)` already says the original PM interface is obsolete) — **seeing it means the code is from an earlier era**; do not treat it as a "vendor-private extension"
- There is also a `pm-hardware-state` property (`needs-suspend-resume` / `no-suspend-resume` / `parental-suspend-resume`) that **affects whether `detach(DDI_SUSPEND)` and `attach(DDI_RESUME)` are called** — "it suspended but never reached resume" can be decided by configuration
- Return values: **`DDI_SUCCESS` / `DDI_FAILURE`**; a reserved value must return failure

So a switch like this **is not a strange idiom**:

```c
switch (cmd) {
case DDI_ATTACH: ...
case DDI_RESUME: ...
}
```

**Calling the resume branch a vendor extension is the typical misread in this domain.**

## 5. cb_ops: character / block operations; placeholder meaning matters the same way

A leaf driver points `devo_cb_ops` at `cb_ops`, which contains open / close / read / write / ioctl / devmap / mmap / segmap / chpoll / prop_op / … plus `cb_flag` (for example `D_MP`) and a version field.

Typical fill-in (usable directly as the test of "what this driver actually supports"):

```
nodev  → the operation is explicitly unsupported (returns ENXIO)
nulldev → a legal placeholder that has nothing to do
nochpoll / ddi_prop_op and similar → dedicated default implementations
NULL   → for example cb_stream is NULL when STREAMS is not used
```

## Decision tree

```
Got an illumos / Solaris driver
├─ walk the skeleton first: _init → modlinkage → modldrv → dev_ops → cb_ops
│    ├─ the argument to mod_install inside _init is modlinkage (one static reference chain gets everything)
│    └─ per-instance init is in attach(), not in _init()
├─ read "what is supported" field by field from dev_ops
│    ├─ nulldev = legal no-op
│    ├─ nodev  = unsupported (ENXIO)
│    ├─ devo_reset = nodev (not supported in this version)
│    └─ devo_identify = nulldev (obsolete)
├─ the switch inside attach
│    ├─ DDI_ATTACH is required; DDI_RESUME pairs with detach's DDI_SUSPEND
│    ├─ seeing DDI_PM_RESUME → obsolete PM interface, not a private extension
│    └─ never reaching resume can also be decided by the pm-hardware-state property
├─ read character / block capability field by field from cb_ops (note nodev / nulldev / NULL)
└─ unload path
     ├─ _fini calls mod_remove; on failure it must not free resources (instances may still be attached)
     └─ after mod_install, _init must not modify structures on modlinkage
```

## Tools and verification

- Entry and registration: the `_init` / `_fini` / `_info` trio and the static reference chain `modlinkage` → `modldrv` → `dev_ops`
- Capability inventory: read `dev_ops` and `cb_ops` field by field, and **record `nulldev` / `nodev` / dedicated default / `NULL` separately** (that is the raw encoding of "what is supported")
- Attach path: the `cmd` branch set of `attach` / `detach` (`DDI_ATTACH` / `DDI_RESUME` / `DDI_SUSPEND`, and historical `DDI_PM_*`)
- Verification: be able to state together "the skeleton chain (who points at whom) + the meaning of each placeholder + the command set attach / detach supports"

## Pitfalls on this platform

- **Treating an illumos driver as "load/unload + file_operations"**: the skeleton is `_init/_fini/_info` → `modlinkage` → `modldrv` → `dev_ops` → `cb_ops`
- **Recovering both `nulldev` and `nodev` as unused**: the former is a legal no-op; the latter means unsupported and returns `ENXIO` — mixing them misreads driver capability
- **Reading `attach()` as "called only on the first attach"**: it also carries **resume** semantics (`DDI_RESUME`); the command value decides the behavior
- **Treating a `DDI_RESUME` branch / `DDI_PM_RESUME` as a vendor-private extension**: the former is a standard command value; the latter is an obsolete PM interface (an era clue)
- **Looking in `_init` for device-instance init**: instance init belongs in `attach()`
- **Assuming `_fini` always frees resources**: when `mod_remove()` fails (instances still attached) it must not free
- **Still modifying structures on `modlinkage` after `mod_install()`**: that violates the contract, and the system may already have copied or changed that data
- **Ignoring a property such as `pm-hardware-state`**: it decides whether the suspend / resume path is called; "it never got there" is not necessarily a defect
