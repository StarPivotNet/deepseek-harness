# Plan 9 / 9front: per-process namespace / /srv / 9P

<CORE RULE>
**A pathname is not a global identifier in Plan 9.**

Each process (or namespace group) can have its own file namespace:

```
Process A: open("/foo")  → may be some file server's tree
Process B: open("/foo")  → may be a completely different object
```

**You cannot infer "this is the same object" from the path alone** — recover each namespace and its bind history first.
</CORE RULE>

## 1. bind / mount: what changes is the view of "this process and its namespace group"

- `bind` and `mount` modify the file namespace of **the current process and other processes in the same namespace group**
- After `bind`, `old` becomes an **alias** of the object named by `new`; **`new` is evaluated at bind time** (not at use time)
- `mount`'s `servename` is a file that "**when opened, returns an existing connection to some file server**" — **almost always a file under `/srv`**; the `spec` argument is passed to the server in the attach message, and selects among the trees the server offers
- The bind type of a directory and a file must match (both directories, or neither)

## 2. A union directory is a **single-level** overlay, not a real directory-tree merge

The options decide how the overlay is built:

| Option | Effect |
|---|---|
| (none) | **replace** `old` with `new`; for a directory, `old` becomes "a union containing only one directory" |
| **`-b`** | add the new directory at the **front** of the union |
| **`-a`** | add the new directory at the **end** of the union |
| **`-c`** | allow creation in the union directory — a new file lands in **the first element bound with `-c`** |
| `-C` (mount) | allow the kernel to use a local cache, and check freshness on every open |
| `-q` | exit silently on failure |

**The important limit**: a Plan 9 union **is not a full directory-tree union** — lookup checks bind targets in order and **returns the first match**, and only one level is overlaid. For example, when `b` is bound in front of `a`, a name that does not exist in `b` does **not** fall through into `a`'s deeper tree — a deeper entry "covered" by an upper directory stays invisible.

**So**:

```
the result of readdir("/bin")
  → cannot be attributed simply to one filesystem
```

## 3. `/srv` is not a socket directory; it is a service registry

- `/srv` is the **service-registry device**, the **meeting point** for mountable services; after boot, `/srv/boot` holds "the communication port to the filesystem the system was loaded from"
- Typical flow (lib9p): create a pipe → **publish the fd under a name in `/srv/<name>`** → fork a child that runs the service loop → mount it at a mount point when needed

**So**:

```
a new filesystem appears
  → there does not need to be a matching filesystem module in the kernel
  → it may just be a user-mode server published to /srv and then mounted
```

## 4. 9P: a fid is a client-side handle inside a session

- Request-response model: the client sends a **T-message**, the server returns an **R-message**, each with a type and a tag
- Standard operations: `Tversion/Rversion`, `Tattach/Rattach`, **`Twalk/Rwalk`**, `Topen/Ropen`, `Tread/Rread`, `Twrite/Rwrite`, `Tclunk/Rclunk`, `Tstat/Rstat`, `Twstat/Rwstat`
- **`fid` / `newfid` are the client-side handle namespace of the current 9P session**: `Twalk` walks a path from an existing fid and binds the result to `newfid`
- In the library layer (lib9p), a request object corresponds one-to-one with a fid and with "unfinished requests" / "live fids"; **the service loop rejects reuse of an existing fid, or opening a fid that is already open**
- If the service is implemented as a "file tree", walk is handled inside the library and does not call back into the driver's walk

**So**:

```
fid 5 on connection A
fid 5 on connection B
  → there is no necessary relationship

even on the same connection, a fid changes across the walk / clunk lifetime
  → it cannot be treated as a persistent identifier the way an inode can
```

Recovering 9P traffic should align: **connection/session + fid + walk history + qid**.

## 5. `open` / `read` / `write` are very often actually a user-mode RPC

The lib9p service loop: read a request from the input fd → dispatch to function pointers (auth / attach / open / create / read / write / remove / flush / stat / wstat / walk / walk1 / clone / destroyfid / destroyreq / start / end) → write the response to the output fd; **the service loop is single-threaded**.

**So**:

```
open("/net/tcp/clone"); write(...); read(...)
  → do not apply "syscall → kernel TCP stack" directly
  → the real path may be: namespace → mounted file server → 9P → user-mode handler
```

This is the fundamental mental model for Plan 9 reversing.

## Decision tree

```
Got a Plan 9 / 9front target
├─ two processes access the same path name
│    ├─ recover each namespace and its bind / mount history first
│    └─ the same path does not mean the same object
├─ directory contents look wrong
│    ├─ check whether it is a union (-b / -a order, -c create location)
│    └─ a union is only a single-level overlay: a name missing from the upper directory does not fall into the lower deep tree
├─ a "new filesystem" appears
│    ├─ check whether a matching service was published under /srv
│    └─ no kernel filesystem module is required
├─ analyzing 9P traffic
│    ├─ align by connection / session, not by comparing bare fid integers
│    └─ combine walk history and qid
└─ file-operation behavior does not match the expectation
     └─ confirm which server it actually hit (namespace → 9P → user-mode handler)
```

## Tools and verification

- Namespace: bind and mount records of each process / namespace group, and bind options and order
- Service discovery: entries under `/srv` and their publishers; mount points and the `spec` argument
- Protocol: the 9P session (connection, fid, walk history, qid) and message types
- Verification: be able to state together "whose namespace the path was resolved in + which file server it finally hit + which user-mode handlers the data passed through"

## Pitfalls on this platform

- **Treating a pathname as a system-wide unique resource**: the namespace is per process / per group
- **The same path means the same object**: recover each bind history first
- **Treating a union directory as a real tree merge**: it is only a single-level overlay, and lookup returns the first match
- **Ignoring `-b` / `-a` order and the `-c` create location**: the results differ a lot
- **Treating `/srv/foo` as a socket file**: it is a connection in the service registry
- **Assuming a new filesystem must be provided by a kernel module**: a user-mode server can be published and then mounted
- **Treating a 9P fid as an inode / global file id**: it is a client-side handle inside a session
- **Comparing fid integers across connections**: different sessions are not comparable
- **Treating a file operation as syscall → kernel stack**: it usually goes namespace → file server → 9P → user-mode handler
