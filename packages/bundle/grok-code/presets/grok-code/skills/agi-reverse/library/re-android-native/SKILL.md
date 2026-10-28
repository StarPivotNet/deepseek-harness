---
name: re-android-native
description: >
  Android native-library JNI reversing: so extraction, JNI registration recovery, native logic analysis.
  Triggers: JNI, .so, Android native, xhook, IDA so
capabilities: [jni-analysis]
---

# Android native library (JNI/.so) reversing

## Entry decision (Decision Gate)

When a target appears, first judge its form and hand off to the matching skill (automatic routing):

```
Target
├── APK
│    ├── lib/*.so present? ── yes ──→ this skill (re-android-native)
│    └── no so (pure Java) ──→ re-apk
├── standalone .so
│    ├── JNI symbols (Java_* / JNI_OnLoad / RegisterNatives call sites) ──→ this skill
│    ├── crypto-library API (SSL_*/EVP_*/crypto_* and similar) ──→ re-android-crypto (crypto semantics)
│    └── ordinary ELF (no JNI features) ──→ re-binary-core (re-format-elf)
├── packed so (packer stub / high entropy / tiny import table) ──→ re-anti-analysis / re-mobile-pack (return here after unpack)
└── crypto-system audit target (Keystore/Cipher) ──→ re-android-crypto
```

## When to use / when not to use

- Use: a `lib/*.so` native library inside an APK — JNI interface recovery, registration style (static/dynamic), native logic analysis
- Use: the Java layer is clear but the core algorithm / anti-debug lives in native (games, packers, crypto logic)
- Use: the Java layer only shows `System.loadLibrary` + a `native` declaration, and you need to locate and recover the native implementation
- Do not use: APK Java-layer static only (go to [[re-apk]]); runtime hook only, with no need to understand .so structure (go to [[re-frida]])
- Do not use: the so is a packer stub (unpack first per [[re-mobile-pack]] / [[re-anti-analysis]]; see pitfall 5)
- Note: dynamic instrumentation follows the [[re-analyze/platform-tips]] supreme rule and runs on a controlled device / emulator snapshot

## Tool preparation

Static analysis (readelf / import a .so into Ghidra) can skip the sandbox; dynamic work (frida / xhook) follows the [[re-analyze/platform-tips]] supreme rule and runs in a controlled environment. Verify every tool before use.

### Decompiler workbench (load the so) — [[re-ghidra]] / [[re-ida]]

- [[re-ghidra]] (default): `File > Import File` imports an ELF .so directly (arm64/arm/x86_64 are all supported); Data Type Manager loads jni.h types (see [[re-ghidra]] tool preparation)
- [[re-ida]]: after loading the so, decompile ARM64; `Option > Load new type` loads jni.h
- Verify: after importing an arm64 .so you can decompile `JNI_OnLoad` or a `Java_*` export

### jni.h — understanding the JNIEnv function-table structure (ships with the Android NDK)

- No standalone distribution package; it ships with the Android NDK. Official path: install the NDK from Android Studio SDK Manager, or from the command line:
  ```sh
  sdkmanager "ndk;27.2.12479018"     # first confirm sdkmanager is on PATH (Android SDK cmdline-tools)
  # or download the matching version zip from the official GitHub android-ndk repository
  ```
- Key file: `$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/jni.h` (macOS uses the darwin-x86_64 path)
- Verify: you can open jni.h and see the `JNINativeInterface` (function table) and `JNIEnv` (function-table pointer) definitions

### readelf (binutils) — export table / architecture identification (join with [[re-format-elf]])

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils` (`greadelf`)
- Verify: `readelf --version`

### frida ([[re-frida]]) — observe JNI at runtime

- Host: `pip install frida-tools`; push and install frida-server on the device per [[re-frida]] tool preparation
- Verify: `frida-ps -U` lists device processes

### adb — pull so files from the device / install the APK

- Linux: `apt install adb` (Debian/Ubuntu) / `dnf install android-tools` / `pacman -S android-tools`
- macOS: `brew install android-platform-tools`; Windows: the official platform-tools zip
- Verify: `adb version`

## Procedure

Run in order. Record an evidence path + sha256 for each step's artifacts (so path, readelf output, Ghidra project, frida script) (see [[re-triage]]) so the report can cite them.

1. **Extract the so and identify the architecture**:
   ```sh
   unzip app.apk -d app/                        # an APK is a zip
   find app -name "*.so"                        # every native library under lib/
   file app/lib/arm64-v8a/libtarget.so          # confirm the architecture (ELF 64-bit ARM aarch64)
   readelf -h app/lib/arm64-v8a/libtarget.so    # Machine: AArch64 / x86-64
   readelf -d app/lib/arm64-v8a/libtarget.so    # dependent libraries and the dynamic segment
   ```
   - ABI directories: `arm64-v8a` (primary on real devices), `armeabi-v7a` (32-bit), `x86_64`/`x86` (emulator) — multi-ABI differences are in pitfall 4
   - Installed app: `adb pull /data/app/.../lib/arm64-v8a /tmp/lib/` (needs root or debuggable)
   - Record: target ABI, export-table size, dependencies (`readelf -d` NEEDED), whether it is stripped (`readelf -s` symbol count)

2. **Recover the JNI interface (JNIEnv function table)**:
   ```sh
   readelf --dyn-syms app/lib/arm64-v8a/libtarget.so | grep -i java    # statically registered Java_* exports
   readelf --dyn-syms app/lib/arm64-v8a/libtarget.so | grep -i JNI     # JNI_OnLoad / JNI_OnUnload
   ```
   - **JNIEnv is a function-table pointer**: `JNIEnv* env` actually points at the `JNINativeInterface` function table (defined in jni.h); a call is a table-slot access of the form `(*env)->GetStringUTFChars(env, ...)` — "load a function pointer from a struct offset, then call it" in the decompiler is a JNI API; see pitfall 1
   - After Ghidra/IDA loads jni.h types, recover by name: `GetStringUTFChars` (**Java jstring → Modified UTF-8 byte sequence**), `NewStringUTF` (**Modified UTF-8 → Java String**), `CallVoidMethod`/`CallBooleanMethod` (call back into Java), `GetJavaVM` (obtain the JavaVM inside the process)
   - **It is Modified UTF-8, not standard UTF-8**: they differ on the null-character encoding (`0xC0 0x80`) and on supplementary characters (surrogate pairs) — parsing as standard UTF-8 yields the wrong string, and `strlen`-style operations that count bytes also fail to match (character count must come from JNI's own length API)
   - Recovery target: the native function signature (`(JNIEnv*, jclass/jobject, business args...)`) — the first argument is env, the second is jclass (static) or jobject (instance), and business arguments start at the third

3. **Registration style (static JNI_OnLoad / dynamic RegisterNatives)**:
   - Static registration: the function name is `Java_<package>_<class>_<method>` (underscores escaped) and appears directly in the export table (visible in step 2)
   - Dynamic registration: `JNI_OnLoad` calls `RegisterNatives(env, clazz, methods, count)`; `methods` is a `JNINativeMethod{name, signature, fnPtr}` array — **all three fields are pointers, and the width follows the ABI** (8 bytes each on 64-bit; **4 bytes each on 32-bit ABIs such as armeabi-v7a / x86**, array stride 12 bytes) — **the function address is not in the export table** (see pitfall 2); after decompiling `JNI_OnLoad`, walk the RegisterNatives third-argument array item by item
   - Mechanism (knowledge layer): `JNIEnv*` points at the `JNINativeInterface` function table (see pitfall 1); `RegisterNatives` is at standard `JNIEnv` function-table index **215** (`UnregisterNatives` 216) — a fixed JNI ABI layout; the actual byte offset = index × target pointer width (on 64-bit, 215×8=0x6B8). Android Dalvik/ART, the NDK, and standard `jni.h` do not change that index
   - Observe runtime registration with frida (spawn the target app): script templates and runtime check strategy (`JNIEnv*` validity / hooked-table detection / ABI argument branches) are in [[probes]] — what is volatile is ABI argument registers and libart internal structures; measure them on the target environment
     ```
   - Output: a `Java method name → signature → native function address` table

4. **Logic analysis (join with [[re-ghidra]])**:
   - Import the so into Ghidra → load jni.h types (step 2) → decompile each native function with F5
   - When symbols do not help, work backward from API call sites: JNI API arguments are the entry for business data (for example the return of `GetStringUTFChars` is the input string)
   - Dig into algorithm / check / decrypt logic with the [[re-binary-core]] methodology; if it is obfuscated (OLLVM flattening / string encryption) → go to [[re-deobfuscate]] (pitfall 3)
   - Statically registered `Java_*` functions often call each other (an internal native function table / callbacks); trace where function pointers come from ([[re-binary-core]] R6 approach)

5. **Interaction with the Java layer (locate native call sites)**:
   - Java side ([[re-apk]] / jadx): the class that contains `System.loadLibrary("target")` and the `native` method declarations — `Java_<package>_<class>_*` names come from here
   - In jadx, find the call site of each `native` method (who triggers it on which business path) and align it with the step 3 table, forming a `Java call site ↔ native function` map
   - Dynamic check: inside frida `Java.perform`, call the native method directly (`Java.use("com.x.Cls").method(...)`) and watch arguments and the return; or use an xhook / PLT-hook approach ([[re-frida]] `Interceptor.attach(Process.getModuleByName(...).findExportByName(...))`) to watch the native side's call chain into external libraries (libc / system libraries)
   - Close the loop: Java trigger → argument source → native processing → output back to the Java layer

## Cross-domain joins

- [[re-mobile]]: this skill is the specialized sub-skill of workflow step 4 (native libraries) — the gateway always dispatches here after it recognizes a target that contains `.so`
- [[re-frida]]: dynamically observe RegisterNatives / hook native functions / verify Java↔native interaction (spawn to catch JNI_OnLoad)
- [[re-format-elf]]: export table / dynamic segment / symbol parsing (the three readelf tables), the precondition for locating dynamically registered functions
- [[re-ghidra]]: so decompiler workbench + jni.h type load
- [[re-apk]]: Java-side static (jadx finds native declarations and call sites); after packer identification, hand off to the unpack domain
- [[re-deobfuscate]]: recover OLLVM / string-encrypted native code
- [[re-mobile-pack]] / [[re-anti-analysis]]: unpack a packed so stub before analysis (pitfall 5)
- [[re-android-crypto]]: crypto-system audit (Keystore/Cipher/third-party crypto-library semantics) is now a separate skill — this skill focuses on JNI/native logic; crypto semantics of crypto-library APIs inside a .so go to [[re-android-crypto]]
- [[re-analyze]]: called by the triage "mobile app analysis" path (re-mobile → native library → this skill)
- [[re-analyze/platform-tips]]: supreme rule for dynamic instrumentation in a controlled environment

## Common pitfalls

- **JNIEnv is a function-table pointer (not a direct call)**: symptom — JNI call sites in the decompiler look like "load a function pointer from a struct offset, then call it", arguments do not line up, or treating `GetStringUTFChars` as an ordinary string function is wrong; cause — `JNIEnv` points at the `JNINativeInterface` function table, and every JNI API is a function pointer in a table slot; the C form is `(*env)->fn(env, ...)`; fix — load jni.h types in Ghidra/IDA (Data Type Manager import), declare `JNIEnv` as `JNINativeInterface**`, and the decompiler recovers `env->GetStringUTFChars(env, str)`; without a type library, build the struct by hand from `JNINativeInterface` slot indexes
- **Dynamically registered function addresses are not in the export table**: symptom — `readelf --dyn-syms` / strings cannot find `Java_*` or business function names, and IDA is all addresses with no names; cause — under dynamic registration the functions are static/local symbols, and only at runtime does `RegisterNatives` bind the address to a Java method; fix — `JNI_OnLoad` is an optional library-load hook, not a required export: if it exists, decompile it and walk the RegisterNatives third-argument array item by item (name/signature/fnPtr are **each one pointer**: 8 bytes on 64-bit, 4 bytes on 32-bit); if it does not exist (or is absent from the export table), start from other `RegisterNatives` call sites, JNI function-table xrefs, and strings, or spawn with frida and hook RegisterNatives (step 3 script) to take the runtime registration table directly
- **Obfuscated native (OLLVM)**: symptom — the decompiler is all control-flow flattening (a switch dispatcher), strings are all encrypted, and functions are huge and hard to read; cause — a game/packer vendor protected the native code with OLLVM (flattening, bcf, sub) or commercial obfuscation (VMP-class); fix — first identify the obfuscation type (flattening vs instruction virtualization); for flattening, recover per [[re-deobfuscate]] (state variable + case blocks); for string encryption, locate the decrypt function and batch-decrypt with a script; if that still fails, take runtime plaintext with frida (hook the decrypt function and read memory)
- **Multi-ABI architecture differences**: symptom — offsets/instructions analyzed for arm64 are completely wrong on armeabi-v7a, or behavior on an x86_64 emulator differs from a real device; cause — an APK ships one so per ABI, and compile optimization / instruction set / calling convention differ (arm64 passes arguments in x0-x7, arm32 has thumb, x86_64 uses rdi/rsi...), and some so files also return different implementations per ABI (for example an arm64 real-device branch vs an x86_64 emulator branch); fix — confirm the target ABI with `file`/`readelf -h` first; analyze against the real-device ABI (arm64-v8a); treat x86_64 results as reference only; JNI type widths are consistent across ABIs (jlong=64-bit, jint=32-bit) but C-level `long` width differs, so watch type annotations in the decompiler
- **Packed so (packer stub)**: symptom — static analysis of the so shows only a short stub / packer code, and decompiling `JNI_OnLoad` shows an unpack flow; cause — the so is packed (vendor packer / commercial packer) and the real logic is decrypted into memory only at runtime; fix — identify the packer first ([[re-apk]] packer identification + entropy), unpack statically per [[re-mobile-pack]], or use runtime [[re-memdump]] to extract the already-decrypted so from memory and analyze that; archive the unpack artifact by sha256 and rerun from step 1

## Experience library

The full practice collection is in [[experience]].
