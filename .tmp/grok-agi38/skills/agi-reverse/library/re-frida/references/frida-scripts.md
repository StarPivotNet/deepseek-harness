# Frida script templates

Pick a template by scene and replace the placeholders (`<pkg>` package name, `<cls>` class name, `<method>` method name). Shared skeleton: **save the original reference first, then call the original method with `this`**; output both formats (printable ASCII + hex); wrap in `try/catch`; execute entirely inside a sandbox. The general countermeasure methodology is in [[re-analyze/anti-dynamic-workflow]].

## Shared skeleton

```javascript
Java.perform(function () {
  try {
    var Cls = Java.use('<cls>');
    var orig = Cls.<method>.overloads[0].implementation;
    Cls.<method>.overloads[0].implementation = function () {
      var ret = orig.call(this, ...arguments);
      console.log(JSON.stringify({ method: '<cls>.<method>', ret: String(ret) }));
      return ret;
    };
  } catch (e) { console.log(JSON.stringify({ error: String(e) })); }
});
```

## TLS key log (SSLKEYLOGFILE route)

Hook BoringSSL's `SSL_CTX_new`; onLeave, inject a keylog callback into each new SSL_CTX — the output can be saved directly as SSLKEYLOGFILE and fed to Wireshark to decrypt HTTPS plaintext:

```javascript
var ssl = Process.findModuleByName('libssl.so');
if (!ssl) { console.log(JSON.stringify({ error: 'libssl not found' })); }
else {
  var keyLogCallback = new NativeCallback(function (sslPtr, line) {
    console.log(new NativePointer(line).readCString());
  }, 'void', ['pointer', 'pointer']);
  var setKeylog = new NativeFunction(
    ssl.getExportByName('SSL_CTX_set_keylog_callback'), 'void', ['pointer', 'pointer']);
  Interceptor.attach(ssl.getExportByName('SSL_CTX_new'), {
    onLeave: function (retval) { setKeylog(new NativePointer(retval), keyLogCallback); }
  });
}
// 局限：仅 Android 系统自带 BoringSSL；App 内置/静态链接的 TLS 栈不覆盖
```

## SSL pinning bypass (TrustManager trust-all + CertificatePinner)

At `SSLContext.init`, replace with a trust-all `X509TrustManager` (trust any certificate chain); OkHttp's `CertificatePinner` is an independent check layer and is emptied separately:

```javascript
Java.perform(function () {
  try {
    var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
    var TrustAll = Java.registerClass({
      name: 'com.bypass.TrustAll',
      implements: [X509TrustManager],
      methods: { checkClientTrusted: function () {}, checkServerTrusted: function () {},
                 getAcceptedIssuers: function () { return []; } }
    });
    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    SSLContext.init.implementation = function (km, tm, sr) {
      console.log(JSON.stringify({ event: 'ssl_trust_all', keystore: String(km), secureRandom: String(sr) }));
      this.init(km, [TrustAll.$new()], sr);
    };
    var Pinner = Java.use('okhttp3.CertificatePinner');
    Pinner.check.overload('java.lang.String', 'java.util.List').implementation = function (host, certs) {
      console.log(JSON.stringify({ event: 'cert_pinner_bypass', host: host }));
    };
  } catch (e) { console.log(JSON.stringify({ error: String(e) })); }
});
// 局限：仅覆盖 Java 层（OkHttp / HttpsURLConnection 等）校验；原生层直调 BoringSSL / libssl 的固定校验不走此路径
```

## In-memory DEX dump (capture at the class-load point)

Hook `art::ClassLinker::DefineClass` (libart.so mangled-symbol signature match); at the class-load point, take the DexFile from the arguments and read `begin_`/`size_`; after checking the dex magic, dump the whole segment to disk:

```javascript
var libart = Process.findModuleByName('libart.so');
if (libart) {
  var sym = libart.enumerateSymbolsSync().find(s =>
    s.name.includes('ClassLinker') && s.name.includes('DefineClass') && s.name.includes('DexFile'));
  if (sym) Interceptor.attach(sym.address, {
    onEnter: function (args) {
      // 参数位次与字段偏移为版本相关经验值（Android 9：DexFile 引用在第 6 参；begin_=+8、size_=+16）
      var dexFile = args[5];
      if (dexFile.isNull()) return;
      var begin = dexFile.add(Process.pointerSize).readPointer();
      var size = dexFile.add(Process.pointerSize * 2).readUInt();
      if (size < 4 || begin.isNull() || begin.readCString(3) !== 'dex') return;
      // 以 base 去重后 readByteArray(size) 写盘到 files 目录
      console.log(JSON.stringify({ event: 'dex', base: begin.toString(), size: size }));
    }
  });
  // dlopen / android_dlopen_ext onLeave 再挂一次，兜底 libart 晚加载设备
}
```

## In-memory SO dump (runtime decrypt/packing)

```javascript
function dumpSo(name) {
  var m = Process.getModuleByName(name);
  if (!m) return;
  Memory.protect(m.base, m.size, 'rwx');
  var buf = m.base.readByteArray(m.size);
  var out = new File('/data/local/tmp/' + name + '_' + m.base + '.so', 'wb');
  out.write(buf); out.close();
  console.log(JSON.stringify({ event: 'so_dump', name: name, base: m.base.toString(), size: m.size }));
}
```

## Recover JNI dynamic registration (RegisterNatives + convergence-point dual hook)

libart.so symbol-signature matching (uniformly exclude CheckJNI); `JNI::RegisterNatives` builds an fnPtr→method-name map; `ArtMethod::RegisterNative` is the registration convergence point and directly yields the native address and the offset inside the SO:

```javascript
var libart = Process.findModuleByName('libart.so');
var map = {};
var parseTable = function (methods, count) {
  var rows = [];
  for (var i = 0; i < count.toInt32(); i++) {
    var p = methods.add(i * Process.pointerSize * 3);   // 每项 3 指针：name/sig/fnPtr
    rows.push({ name: p.readPointer().readCString(), sig: p.add(Process.pointerSize).readPointer().readCString(),
                fn: p.add(Process.pointerSize * 2).readPointer().toString() });
  }
  return rows;
};
if (libart) libart.enumerateSymbolsSync().forEach(function (s) {
  if (s.name.includes('JNI') && s.name.includes('RegisterNatives') && !s.name.includes('CheckJNI')) {
    Interceptor.attach(s.address, {
      onEnter: function (args) {
        var cls = Java.vm.tryGetEnv().getClassName(args[1]);
        parseTable(args[2], args[3]).forEach(function (r) { map[r.fn] = cls + '.' + r.name + r.sig; });
      }
    });
  }
  if (s.name.includes('ArtMethod') && s.name.includes('RegisterNative') && !s.name.includes('Callback')) {
    Interceptor.attach(s.address, {
      onEnter: function (args) {
        var fnPtr = args[1], mod = Process.findModuleByAddress(fnPtr);
        if (mod) console.log(JSON.stringify({ event: 'registerNative', method: map[fnPtr.toString()] || '(unresolved)',
          so: mod.name, off: '0x' + fnPtr.sub(mod.base).toString(16) }));
      }
    });
  }
});
```

## Java crypto-algorithm intercept (every overload)

```javascript
Java.perform(function () {
  var hex = function (b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + (b[i] & 0xff).toString(16)).slice(-2); return s; };
  var SKS = Java.use('javax.crypto.spec.SecretKeySpec');
  SKS.$init.overload('[B', 'java.lang.String').implementation = function (key, algo) {
    console.log(JSON.stringify({ event: 'secret_key', algo: algo, keyHex: hex(key) }));
    this.$init(key, algo);
  };
  var Cipher = Java.use('javax.crypto.Cipher');
  ['(int,java.security.Key)', '(int,java.security.Certificate)',
   '(int,java.security.Key,java.security.spec.AlgorithmParameterSpec)',
   '(int,java.security.Key,java.security.SecureRandom)',
   '(int,java.security.Certificate,java.security.SecureRandom)',
   '(int,java.security.Key,java.security.AlgorithmParameters)',
   '(int,java.security.Key,java.security.AlgorithmParameters,java.security.SecureRandom)',
   '(int,java.security.Key,java.security.spec.AlgorithmParameterSpec,java.security.SecureRandom)'
  ].forEach(function (sig) {
    try {
      Cipher.init.overload.apply(Cipher, sig.split(',').map(function (s) { return s.trim(); })).implementation = function (mode, key) {
        var enc = key.getEncoded ? key.getEncoded() : null;
        console.log(JSON.stringify({ event: 'cipher_init', mode: mode, keyHex: enc ? hex(enc) : null }));
        this.init.apply(this, arguments);
      };
    } catch (e) {}
  });
  // doFinal/update 输入输出双向记录；IvParameterSpec.$init 打 IV；DESKeySpec/RSAPublicKeySpec/KeyPairGenerator 同模式
});
```

## Mutual-TLS client-certificate export (keystore dump)

Hook `KeyStore$PrivateKeyEntry.getPrivateKey` / `getCertificateChain` (the required point when mutual auth reads the client certificate), and export a p12 through BouncyCastle PKCS12:

```javascript
Java.perform(function () {
  var PKE = Java.use('java.security.KeyStore$PrivateKeyEntry');
  PKE.getCertificateChain.implementation = function () {
    var chain = this.getCertificateChain();
    try {
      var ks = Java.use('java.security.KeyStore').getInstance('PKCS12', 'BC');
      ks.load(null, null);
      ks.setKeyEntry('client', this.getPrivateKey(), 'hooker'.toCharArray(), chain);
      var f = Java.use('java.io.FileOutputStream').$new('/data/local/tmp/client.p12');
      ks.store(f, 'hooker'.toCharArray()); f.close();
      console.log(JSON.stringify({ event: 'keystore_dump', path: '/data/local/tmp/client.p12' }));
    } catch (e) {}
    return chain;
  };
});
```

## Root / instrumentation detection bypass (detection-point table)

| Detection point | Hook target | Technique |
|---|---|---|
| Package name | `ApplicationPackageManager.getPackageInfo` | a hit on the root/xposed package-name list → replace with a fake package name |
| File | `java.io.File.exists` | a hit on a path such as su/busybox → false |
| Command | every `Runtime.exec` overload / `ProcessBuilder.start` | "su" → a command that does not exist; getprop/mount → "grep" |
| Property | `SystemProperties.get` | ro.debuggable="0", ro.secure="1", ro.kernel.qemu="0" |
| test-keys | `String.contains` / `BufferedReader.readLine` | "test-keys" → false / rewrite "release-keys" |
| Native file | libc `fopen` | a basename hit → rewrite the path to /notexists |
| Native command | libc `system` | a command hit → rewrite a fake command |
| Raw syscall | scan for the svc instruction signature (arm64: `01 00 00 D4`, SYS_OPENAT=56, there is no open syscall) | catch file access that bypasses libc (on arm64 the openat path argument is in x1; x0 is dirfd) |

Do not preinstall a whole bypass kit: run the original target as a baseline → infer protection points from crash signatures (the comparison table is in [[re-analyze/anti-dynamic-workflow]]) → hook the specific point; 3-5 layers of iteration is normal.

## Lessons internalized

- A return value can be changed only in **onLeave with `retval.replace()`**; after saving original, the call must carry the original `this`
- `Java.use` caches a class; several `.implementation` assignments **overwrite silently** — merge related hooks into one
- Symbol location uniformly uses `enumerateSymbolsSync` + mangled-name signature matching, excluding CheckJNI / `__va_list`
- Argument indexes and field offsets are version-dependent experience values (across versions, verify against the target symbols)
- A client hook cannot forge a **server-side** attestation conclusion — for a server-side check, write only "cannot bypass"

## Usage notes

- Execute entirely inside a sandbox (see the [[re-analyze/platform-tips]] highest principle); `--pause` covers early code checks
- Output JSON for the [[re-analyze/analysis-contract]] data contract to consume (evidence archive)
