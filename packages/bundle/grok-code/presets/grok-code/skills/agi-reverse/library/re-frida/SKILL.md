---
name: re-frida
description: >
  Frida dynamic instrumentation (desktop + mobile, unified).
  Triggers: frida, hook, `插桩`, `绕过`, spawn
capabilities: [frida-instrumentation]
---

# Frida dynamic instrumentation

## When to use / when not to use

- Use: you need to hook a function (intercept / change arguments / change the return), enumerate modules and classes, bypass certificate checks / root detection, or observe a runtime call chain
- Use: a unified instrumentation need on mobile (Android / iOS) and desktop (Linux / macOS / Windows)
- Do not use: static analysis is enough (Android goes to [[re-apk]]; formats go to the [[re-format-elf]] / [[re-format-macho]] series)
- Do not use: you need syscall-level tracing (go to [[re-tracing]])
- Do not use: you need a full debugger experience (breakpoints / single-step / memory; go to [[re-gdb]] / [[re-lldb]] / [[re-x64dbg]])

## Tool setup

Dynamic analysis follows the [[re-analyze/platform-tips]] highest principle: mobile runs inside a controlled device / emulator snapshot; confirm the sandbox environment before desktop instrumentation. Verify every tool before use.

### frida-tools — host-side command-line tools

- Cross-platform (Linux / macOS / Windows): `pip install frida-tools` (Python 3.8+; a venv is recommended: `python3 -m venv venv && venv/bin/pip install frida-tools`)
- Verify: `frida --version` (prints the frida version); `frida-ps -U` / `frida-trace -h` work

### frida-server — mobile instrumentation agent

- Download: GitHub release `https://github.com/frida/frida/releases`; pick `frida-server-<version>-android-<arch>` (arm64 picks `-arm64`, 32-bit picks `-arm`, an x86_64 emulator picks `-x86_64`)
- **The client and frida-server must at least share the same major** (compare `frida --version`); to avoid feature/API differences, the same latest version is recommended. The architecture must match the device, or the connection reports a protocol error (see pitfall 1)
- Android push and start:
   ```sh
   adb push frida-server-xxx /data/local/tmp/frida-server
   adb shell "chmod 755 /data/local/tmp/frida-server"
   adb shell "su -c /data/local/tmp/frida-server" &   # 或 adb root 后直接运行
   ```
- iOS jailbroken device: add the source `https://build.frida.re` in Sileo / Cydia and install the frida deb, or install after `ssh root@<device IP>`
- Verify: host `frida-ps -U` can list device processes (`-U` = USB device, `-R` = remote ip:port)

### objection — quick instrumentation without writing JS

- Requires Python >=3.10 (different from frida's own binding lower bound of `>=3.7`; it must be satisfied separately): `python -m pip install -U objection`; a separate 3.10+ venv or pipx isolation is recommended
- Verify: `objection --version`
- Use: `objection -n <app or Bundle ID> start`; built-in `android hooking` / `ios hooking` subcommands (such as `android hooking list activities`, `ios sslpinning disable`)
- Since 1.12.x, `-g` / `explore` are deprecated (hidden in the CLI, only a deprecation warning; the old spelling still runs); new writing uses `-n` + `start`

## Procedure

Run in order. Record each step.

1. **Choose spawn vs attach**:
    ```sh
    frida -U -f com.target.app              # spawn：从零启动应用，能抓启动早期逻辑（解密 / 初始化）
    frida -U com.target.app                 # attach：附加到已运行进程（不重启）
    frida-trace -U -f com.target.app -i "Java!*"   # 启动即跟踪 Java 方法调用
    ```
   Rule: use spawn to catch startup logic / bypass an early check; use attach only to observe the current state. attach is later than startup and may miss early logic that has already finished (see pitfall 2).

2. **Write a JS hook (intercept / change arguments / return)**:
    ```js
    // hook.js —— 拦截、改参数、改返回值（Android Java 层）
    Java.perform(function () {
      var cls = Java.use("com.example.Target");
      cls.doLogin.implementation = function (user, pass) {
        console.log("doLogin(" + user + ", " + pass + ")");
        return this.doLogin("hacked", "pass123");   // 改参
      };
      cls.isLicensed.implementation = function () {
        return true;                                // 改返回值
      };
    });
    ```
    ```sh
    frida -U -f com.target.app -l hook.js
    ```
   A native function is intercepted with `Interceptor.attach(Process.getModuleByName("libfoo.so").findExportByName("func"), { onEnter: ..., onLeave: ... })` (onEnter changes arguments; onLeave uses `retval.replace()` to change the return). The desktop equivalent: `frida -p <pid> -l hook.js`.

3. **Enumerate and call (enumerateModules / Java.perform)**:
    ```js
    Java.perform(function () {
      Java.enumerateLoadedClasses({
        onMatch: function (c) { if (c.indexOf("target") >= 0) console.log(c); },
        onComplete: function () {}
      });
    });
    ```
    ```js
    // 模块与导出枚举（原生层）
    Process.enumerateModules().forEach(function (m) { console.log(m.name + " " + m.base); });
    Process.getModuleByName("libfoo.so").enumerateExports().forEach(function (e) { console.log(e.name); });
    ```
   Run: `frida -U -f com.target.app -l enum.js`. After locating the target, call it proactively: `Java.use("com.x").method(...)` / a native export.

4. **Bypass a certificate check / detection (common templates)**:
    ```js
    // Android SSL 绕过模板（配合抓包工具）
    Java.perform(function () {
      var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
      var TrustAll = Java.registerClass({
        name: "com.bypass.TrustAll",
        implements: [X509TrustManager],
        methods: { checkClientTrusted: function () {}, checkServerTrusted: function () {},
                   getAcceptedIssuers: function () { return []; } }
      });
      var SSLContext = Java.use("javax.net.ssl.SSLContext");
      SSLContext.init.implementation = function (km, tm, sr) {
        this.init(km, [TrustAll.$new()], sr);
      };
    });
    ```
    ```js
    // iOS 证书绕过：hook SecTrustEvaluateWithError 返回值
    var SecTrust = Module.findGlobalExportByName("SecTrustEvaluateWithError");   // Frida 17+：全局符号静态查找
    Interceptor.attach(SecTrust, { onLeave: function (r) { this.context.x0 = 0; } }); // arm64 返回寄存器 x0；x86_64 用 rdi 场景先验证
    ```
   A ready command: `objection -n com.target.app start` → `android sslpinning disable` / `ios sslpinning disable`.

5. **Anti-detection countermeasures (hide frida-server, rename)**:
   - Common detection points: frida-server's default port 27042, the `/data/local/tmp/frida-server` path, the `gum-js-loop` / `gmain` thread names, frida signatures in `/proc/self/maps`, the `frida` string
   - Fixes:
      ```sh
      # 1) 二进制改名后启动（避开路径检测）
      cp frida-server-xxx /data/local/tmp/fridad
      adb shell "su -c 'chmod 755 /data/local/tmp/fridad && /data/local/tmp/fridad' &"
      # 2) 换端口 + adb 端口转发，主机用 -H 连接
      adb shell "su -c '/data/local/tmp/fridad -l 0.0.0.0:27142' &"
      adb forward tcp:27142 tcp:27142
      frida -H 127.0.0.1:27142 -f com.target.app
      ```
   - Root-detection countermeasure: hook the detection function and change its return before instrumenting the target: `Java.use("com.target.rootcheck").isRooted.implementation = function () { return false; };`
   - Still detected → inject frida-gadget into the app process (gadget listen (interactive) mode), and load libgadget.so with an smali patch from [[re-apk]]

7. **Script templates and countermeasure methodology**: common script skeletons are in [[frida-scripts]] (TLS keylog / DEX/SO dump / JNI registration recovery / crypto intercept / detection-bypass table); the crash-iteration method and the detection-surface comparison table are in [[re-analyze/anti-dynamic-workflow]] — run a baseline and watch the bare crash first, then hook the specific point; do not preinstall a whole bypass kit.

## Cross-domain joins
- [[re-address-space]]: runtime base conversion (align `Process.getModuleByName(...).base` with the link address)

- [[re-mobile]]: workflow step 3 always calls this skill for dynamic instrumentation
- [[re-apk]] / [[re-ios]]: call this skill when runtime behavior is needed after static analysis (decrypt / hook / bypass / unpack execution)
- Syscall-level tracing complements → [[re-tracing]]; runtime memory extraction → [[re-memdump]]
- This skill is called by the [[re-analyze]] triage "mobile app analysis" path (re-mobile → re-frida)
- Script generation: target features → template choice → rewrite and verify → [[re-frida-script-author]] (template material [[frida-scripts]])

## Common pitfalls

- **Version mismatch → protocol error**: Symptom — `frida-ps -U` reports `unable to communicate with the frida server` / a protocol error; cause — the client and frida-server majors disagree, or the feature used does not exist on the target version; fix — first check whether the majors match (`frida --version` compared with the frida-server version; see Tool setup), then confirm whether that feature is supported by the corresponding version; on the upgrade side, `pip install -U frida-tools`
- **Frida 17 removed the static Module lookup/enumeration API**: Symptom — the script reports `TypeError: Module.findExportByName is not a function` (or the same class for getExportByName / enumerateExports / findBaseAddress); cause — as of 17.0.0 the static lookup and enumeration APIs were all removed; statically only `Module.load` / `Module.findGlobalExportByName` / `Module.getGlobalExportByName` remain, and the rest became **module-instance methods**; fix — take an instance first, then look up: `Process.getModuleByName("libfoo.so").findExportByName("func")` (find returns null, get throws), the base uses `.base`, enumeration uses `.enumerateExports()`; a global symbol (the old `null` module argument) switches to `Module.findGlobalExportByName(...)`; note that `Process.getModuleByName` **throws** when the module is not loaded (the old `Module.findExportByName` returned null) — when unsure, use `Process.findModuleByName` to test for null first, then look up; before writing, `frida --version` to confirm the version and then pick the spelling (the migration list is in the version-related group of [[re-frida-script-author]])
- **spawn is too late → early logic is missed**: Symptom — after attach the hook does not fire, or early decryption has already finished; cause — the app decrypts / checks at startup, and attach is already past that; fix — start with `-f` spawn mode and instrument from the start; if it is still missed, hook an earlier execution point such as `dlopen` / `ClassLoader.loadClass`
- **The target detects frida (port / signature)**: Symptom — after spawn the app flashes and exits / hangs / behaves oddly; cause — the app scans port 27042, the frida-server path, the `frida` thread name, or maps signatures; fix — step 5 rename + change the port; if it is still detected, inject frida-gadget (hidden inside the process)
- **Root detection blocks instrumentation**: Symptom — frida can connect but the hook does not take effect, or it exits immediately; cause — the app does a root / jailbreak check first and exits when it detects the environment; fix — hook the detection function's return first (the step 5 template), and hook the target function only after the check is passed
- **A JS script fails silently**: Symptom — the script loads with no error but the hook produces no output; cause — a wrong class name, a Java API called outside `Java.perform`, or a module-name case mismatch; fix — cross-check the name with the enumeration in step 3 first, and plant `console.log` inside the script to locate it
- **A hooked export API is bypassed by a packer (direct syscall / API-name hash)**: Symptom — `IsDebuggerPresent`/`NtQueryInformationProcess` and similar exports were hooked successfully, but anti-debug still fires and the process exits; cause — a packed/hardened target does not go through the import table: it implements its own `GetProcAddress`, stores API names as hashes, or syscalls directly (an inline direct `Nt*` call), so the hook point is never reached; fix — hook one layer deeper (ntdll's syscall wrapper), trace the `GetProcAddress`/hash-resolution site and walk back to the real call site, and hook anti-debug and anti-VM (`RegOpenKeyExA`/`GetSystemFirmwareTable`) APIs together (the Arkana project field template); confirm the actual call target with `Process.enumerateModules()`/`enumerateExports` before instrumenting
- **Detection points escalate (memfd/JIT pool/in-memory strings/pipe names)**: Symptom — after renaming and changing the port, frida-server is still detected; cause — new detection is more than port and path: it scans memfd names in `/proc/self/fd`, the JIT cache pool (pool-frida), in-memory strings and export symbols such as `frida_agent.so`/`frida_rpc`, pipe/linjector names, and even non-standard ports (Promon-style scanning); fix — use the undetected-frida patch set (full obfuscation of strings/symbols/threads/protocol/memfd/JIT pool, in Magisk/KSU module form), or frida-gadget + a self-built hidden build, to shrink the fingerprint surface
- **Strong packing (the Pairipcore class) counters Frida as a whole**: Symptom — common hook scripts (certificate bypass/anti-detection/decrypt) all fail, spawn flashes and exits or behaves oddly, and community reports say frida-interception-class scripts cannot bypass it; cause — commercial packing does C++/Java dual-layer integrity checks + pseudo-VM instructions + custom dlopen/dlsym/syscall dynamic-import obfuscation + prctl/clone/waitpid/ptrace anti-debug + `/proc/self/maps`+`/proc/self/status` process monitoring + non-standard port scanning; it is a whole defense line, not a single point; fix — handle integrity checks and process monitoring first (hook the check function's return, patch the monitor point), then pass anti-debug; land the hook at the custom import resolver rather than an export API; if needed, combine an [[re-apk]] static smali edit with native-layer instrumentation
- **Multi-process / multi-implementation triage of a hooked exit function**: Symptom — hooking `SocketOutputStream` produces nothing, but a capture still shows traffic; cause — the app is multi-process (the logic that sends traffic is in a child) or it uses Netty's `SocketChannelImpl` (it does not take the OutputStream path); fix — triage order: hook the outermost exit → if nothing, `ps -e` and hook each child → then try an alternative implementation such as `SocketChannelImpl`; after the hook succeeds, print the stack (Netty's `MessageToByteEncoder` chain) to locate assembly/crypto code; walk up the "codec chain" layer by layer to the plaintext object and the ciphertext product
- **Tracing symmetric-crypto key transport**: Symptom — an RC4/AES ciphertext packet was captured, but the key changes every session and a static search finds nothing; cause — the symmetric key is generated dynamically and transported online (carried in plaintext / after encryption / negotiated); fix — hook where the key is passed in (an encryption-function argument of the `bArr` class) to take the current key, then trace the key's source and transport path upward, and compare with a capture (a fixed first-packet header such as `89 04 01 01` can be a protocol anchor)
- **A multi-layer TLS check stack**: Symptom — after a single-point hook, some requests still have SSL errors; cause — the app uses several stacks at once: OkHttp / native HttpsURLConnection / Conscrypt; fix — cover them in layers (hook OkHttp CertificatePinner + TrustManagerImpl.verifyChain + HostnameVerifier together); the bypass is complete only when the whole stack is covered
- **Locating the target class after ProGuard obfuscation**: Symptom — class names were changed to short names; cause — obfuscation; fix — in jadx, Find Usages walks back to who instantiates the key Builder, and the original class is inferred backward from the instantiation site
  (source: reverse-skill field-journal, MIT)
- **Wrong test environment → dynamic false negative / delivery false positive**: Symptom — in the same environment a hook does not fire, a memory patch has no effect, or the emulator is fine but a real device fails; cause — live Frida is unavailable on an x86 translation-layer emulator (`Process.arch==x64` and the target native so cannot be found), so the runtime never executed your bytes; some targets check loosely on an emulator, and "the emulator can run it" may be a downgrade illusion; fix — pick the environment by stage: a static patch and a render regression can use any emulator (including an x86 translation layer), dynamic instrumentation must be native ARM, and delivery verification must be a real device that matches the target; a translation-layer illusion can be falsified: patch the first instruction of a known-required function to a bare `ret`; if the UI still renders, the runtime did not execute your bytes, and stop live work in that environment immediately (an on-disk static patch is still usable, because the next start retranslates); before collecting on a real device, `svc power stayon true` and wake it, so a sleep screen does not cause a "blank" false screenshot
  (source: reverse-skills (inliver233), MIT)
- **redroid container setup and use pitfalls**: Symptom — the guest hangs silently / servicemanager spins, vold crashes, adb drops repeatedly, and the container cannot restart; cause — the binder mount is wrong (it must bind-mount `/dev/binder`; do not use `--device` or binderfs), a new kernel with no ashmem was not given `androidboot.use_memfd=1`, `ro.secure=1 ro.debuggable=0` killed root adb, a stopped container's binder is already gone so docker restart fails, and adbd crashes under high load; fix — bind-mount binder, force use_memfd on a new kernel, keep root adb (anti-tamper keeps the signature valid rather than hiding root), re-inject the adb public key after rebuilding the container (`echo $PUBKEY > /data/misc/adb/adb_keys`), use docker cp rather than adb push for large files, and use spawn mode for dynamic analysis (`frida -U -f`; attach often has 0 hits under anti-tamper); positioning — it is a data-collection tool, not an iteration environment; after collecting dynamic data, return to a stable environment for static-patch regression
  (source: reverse-skills (inliver233), MIT)
- **A hook on an AOT target does not fire / callers cannot be found**: Symptom — the hook produces no output, the target function's static callers=0, and the gate field is unknown so there is nowhere to set the needle; cause — the target so loads later than the engine (it was not loaded at attach), a virtual method goes through a cid dispatch wall (it is not called through BL, and there is no static shortcut), and the guard-field location is unknown; fix — hook only after the target so loads: a waitForLibapp wrapper that polls `findModuleByName` every 200ms; prefer spawn mode at the start; break the cid wall: at the target function's onEnter, record `lr` (returnAddress) + the first 20 frames of `Thread.backtrace(Backtracer.ACCURATE)`, and one backtrace locates the dispatch site; the guard-location trio: putCallout on `ldr`-class instructions inside a Stalker.follow transform (the first hit PC = the guard), MemoryAccessMonitor.enable waits for a rebuild trigger (arm64 support varies and needs a fallback), and a candidate-hook sweep; **runtime flip verification comes first**: a live `writePointer` flips a candidate gate field → trigger a rebuild → the component disappearing confirms the gate field; only then invest in a static patch, which saves repeated repackaging; as of frida 17 the Java bridge is no longer built into the underlying GumJS runtime, but the `frida` CLI/REPL and `frida-trace` still ship the three bridges, and an ordinary `frida -l` script needs no change; only a self-built agent / a script injected through bindings needs an explicit `frida-java-bridge` install (and frida-compile to bundle it if needed)
  (source: reverse-skills (inliver233), MIT)
