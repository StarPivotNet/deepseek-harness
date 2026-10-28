# JNI runtime probes (Runtime Probes)

Volatile-parameter layer: ABI argument registers / libart internal structures / runtime implementation details — **do not write these into the SKILL.md core flow** (NDK / ART version changes can affect the implementation); runtime probing and checks are authoritative. The `JNIEnv` function-table index layout is a fixed ABI (`RegisterNatives`=215) and is not in this list.

## Locating the RegisterNatives slot

`RegisterNatives` is at standard `JNIEnv` function-table index **215** (`UnregisterNatives` 216) — a fixed JNI ABI layout, consistent across JDK 8/11/17/27, GraalVM 21, and the Android NDK (new helpers are only appended at the tail and do not change existing indexes). The actual byte offset = index × target pointer width: on 64-bit, 215×8=0x6B8; on 32-bit, 215×4=0x35C.

### Runtime anchors (for checking)

A fixed index does not mean the runtime implementation follows the spec — the anchors below are for **checking**, not for deriving:

- Take the function-table base from `JNIEnv*`, read the index-215 slot value, and stub-call it with signature shape `(JNIEnv*, jclass, JNINativeMethod*, jint)` to confirm
- Cross-check other fixed slots: `NewStringUTF`=167, `GetJavaVM`=219 (stable semantics, called often, good validity anchors)
- An abnormal slot value (null, pointing outside libart/system-library range, several slots pointing at the same address) → suspect a hooked/proxy function table or a non-standard implementation; restore it before continuing

### Alternative: hook an ART internal function (version-bound)

`art::JNI::RegisterNatives` (a libart.so export, visible in a debuggable process) — the symbol name is stable across versions; the internal structure changes with the ART version. Use it only as a cross-check; do not hard-code offsets.

## Frida script template

```js
// After hooking JNI_OnLoad, locate RegisterNatives by the fixed index
var REGISTER_NATIVES_INDEX = 215;                 // fixed JNI ABI slot
Interceptor.attach(Module.findGlobalExportByName("JNI_OnLoad"), {   // Frida 17+: static lookup of a global symbol
  onEnter: function () {
    var env = this.context.x0;                    // arm64: JNIEnv* is in x0 (ABI-specific; see below)
    var table = env.readPointer();                // env[0] = JNINativeInterface function table
    var RegisterNatives = table.add(REGISTER_NATIVES_INDEX * Process.pointerSize).readPointer();
    if (RegisterNatives.isNull()) { console.log("slot empty — suspect a non-standard implementation or a hooked table"); return; }
    Interceptor.attach(RegisterNatives, { onEnter: function (a) {
      console.log("RegisterNatives:", a[1], a[2].readPointer());   // clazz + methods array
    }});
  }
});
```

**ABI note (volatile)**: the register that passes JNIEnv* follows the ABI — arm64 x0, arm32 r0, x86_64 rdi — use the current architecture's `this.context`; do not hard-code it.

## Runtime check list

After the hook is live, check each item so you do not hook the wrong thing:

1. **Argument shape**: the hooked method is called and the argument shape matches `(JNIEnv*, jclass, JNINativeMethod*, jint)`; a mismatch → suspect a non-standard implementation or a misjudged call site
2. **Function-table validity**: cross-check the table base with fixed slots such as `NewStringUTF`(167) / `GetJavaVM`(219); confirm it is correct and there is no hooked/proxy function table
3. **Multiple ABIs**: confirm each ABI (arm64-v8a / armeabi-v7a / x86_64) on its own — the index is the same, but argument registers and pointer width differ (byte offset changes with width); branch the script on `Process.arch`

## Usage notes

- Function-table indexes are a fixed ABI; do not "re-derive them from jni.h declaration order" again. What is actually volatile is ABI argument registers, libart internal structures, and runtime implementation details; measure them on the target environment
- The core flow (SKILL.md step 3) describes mechanism and strategy only; every volatile number is maintained in this file
