---
name: re-java
description: Java bytecode reversing: CFR/JD-GUI, jar unpack, Java packing. Triggers: Java, jar, `字节码`, JD-GUI, CFR, `class文件`
capabilities: [bytecode-parser]
---

# Java bytecode reversing (CFR / JD-GUI / javap)

## When to use / when not to use

- Use: recover Java logic from a jar/war/class sample; locate a registration code / key / network logic; handle ProGuard/Allatori obfuscation and Java packing
- Use: static recovery of a malicious Java sample (the [[re-malware]] → [[re-managed]] path)
- Do not use: direct analysis of Android DEX ([[re-apk]]; after conversion to a jar you can return to this skill)
- Do not use: non-Java (.NET goes to [[re-dotnet]], scripts to [[re-script-deob]], native to [[re-binary-core]])
- Note: dynamic steps default to a sandbox (top principle in [[re-analyze/platform-tips]]); back up unpack products first

## Tool setup

See [[re-analyze/platform-tips]] — decompile/unpack are static steps and need no sandbox; dynamic verification goes into a sandbox under the top principle.

### JDK (javap / jar / java runtime)

- Debian/Ubuntu: `apt install openjdk-17-jdk`
- Fedora: `dnf install java-17-openjdk`; Arch: `pacman -S jdk17-openjdk`
- macOS: `brew install openjdk` (or `brew install --cask temurin`)
- Windows: `choco install temurin` or the official installer
- Verify: `java -version && javap -version`

### unzip (jar = zip container)

- Linux: `apt install unzip` / `dnf install unzip` / `pacman -S unzip`; macOS: `brew install unzip`
- Verify: `unzip -v`

### CFR (jar CLI decompiler, zero dependencies)

- Download (no dependencies, only a JRE): `curl -L -o cfr.jar https://www.benf.org/other/cfr/cfr-0.152.jar`
- Verify: `java -jar cfr.jar --help`

### JD-GUI (GUI decompiler)

- GitHub `java-decompiler/jd-gui` release zip → unzip. Linux/macOS: `java -jar jd-gui-1.6.6.jar` (the zip contains per-platform executables)
- Verify: the GUI starts and `File > Open` can open a jar

### procyon (alternate decompiler)

- Maven Central: `curl -L -o procyon-decompiler.jar https://repo1.maven.org/maven2/org/bitbucket/mstrobel/procyon-decompiler/0.6.0/procyon-decompiler-0.6.0.jar`
- Verify: `java -jar procyon-decompiler.jar --help`

## Procedure

Run in order. Record evidence at each step (path + sha256, see [[re-triage]]).

1. **Unpack jar/war**:
   ```sh
   jar tf app.jar                 # list first (the jar tool bundled with the JDK)
   unzip -o app.jar -d unpacked/
   unzip -p app.jar META-INF/MANIFEST.MF   # Main-Class / packer marker
   ```
   - war: classes are in `WEB-INF/classes/`, dependencies in `WEB-INF/lib/`
   - fat jar (Spring Boot): classes are in `BOOT-INF/classes/`, nested dependencies `BOOT-INF/lib/*.jar` must be unpacked one by one
   - aar (Android): contains `classes.jar`; unpack it and then handle it with this skill
   - Multi-Release jar: multiple versions of the same path live under `META-INF/versions/N/` (N=9/11/17…) and override — the runtime loads the layer for the JDK. When reversing, look at the layer for the target JDK. Do not look only at the top level

2. **Identify class structure**:
   ```sh
   javap -c -p unpacked/com/example/Main.class    # bytecode (-c) + private members (-p)
   javap -v unpacked/com/example/Main.class       # constant pool / metadata
   ```
   - Find the entry: `Main-Class` in MANIFEST.MF → `javap -c -p <entry class>` for the main logic
   - An obfuscated assembly: if class names are unreadable (a/b/c → step 4), look there first
   - class file-header cheat sheet: `xxd -l 8 <class>.class` → `CA FE BA BE` + minor(2) + major(2); Java version = major − 44 (52=Java 8, 55=11, 61=17, 65=21; a measured JDK 21 product has major=65); the first line of `javap -v` prints minor/major directly
   - Constant pool: the count is after major (u16, index 0 is a placeholder). `javap -v` lists entry types (String/Class/NameAndType/Methodref/Utf8, and so on) — string literals, class names, and signatures are all in the constant pool. For an obfuscated sample, look for plaintext strings here first

3. **Recover logic (CFR / JD-GUI)**:
   ```sh
   java -jar cfr.jar app.jar --outputdir cfr_out/           # restore the whole package to Java source
   java -jar cfr.jar unpacked/com/example/Main.class        # restore one class
   java -jar procyon-decompiler.jar -jar app.jar -o procyon_out/   # alternate
   ```
   - JD-GUI: `File > Open` → browse the left tree → `File > Save All Sources` to export
   - Cross-check key classes/methods with two decompilers (CFR restores lambda/modern bytecode better; JD-GUI is smoother on old code)

4. **Obfuscation identification and string decryption**:
   - ProGuard: class/method names all become `a/b/c`, and `javap -l` has no LineNumberTable/LocalVariableTable (debug info was stripped)
   - Allatori: the decompiled product shows `com.allatori.*` watermark classes and `StringEncryptor` calls (string encryption)
   - ZKM (Zelix KlassMaster): `com.zelix.*` class features
   - Detect: `grep -rn 'StringEncryptor\|decrypt(' cfr_out/ | head`
   - Handling string encryption: locate the decrypt class and algorithm (key / transform) → reproduce it in python3 and restore in batch; or take plaintext dynamically (step 5, inside a sandbox) — restore statically first, and go dynamic only when static work stalls

5. **Dynamic (optional; run inside a sandbox, [[re-sandbox]])**:
   - JDB (desktop JVM):
     ```sh
     jdb -classpath app.jar com.example.Main
     > stop in com.example.Main.checkKey     # set a breakpoint
     > print key                             # read a variable
     > eval new com.example.Util().decrypt("密文")   # call the decrypt method directly and take the plaintext
     ```
   - Frida (Android Java apps; hand off to the [[re-mobile]] / [[re-apk]] domain):
     ```js
     Java.perform(function () {
       var c = Java.use("com.example.Main");
       c.checkKey.implementation = function (k) {
         console.log("key = " + k);
         return this.checkKey(k);
       };
     });
     ```
   - A desktop JVM has no Frida Java API → use JDB / a Java agent you write

## Cross-domain

- [[re-managed]]: gateway workflow steps ② (decompile) and ③ (deobfuscate) always call this skill
- [[re-malware]]: the Java malware path (re-malware → re-managed → static recovery with this skill)
- Android side: [[re-apk]] / [[re-mobile]] (after DEX is converted to a jar you can return to this skill); dynamic [[re-frida]] (Android)
- Base [[re-binary-core]]: initial survey ([[re-triage]]); the native/JNI part

## Common pitfalls

- **After ProGuard renaming, cross-reference from strings**: symptom — decompilation is all `a/b/c` classes and `a(...)` methods, and the target logic cannot be located; cause — ProGuard shrink+obfuscate renamed away the semantics; fix — start from strings: grep plaintext URLs / prompt text → find the class that references it in the decompiled product (`grep -rn "提示语" cfr_out/`) → recover meaning along the call chain
- **Allatori / string encryption must be decrypted first**: symptom — decompilation only shows `StringEncryptor.decrypt("...")` calls and no plaintext; cause — strings are decrypted only at runtime; fix — statically locate the decrypt algorithm and key → reproduce it in python3 and restore in batch; or take plaintext dynamically after the decrypt call (JDB `eval` / Frida), inside a sandbox
- **Decompilation is not fully correct**: symptom — CFR/JD-GUI output has syntax errors, messy goto/label, a strange try-catch structure, or a failed lambda restore; cause — bytecode to Java has no lossless restore; fix — correct it by hand against `javap -c -p` bytecode, and cross-check with several decompilers
- **Java packing (for example Virbox) is packer-like and must be unpacked first**: symptom — JD-GUI errors or is blank, `javap` output is corrupt, the file header is nonstandard; cause — the packer encrypts class bytecode and decrypts it only at runtime (it is a packer); fix — unpack first: dump classes at runtime (attach an agent / a dedicated unpacker is primary; `-Xbootclasspath` works only on JDK 8 and was removed in JDK 9+) → decompile the dumped standard classes; same idea as "unpack first, then analyze" in [[re-anti-analysis]]
- **javap reports unsupported class file version**: symptom — `javap` reports something like `major version 65` as unsupported; cause — the class file version is higher than the local JDK tool version; fix — convert major−44 to the target Java version and install that JDK or a newer one; to only read the version and constant pool, look at the header fields by hand with `xxd` first. Do not wait on the tool
- **A Multi-Release jar is analyzed at the wrong layer**: symptom — after `unzip -o` the top-level classes are decompiled, and the logic does not match runtime behavior (version branches disappear); cause — multi-version classes are in `META-INF/versions/N/`, and different JDKs load different layers; fix — after unpack, check `META-INF/versions/` and analyze the layer for the target JDK; the difference between the top level and the versions layer is the version-conditional logic
- **Lambda decompilation shows synthetic methods**: symptom — CFR/JD-GUI output has `lambda$xxx$n` methods or `invokedynamic` calls; cause — the lambda body compiles to a synthetic private method plus an invokedynamic bootstrap; fix — the BootstrapMethods table from `javap -v -p` locates the lambda-body method (captured variables are parameters of the synthetic method). Analyze it as an ordinary method
