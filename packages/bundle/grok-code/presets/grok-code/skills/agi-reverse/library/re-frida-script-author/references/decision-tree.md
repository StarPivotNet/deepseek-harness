# Frida script-generation decision tree and evidence grading

## Scenario decision tree (entry → branches)

### 1. Target-type branch (first level)

```
Target object
├─ Java/ART layer (class/method-level logic)
│  └─ template family: Java hook (Java.use + implementation)
├─ Native layer (JNI / logic inside an so)
│  ├─ exported function → Interceptor.attach anchored on the export symbol
│  └─ non-exported/static function → call-site hook or memory-signature scan
├─ Flutter / React Native hybrid ([[re-hybrid-app]])
│  └─ locate JS/Dart-side logic by the hybrid structure first, then decide the hook surface
└─ cross-cutting capability (network/crypto/storage) → match the template table directly (step 2)
```

### 2. Target-behavior branch (second level)

```
What to do
├─ intercept data (arguments/return/plaintext)
│  ├─ TLS encryption → SSLKEYLOGFILE template
│  ├─ certificate pinning blocks capture → SSL pinning-bypass template
│  └─ crypto algorithm/key → Cipher intercept template (every overload)
├─ bypass a check/limit
│  ├─ root/debugger/emulator detection → detection-bypass table
│  └─ certificate/signature check → check bypass (observe only, do not persist; red line)
├─ recover logic
│  ├─ JNI dynamic registration → RegisterNatives + convergence-point dual hook
│  └─ runtime-decrypted content → DEX/SO dump template
└─ trace a call sequence → logging hook (do not interrupt, do not change values)
```

### 3. Verification-failure triage branch (when there is no output)

```
hook produced no output
├─ the script console has an exception → fix syntax / API version (the version group in [[gotchas]])
├─ no error but no output
│  ├─ class not loaded → Java.choose / hook the class-load point ([[re-analyze/anti-dynamic-workflow]])
│  ├─ overload mismatch → enumerate overloads and pick again
│  ├─ target path not triggered → operate the app to trigger it, then observe
│  └─ multiple hooks overwrite each other → merge into one implementation
└─ process not injected / connection failed → check the device connection and frida-server version ([[re-frida]])
```

## Evidence grading table

| Grade | Evidence shape | Example | Use |
|---|---|---|---|
| A strong | Dynamic intercept + static cross-check closes | The target call was intercepted, and arguments/return match the jadx decompilation | May conclude (key, call chain, plaintext format) |
| B medium | Dynamic output is parseable but has no static cross-check | Only hook output; the static side does not match or is missing | May conclude "suspected", and note the missing static side |
| C weak | Static inference | The call is inferred only from decompilation and was not confirmed dynamically | Supports only "pending verification" |
| Counter-evidence | Benign explanation | A call was detected but confirmed to be a normal function path | Record and archive it |

- Archive script output per the [[re-analyze/analysis-contract]] contract: timestamp, process, hook point, arguments/return, raw hex
- State bypass-class conclusions (detection bypass succeeded / pinning bypass succeeded) separately from data-class conclusions

## Lessons internalized

- Probe first, then write: enumerate class name / method name / overload count before hard-coding; do not guess target symbols in the script
- Wrap Java operations in `Java.perform`; in a callback-thread scene, mind the thread switch (`Java.scheduleOnMainThread`)
- Structured JSON output (ASCII + hex) is more consumable than printing strings; wrap each hook body in `try/catch`, and send errors as messages instead of failing silently
- Minimize hooks: intercept only the methods you need — a whole-class hook adds performance and stability noise; verify a small range first
- Check the current frida version before using a version-sensitive API: as of Frida 17 the static Module lookup API was removed ([[gotchas]])
- Reproducibility: archive the placeholder template together with the target-feature list so the script can be replayed

## Usage notes

- Dynamic execution is inside a sandbox ([[re-sandbox]] / [[re-analyze/platform-tips]] highest principle)
- Bypass scripts observe only and do not persist (red line); archive output per the [[re-analyze/analysis-contract]] contract
