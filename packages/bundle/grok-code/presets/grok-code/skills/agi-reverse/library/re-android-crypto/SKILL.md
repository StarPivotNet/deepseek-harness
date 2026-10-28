---
name: re-android-crypto
type: atomic
description: >
  Android crypto-system audit (crypto audit): AndroidKeyStore key-system analysis (alias/algorithm/purpose/hardware backing),
  Cipher/KeyInfo audit, encryption-call-site hooks (Frida intercepts key aliases and purposes).
  Triggers: Keystore, AndroidKeyStore, Cipher, KeyInfo, StrongBox, `加密审计`, crypto hook, `密钥别名`.
capabilities: [crypto-identification, key-extraction]
---

# Android crypto-system audit (crypto audit)

## Task classifier (intent → path)

| User purpose | Path |
|---|---|
| The key comes from AndroidKeyStore / a hardware-backed key | → **Keystore audit** (step 1) |
| Locate encryption call sites / intercept ciphertext and plaintext | → **crypto hook** (step 2) |
| Analyze a third-party crypto library (BoringSSL / OpenSSL / Tink / libsodium and similar) | → **library analysis** (step 3) |

## When to use / when not to use

- Use: Android app crypto-system audit — key system (Keystore), encrypt/decrypt call chain, library-choice recovery
- Use: a hardware-backed key whose `getEncoded()` is unavailable (audit it; do not extract key bytes)
- Use: when intercepting crypto you must record the key alias and purpose (do not record key bytes — security boundary)
- Do not use: JNI/so native-logic reversing (go to [[re-android-native]]); generic crypto-algorithm identification (go to [[re-crypto-id]]); generic key extraction ([[re-crypto-keys]], except Keystore hardware keys)
- Do not use: a non-Android platform (use the generic crypto-domain branch of [[re-protocol]])
- Boundary: this skill covers the full Android crypto-audit spectrum — Keystore/Cipher/KeyInfo/hook are the start, and third-party library analysis (BoringSSL/OpenSSL/Tink/libsodium and similar) belongs here (step 3), not in re-android-native

## Tool preparation

Verify every tool before use. Dynamic hooks default to the sandbox ([[re-analyze/platform-tips]] supreme rule); static audit can skip the sandbox.

### frida ([[re-frida]]) — primary crypto hook

- Install and verify: see [[re-frida]] tool preparation; script templates: [[re-frida/frida-scripts]]
- Verify: `frida --version`

### python3 / jadx — statically locate encryption call sites

- python3 install and verify: see [[re-python]] tool preparation
- jadx install and verify: see [[re-apk]] tool preparation

### Device-side commands ([[re-apk]] adb section)

- `adb shell` for the app runtime (KeyStore enumeration must run inside the app process)

## Procedure

1. **Keystore audit** (AndroidKeyStore key system):
   ```java
   // Enumerate inside the app process (Frida inject, or locate the call site in a jadx decompile)
   KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
   ks.load(null);
   java.util.Enumeration<String> aliases = ks.aliases();
   ```
   - **Walk**: `aliases()` enumerates every entry (key alias = the in-app reference key)
   - **Entry properties**: algorithm (AES/RSA/EC), purpose (encrypt/decrypt/sign/verify), origin — `KeyInfo.getSecurityLevel()` (API 31+, returns the three levels SOFTWARE / TRUSTED_ENVIRONMENT(TEE) / STRONGBOX); API 23–30 has only `isInsideSecureHardware()` (a boolean; TEE and StrongBox are both true and cannot be split)
   - **Biometric binding**: a key with `setUserAuthenticationRequired` is unavailable when authentication fails (bypass and detection: [[re-analyze/anti-dynamic-workflow]])
   - Output: an alias → algorithm/purpose/hardware-backing inventory (do not record key bytes)

2. **crypto hook** (intercept encryption call sites):
   ```js
   // frida: intercept encryption call sites; record algorithm/mode/key alias
   // Alias source: a Key object does not carry its alias (KeyStore has no getKeyAlias); record it at getKey
   const KeyStore = Java.use('java.security.KeyStore');
   KeyStore.getKey.overload('java.lang.String', '[C').implementation = function (alias, password) {
     console.log('KeyStore.getKey', alias);
     return this.getKey(alias, password);
   };
   const Cipher = Java.use('javax.crypto.Cipher');
   Cipher.init.overload('int', 'java.security.Key', 'java.security.spec.AlgorithmParameterSpec').implementation =
     function (opmode, key, params) {
       console.log('Cipher.init', opmode, key.getClass().getName(), params);  // matching alias: see the getKey output above
       return this.init(opmode, key, params);
     };
   // Another way back to the alias: SecretKeyFactory.getInstance(key.getAlgorithm(), 'AndroidKeyStore')
   //   .getKeySpec(key, KeyInfo.class) → KeyInfo.getKeystoreAlias()
   ```
   - Hook targets: the `Cipher.init` family (algorithm/mode/IV source), `KeyStore.getKey` / `getEntry` (alias and purpose), `Signature`/`Mac` initialization (verify/MAC chain)
   - Record: alias and purpose; **do not record key bytes** (security boundary; see pitfall 2)
   - Static location aid: search jadx for `AndroidKeyStore` / `KeyStore.getInstance` / `Cipher.getInstance` call sites and cross-check the hook results

3. **Third-party crypto library analysis** (BoringSSL / OpenSSL / Tink / libsodium and similar):
   - Identify: import table/symbols (`SSL_*`/`EVP_*`/`crypto_*`/`sodium_*` prefixes) + jadx dependency declarations
   - Locate call sites: xrefs of the library API (static) or hooks on library exports (dynamic)
   - Join with [[re-android-native]]: when the library exists as a .so → its JNI/internal logic goes to [[re-android-native]]; this skill owns the crypto semantics (algorithm / key source / purpose)

4. **Output and evidence retention**: a key-system diagram (alias/algorithm/purpose/backing source) + an encryption call-site list + hook scripts, archived by sha256 for [[re-ioc]]

## Cross-domain joins

- [[re-android-native]]: JNI/so native-logic reversing (takes the internal logic of .so libraries from this skill; Keystore audit is handed out from there)
- [[re-frida]]: hook execution layer ([[re-frida/frida-scripts]] templates)
- [[re-crypto-id]] / [[re-crypto-keys]]: algorithm identification and generic key extraction (except Keystore hardware keys — audit those here)
- [[re-apk]]: static location in the app (jadx call sites)
- [[re-mobile]]: mobile branch of the workflow (crypto-audit sub-path)

## Common pitfalls

- **Treating Keystore as ordinary key extraction**: symptom — `getEncoded()` cannot return key bytes and you misjudge "the key does not exist"; cause — an AndroidKeyStore hardware-backed key is not exportable; that is the design, not a missing key; fix — audit instead (step 1: alias/algorithm/purpose/backing); do not chase key bytes
- **Conflating TEE and StrongBox**: symptom — `isInsideSecureHardware` is true and you assert StrongBox; cause — Secure Hardware covers two levels, TEE and StrongBox, and that API is a boolean that cannot split them (`isStrongBoxBacked` is on `KeyGenParameterSpec` and only covers the generation side; `KeyInfo` does not have it); fix — on API 31+ use `KeyInfo.getSecurityLevel()` for the three levels SOFTWARE / TEE / STRONGBOX; on API 23–30 you cannot subdivide, so label the conclusion "secure hardware (TEE or StrongBox)"
- **Recording key bytes**: symptom — the hook script prints or writes Keystore key material; cause — treating an audit as extraction and crossing the security boundary; fix — record only alias and purpose; do not persist key bytes (see the step 2 note)
- **Treating library semantics as JNI-logic analysis**: symptom — a third-party crypto .so is dug into as native logic while the crypto semantics are ignored; cause — the domain is unclear; fix — crypto semantics of the library API (algorithm / key source / purpose) belong to this skill; only internal implementation details go to [[re-android-native]]
