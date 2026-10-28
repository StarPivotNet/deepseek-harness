# Genode: component tree / session / quota donation / local names

<CORE RULE>
Genode's core is not some fixed microkernel API. It is:

```
component tree + parent-mediated services + session + capability + quota
```

Two rules that mislead easily:

① **A service name is valid only inside the local parent level** — two programs both requesting `"Foo"` **does not mean they connect to the same server**;
② **A capability integer is local to the protection domain** — the same integer is not the same object, and different integers can still be the same object.

**This is the same class of pitfall as a seL4 CPtr and a Zircon handle** ([[sel4-kernel]], [[zircon-kernel]]).
</CORE RULE>

## 1. The recursive component tree

- Every program runs in **its own sandbox**, and can use its own resources to **create and manage child sandboxes** — a strict hierarchy, with policy applied at every level
- From the **parent-child interface**, only two things are constrained by parent policy: **a child announces a service**, and **a child requests a service**
- Parent-interface operations:
  - **session**: the child asks to connect to a service (known to the parent); the arguments include **resources it is willing to donate to the server for the session's lifetime**
  - **close**: the child says it no longer needs the session; the parent should close it and **return the donated resources**
  - **announce**: the child registers a locally implemented service with the parent (and thus becomes a server)
  - **transfer_quota**: the child enlarges its resource donation to the server that provides the session

## 2. Routing and "name remapping"

- After a child announces a service, the parent stores the server's root capability under a **local name** (in its own root_list); **the root capability is for the parent to use and keep**
- The parent calls the server child's root interface to create a session; the server returns a session capability, which the parent records under a local name (session_list)
- This process is **recursive**: **service names need not match; meaning extends only to the immediate parent, and every level may remap**
- A parent has four ways to handle a request: **refuse**, **delegate to its own parent**, **implement locally**, **open a session on one of its other children**
- init describes routing with an XML `<route>` table (under `<service name=...>` an optional `<parent/>` or `<child name=.../>`), and supports wildcards (`<any-service>`, `<any-child>`) and `<default-route>`
- Routing can be based on the **session label**: the label is prefixed level by level along the route (**the part closest to the server is the most trusted; the part that came from the client is the least trusted**); match attributes include `label`, `label_prefix`, `label_suffix`, `unscoped_label`, `label_last`
- **A label can be rewritten** — a rewrite in the target node can **hide the client's identity from the server**

**So recovering "who connects to whom" must use the route table and the label chain, not the service name.**

## 3. Quota donation: every level on the path "takes a bite"

- Session-construction arguments carry the resources the client donates
- **The parent deducts local accounting overhead from the session quota the child donated** — so "**every component on the session-request path takes a small bite out of the quota**"
- Result: **the quota that reaches the server may already have been consumed**, and the server may return `QUOTA_EXCEEDED`; the client side then **retries with a gradually larger quota**
- Capability budget works the same way: every `<start>` node has a `caps` attribute (creating a component takes about 35 caps; 100 is a common practical value), and the cap budget can also move between client and server
- It can be adjusted at runtime: a child can request more resources, and can be asked to yield resources

**So**:

```
the whole system still has 100 MB free
some child has only 8 KB of quota left, and creating a session fails
```

**is not a contradiction.** Check in this order: global physical memory → the current PD's quota → the quota donated to this session → the capability budget.

## 4. ROM session: configuration can update; "the ROM contents changed" is not tampering

- Every component started by init gets its configuration by **requesting a ROM module named `"config"`** from the parent; init intercepts that request and delivers only **the part that belongs to this child**; the mechanism holds recursively
- **A ROM session supports dynamic update during its lifetime** (there is a dedicated update / notification protocol between client and server), so a long-running component's configuration can change dynamically
- Nested configuration lets one component tree be described by a single configuration

**So**: a ROM dataspace changing from version A to version B is a **legal mechanism**, not "read-only memory was overwritten".

## 5. Health and lifecycle signals

- A component registers signal handlers with the parent (resource available, yield, session, heartbeat, and so on)
- **heartbeat**: during init the component registers a heartbeat handler with the parent; after the parent raises the signal, the default handler answers the heartbeat — init uses this to monitor child health
- init supports state reports and exit propagation (a child's exit event can be forwarded to init's own parent)

## Decision tree

```
Got a Genode target
├─ who connects to whom
│    ├─ look at the parent's route table (<route>) and the label chain, not the service name
│    ├─ the same service name under two parent levels can point at different servers
│    └─ the label may have been rewritten (identity hidden from the server)
├─ capability-related
│    ├─ the integer is valid only inside the current PD; the same integer may be unrelated, different integers may be the same object
│    └─ align by session / object, not by integer
├─ a resource request failed
│    ├─ check in order: global physical memory → current PD quota → session donation → cap budget
│    └─ every level on the path deducts local overhead
├─ ROM contents changed
│    └─ a ROM session supports an update protocol; "the contents changed" is a legal mechanism
└─ a component disappeared / restarted
     └─ check heartbeat monitoring and the exit-propagation chain
```

## Tools and verification

- Topology: init's XML configuration (`<route>` table, `<start>` nodes, `<report>`, `<exit>`) and the label match / rewrite rules
- Resources: each node's quota and caps configuration; the donation in the session-construction arguments; runtime resource request / yield
- Communication: announce (who is the server) and session (who connects to whom), plus the forwarding levels in between
- Verification: be able to state together "the real owner of the service (which level provides it) + which PD's namespace the capability is in + which level's quota the resource came from"

## Pitfalls on this platform

- **Using the service name to decide "connected to the same server"**: a name is meaningful only at the local parent level, and every level can remap
- **Treating a capability integer as a global id**: it is a PD-local name; the same integer may be unrelated, and different integers may share an origin
- **Ignoring label rewrite**: the client's identity may be hidden on purpose
- **Treating a root capability as something that can be passed freely**: it is only for the parent to use and keep
- **Using "the system still has memory" to deny an OOM**: quota is hierarchical, and every level on the path has already deducted overhead
- **Ignoring the capability budget**: caps are a limited resource, just like RAM
- **Treating a ROM content change as memory tampering**: a ROM session itself supports update
- **Ignoring heartbeat / exit propagation**: a component disappearing / restarting has a defined monitor and notification path
