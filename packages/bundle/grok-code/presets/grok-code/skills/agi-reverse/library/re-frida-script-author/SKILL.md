---
name: re-frida-script-author
type: atomic
description: >
  Frida script-generation methodology: target features → template choice → rewrite → verify. Independent of execution instrumentation (re-frida).
  Triggers: `生成Frida脚本`, `写hook脚本`, `frida脚本怎么写`, `写个hook`, `脚本生成`.
capabilities: [frida-instrumentation]
---

# Frida script generation

## When to use / when not to use

- Use: when you need a new script — intercept (crypto/network/file), bypass (detection/pinning), trace (JNI/method calls)
- Use: a variant that no ready template covers — rewrite a target-specific script from the [[re-frida/frida-scripts]] templates
- Do not use: running a ready script → hand off to [[re-frida]] (this skill only produces scripts; running and process management are in re-frida)
- Do not use: whole-surface anti-detection analysis → [[re-analyze/anti-dynamic-workflow]]
- Do not use: a problem that pure static analysis can solve — take the [[re-apk]] / [[re-ghidra]] static path first; dynamic is the last resort
- Do not use: the target is unreachable (no device / no root / no jailbreak, packing blocks injection) — fix the environment first ([[re-frida]] Tool setup); do not force a script

## Tool setup

### frida-tools (script writing and run verification)

- Recommended (upstream path): `python -m pip install -U frida-tools`; prefer a venv or pipx isolated environment
- Third-party channels: `brew install frida` and other non-upstream channels; before install, check version and maintenance status; do not treat them as equivalent to the pip path
- Verify: `frida --version`, `frida-ps -U` (after connecting a device)
- Note: `frida` (runtime) and `frida-tools` (CLI) versions must match; a major upgrade (16 → 17) removes APIs; spelling differences are in the version group of [[gotchas]]

### python3 (script debugging)

- Each platform follows [[re-python]] Tool setup

### Decompiler aids (for recon)

- jadx ([[re-apk]]) statically produces the class/method list; Ghidra/IDA ([[re-ghidra]] / [[re-ida]]) locate native-side symbols and call sites
- Verify: can list the target class and method signatures by package name

### Target device / emulator

- Android device/emulator + frida-server (at least the same major as host frida; install is in [[re-frida]] Tool setup); a desktop target is the local machine
- iOS jailbreak frida-server is in [[re-ios-jb]]

## Procedure

Four steps, "probe → choose → rewrite → verify". Probe first, then write; do not guess. Record path + sha256 for each step's products (feature list / script / verification output) (see [[re-triage]]), for the report.

1. **Target recon**:
   - Static: target package/class/key APIs ([[re-apk]] jadx output), packer-vendor signatures ([[re-mobile-pack]]), Flutter/RN hybrid structure ([[re-hybrid-app]])
   - Dynamic baseline: run once as-is and capture crashes and logs (crash signatures → protection-mechanism comparison; see [[re-analyze/anti-dynamic-workflow]])
   - Product: a target feature list — detection points / fully qualified target API names / input-output shape / method overload count
   - If a class/method name is uncertain, enumerate it with a small script first (`Java.enumerateLoadedClasses` / `Java.use(...).overloads`); do not guess names
   - Record recon conclusions in [[re-analyze/analysis-contract]] contract fields (package/class/API list), for reuse by the script and the report

2. **Template choice**: match the feature list against the [[re-frida/frida-scripts]] template table:

| Target feature | Template |
|---|---|
| HTTPS capture is TLS-encrypted (BoringSSL) | TLS key log (SSLKEYLOGFILE) |
| Certificate pinning blocks capture | SSL pinning bypass (TrustManager/CertificatePinner) |
| Crypto algorithm/key must be extracted | Crypto intercept (every Cipher/SecretKeySpec overload) |
| Packing / runtime decryption | DEX dump (class-load point) / SO dump |
| Mutual-TLS client certificate | keystore p12 export |
| JNI dynamic registration must be recovered | RegisterNatives + convergence-point dual hook |
| Anti-debug / detection intercept | Detection-bypass table (root/property/file/command) |

   - If the features match no template → combine and rewrite (assemble several templates) rather than writing from zero
   - After choosing a template, read its known-boundary comments first ([[re-frida/frida-scripts]]), so you do not hit the same pitfall twice

3. **Rewrite**:
   - Replace placeholders: package/class/method names (exact match; Java fully qualified names)
   - Match overloads exactly: enumerate `overloads` first, then define each one or select by parameter type (see pitfall 1)
   - Structure rules: wrap Java operations in `Java.perform`; save the original reference and call it with the original `this`; in `Interceptor.attach`, onEnter reads registers from `this.context`; **a return value can be changed only in onLeave with the argument `retval.replace(...)`** — `this` has only returnAddress/context/errno/lastError/threadId/depth, and there is no `this.returnValue`; retval is reused across calls, so if you need to keep it, copy it first with `ptr(retval.toString())`
   - Output unified JSON (printable ASCII + hex) through `send()`; wrap each hook body in `try/catch`, and send errors as messages instead of failing silently
   - Merge multiple hooks on the same class into one `.implementation` (the cache overwrites silently; see pitfall 2)
   - Skeleton reference (minimal Java + native dual surface; trim to the target):
      ```js
      Java.perform(function () {
        var Cls = Java.use("com.target.Cls");
        Cls.method.overload("java.lang.String").implementation = function (s) {
          try { send({ type: "call", arg: s ? s.toString() : null }); }
          catch (e) { send({ type: "error", msg: String(e) }); }
          return this.method(s);          // 调原实现（保留原 this）
        };
      });
      Interceptor.attach(
        Process.getModuleByName("libtarget.so").getExportByName("func"),
        { onEnter: function (args) { send({ type: "native", arg0: args[0].toInt32() }); } }
      );
      ```
   - Native side: prefer export symbols (`Process.getModuleByName(...).getExportByName`; the old spelling `Module.getExportByName` is in the version group of [[gotchas]]); a non-exported function uses a call-site hook or a memory-signature location

4. **Verify**:
    ```sh
    frida -U -f <pkg> -l script.js --pause   # spawn + 停在早期代码前
    frida -U -f <pkg> -l script.js -o out.json  # 输出存文件（大流量/批量时）
    ```
   - Verification checklist: hook attached successfully (no error output) → trigger the target path (operate the app or reproduce the call) → output matches static analysis → repeated triggers produce stable output
   - Output JSON is parseable, and target behavior matches expectations (the target call was intercepted / the bypass took effect)
   - Failure → back to step 2 and rechoose the template or refine the features; crash → locate it with the crash comparison table in [[re-analyze/anti-dynamic-workflow]]; empty output → see the triage branch in [[decision-tree]]

## Cross-domain joins

- [[re-frida]]: script execution (this skill's product → re-frida runs it)
- [[re-mobile]] / [[re-android-native]]: join for a mobile-target scene
- [[re-analyze/anti-dynamic-workflow]]: detection surface and crash iteration method
- [[re-frida/frida-scripts]]: template library (re-frida references)
- [[re-analyze/analysis-contract]]: script output is consumed under the data contract (evidence archive)
- [[re-ios-jb]]: execution side of an iOS jailbreak environment

## Common pitfalls

- **overload mismatch fails silently**: Symptom — the hook produces no output; cause — the target method's overload signature does not match the definition; fix — list every overload with `Java.use(...).<method>.overloads` first, then choose
- **Java.use cache overwrite**: Symptom — of several hooks, only the last one takes effect; cause — assigning `.implementation` several times on the same class overwrites silently; fix — merge into one hook
- **Argument index is version-dependent**: Symptom — native arguments are read wrong; cause — the target version's fields / argument positions changed; fix — verify against the target symbols; do not copy experience values
- **Writing a script without recon**: Symptom — the script does not match the target; cause — step 1 was skipped; fix — probe first, then write
- **Bypass scripts observe only and do not persist**: Symptom — after the test, the target state was changed; cause — the script contains a write; fix — the script only reads/logs; a bypass is only for observation (red line)
- **A hook does not fire when the class is not loaded**: Symptom — the class exists but there is no output; cause — lazy load / delayed load from packing; fix — `Java.choose`, or hook the class-load point ([[re-analyze/anti-dynamic-workflow]])
- **Version-dependent API error**: Symptom — `Module.getExportByName is not a function`; cause — Frida 17 removed the static Module lookup API; fix — migrate the spelling per the version group in [[gotchas]]
- Template-choice branches and the verification triage tree are in [[decision-tree]]; version differences and boundaries are in [[gotchas]]; execute entirely inside a sandbox ([[re-analyze/platform-tips]] highest principle), and archive script output per the [[re-analyze/analysis-contract]] contract
