# Frida script methodology pitfalls and boundaries

## Version-difference group (easiest to hit)

- **Frida 17 removed the static Module lookup API**: `Module.getExportByName()` / `Module.findExportByName()` / `Module.enumerateExports()` and similar are no longer functions as of Frida 17 — the script throws `TypeError: not a function`; migration: global symbols use `Module.getGlobalExportByName("open")` / `Module.findGlobalExportByName("open")`; a specific module uses `Process.getModuleByName("libc.so").getExportByName("open")`; before writing, `frida --version` to confirm the version, then pick the spelling
- **frida / frida-tools / frida-server versions must match**: a device-side frida-server whose major version disagrees with host-side frida fails to connect or behaves oddly; after upgrading either, verify with `frida-ps -U` first
- **gadget vs server mode differs**: a no-root scene uses frida-gadget (integrated into the app); hook timing is earlier than server mode (early in app startup); the same script may behave differently in the two modes; verify separately by run mode
- **Behavior follows the current version**: `Interceptor` callback details, when to use `Java.perform`, and `Java.choose` semantics changed between 16 and 17 — on an exception, check that version's official docs first; do not copy an old tutorial

## Java-layer pitfall group

- **overload mismatch fails silently**: the parameter count/types of `.implementation` must match the target overload, or the hook attaches but does not fire — enumerate `overloads` first, then write
- **Multiple hooks on the same class overwrite the cache**: assigning `.implementation` several times on the same class keeps only the last one — merge the branches into one hook
- **Class not loaded**: when the target class is lazy-loaded / delayed by packing, `Java.use` at script start throws ClassNotFoundException — use `Java.choose` (already-instantiated objects) or delay until after the class loads; in a packed scene, unpack first ([[re-mobile-pack]])
- **Obfuscated class names drift**: a ProGuard/R8-obfuscated release package has different class/method names from the debug package — trust the target package's actual strings (jadx output); do not copy experience values from another version
- **Callback thread**: calling a Java method directly from a non-Java thread may throw — schedule main-thread work with `Java.scheduleOnMainThread`

## Native-layer pitfall group

- **Export symbol not found**: when the target function is not exported (`static`/stripped), `getExportByName` returns null — switch to a call-site hook (enter from the Java-layer JNI call) or locate it with a `Memory.scan` memory signature
- **Same name across ABIs / sos**: the same function name exists in several sos (multi-ABI or versioned libraries) — before hooking, confirm the target module instance and anchor by module name
- **String encoding**: a native return is often UTF-8 (the Java side is UTF-16) — pick the decode by call-site semantics; do not parse everything as one encoding
- **Argument registers follow the platform**: on ARM64 the first 8 arguments are in x0-x7; on x86_64 they are rdi/rsi/rdx/rcx/r8/r9 — in onEnter, read `this.context` for the target architecture; verify against the target, do not copy

## Counterexample and boundary group

- **No output ≠ not hooked**: the target path was not triggered (needs an action / a timer / a specific input), a permission dialog blocked it, or the process already crashed — confirm the trigger condition before calling it "hook failed"
- **A successful bypass ≠ the target has no protection**: a bypass is valid only for this run; it may fail after restart/update — annotate the version range and run mode on the conclusion
- **Observe only, do not persist**: a bypass script that writes leaves test traces — scripts are read-only/logging; evaluate writes separately (red line)
- **Counterexample of hooking a whole class**: hooking a high-frequency method across the whole class slows or crashes the app — minimize the hook surface; verify a small range first, then expand
- **A template is a start, not the end**: rewrite [[re-frida/frida-scripts]] templates for the target version; dropping in an old template may fail because of API differences

## Usage notes

- Dynamic execution is inside a sandbox ([[re-analyze/platform-tips]] highest principle); archive scripts and output per the [[re-analyze/analysis-contract]] contract
- Grade conclusions per [[decision-tree]] evidence grades (A/B/C/counter-evidence); state bypass-class and data-class conclusions separately
