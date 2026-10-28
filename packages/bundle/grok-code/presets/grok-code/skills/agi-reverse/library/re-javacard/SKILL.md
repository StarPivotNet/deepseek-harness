---
name: re-javacard
description: >
  Java Card / SIM applet reversing: CAP file component parsing (the spec's 12 components), CAP bytecode (a Java subset) recovery, AID and install parameters, process(APDU) dispatch.
  Triggers: Java Card, javacard, `CAP 文件`, `SIM 卡`, USIM, applet, AID, `银行卡`, JCVM.
capabilities: [bytecode-parser]
---

# Java Card / SIM applet reversing (CAP component parsing and bytecode recovery)

## When to use / when not to use

- Use: you have a Java Card applet CAP file (Converted Applet Package, .cap) — from an EEPROM dump, a firmware image, a document pack, or a card read
- Use: smart-card app analysis such as SIM / USIM / a bank card — package AID and applet AID, install parameters, install() initialization, process(APDU) dispatch recovery
- Use: disassembly of CAP bytecode (a Java subset + card extension instructions), method-body recovery, rebuilding the CLA/INS command table
- Do not use: APDU protocol interaction and capture, the ISO14443 link, MIFARE/DESFire card-family weaknesses (go to [[re-iot-proto]])
- Do not use: general .class/.jar Java bytecode reversing (go to [[re-java]]); a raw .class embedded in the CAP can be cross-checked with javap, but it does not replace this skill
- Do not use: the CAP is not in hand yet — first do reader physical interaction ([[re-hardware-io]] / [[re-iot-proto]] APDU) or firmware extraction ([[re-firmware]] / [[re-fw-extract]]), and come back once you have the file
- Do not use: you only need to read/write card data or capture APDU traffic ([[re-iot-proto]])

## Tool setup

Verify every tool before use. Static parsing may skip the sandbox; interaction with a real card and a reader confirms the authorization boundary first (card ownership and the purpose of the analysis). Dynamic execution defaults to a sandbox (top principle in [[re-analyze/platform-tips]]).

### CAP file parsing (an open-source parser or a script you write)

- **capfile** (a Java library, martinpaljak, CAP parse/verify, the ant-javacard ecosystem): `git clone https://github.com/martinpaljak/ant-javacard` (capfile has been merged into it); build it as a library reference. Verify: parsing a sample CAP raises no exception
- **caprunner** (Python, CAP parse + a bytecode executor, benallard): `git clone https://github.com/benallard/caprunner` + `git clone https://github.com/benallard/pythoncard` (put the pythoncard/pythoncardx directories next to caprunner); verify: `python3 readcap.py <file.cap>` can list component info
- **pysim's javacard.py** (osmocom, a production-grade SIM toolchain component): `git clone https://github.com/osmocom/pysim`; the CapFile class in `pySim/javacard.py` — checks Header magic 0xDECAFFED, reads the package AID/applet AID, and assembles the install-order load file; verify: `python3 -c "import sys; sys.path.insert(0,'pysim'); from pySim.javacard import CapFile; print(CapFile('x.cap').get_loadfile_aid())"`
- **GlobalPlatformPro** (gp, Java, interact with the card / install an app / list app AIDs): download the JAR from GitHub releases (Java 11+): `java -jar gp.jar --version`; `java -jar gp.jar --list` (lists apps on the card and their AIDs)
- Points for a parser you write: a CAP is a ZIP, components are stored as files, and parsing each file as "tag + size + info" is enough. It does not depend on a single offset table (structure is in procedure steps 2-5)

### javap — cross-check a raw .class (bundled with the JDK)

- Linux: `apt install default-jdk` / `dnf install java-17-openjdk` / `pacman -S jdk-openjdk`; macOS: `brew install openjdk`; Windows: the official JDK installer
- Verify: `javap -version`
- Use: a CAP JAR often carries compile-time equivalent products `APPLET-INF/classes/**/*.class` (packed by the SDK converter, visible with `unzip -l`). `unzip -p x.cap APPLET-INF/classes/com/example/Foo.class > Foo.class && javap -c -p Foo.class` gets the Java view, cross-checked against the CAP bytecode (watch opcode numbers vs instruction names; see pitfall 3)

### Emulated execution (verify without a card, optional)

- **JCardSim** (a Java emulator; it loads compiled classes, not CAP bytecode): download the JAR from GitHub releases; after pairing it with the vsmartcard virtual reader it is exposed as a PC/SC reader, and pyscard sends APDUs to verify behavior
  - Linux: `git clone https://github.com/frankmorgner/vsmartcard`, build virtualsmartcard, then `systemctl restart pcscd`; Windows: a BixVReader-class virtual reader
- **pyscard** (Python PC/SC interaction): `pip install pyscard` (Linux depends on `apt install libpcsclite-dev pcsclite pcscd` / `dnf install pcsc-lite-devel pcsc-lite` / `pacman -S pcsclite ccid`; macOS: `brew install pcsc-lite`); verify: `python3 -c "from smartcard.System import readers; print(readers())"`
- Direct execution of CAP bytecode uses caprunner's runcap.py (no hardware required)

### Decompiler and reader (generalized)

- **Ghidra / IDA have no native CAP loader or processor module** — CAP bytecode needs scripted parsing: Ghidra Python / IDA Python imports it by this skill's component structure, or a parser exports disassembly first and it is cross-checked by hand
- **Readers (generalized buying)**: two classes, contact ISO7816 (PC/SC CCID driver-free class) and contactless ISO14443 (NFC); buying watches: PC/SC driver completeness (CCID driver-free vs a vendor-private driver), SIM socket form and adapter (full-size / micro-SIM and similar), T=0/T=1 protocol support, power stability
- **Authorization boundary**: reading a card, extracting, and writing a card all require confirmed card ownership and authorization for the analysis purpose; read-only contact with a third-party card is also a scenario that needs authorization (top principle in [[re-analyze/platform-tips]])

## Procedure

Run in order. Archive each step's products (parser script, disassembly text, AID/INS list) and the sample sha256. Dynamic execution defaults to a sandbox.

1. **CAP source and file identification**:
   - Sources: an EEPROM dump ([[re-hardware-io]] flash readout), firmware-image extraction ([[re-firmware]] / [[re-fw-extract]]), a document pack / test sample, an authorized in-scope card read
   - Identification: `file x.cap` (a ZIP archive) → `unzip -l x.cap` — `META-INF/MANIFEST.MF` plus `<package path>/javacard/*.cap` component files means it is a CAP; APPLET-INF/classes means it carries raw class files (step 4 can cross-check with javap); if there are no javacard/ component files it may be a wrong suffix, an encrypted payload, or another format (see pitfall 4)
   - Archive `sha256sum x.cap`; write down the format version in the Header

2. **Component enumeration and Header check**:
   - Component list (the Java Card spec, tags 1-12; required core + optional):

     | tag | Component | Contents and role |
     |-----|------|-----------|
     | 1 | Header | magic, format version, flags, package AID, package name |
     | 2 | Directory | a size table of each component (a missing optional component is recorded as 0), static-field size, import/applet counts |
     | 3 | Applet (optional) | applet count, each applet AID + the install() method offset |
     | 4 | Import | the external package AID list (locates constant-pool external references) |
     | 5 | ConstantPool | token → class/field/method reference (6 entry classes, 4 bytes each) |
     | 6 | Class | class/interface definitions: flags, superclass reference, virtual method table, implemented interfaces |
     | 7 | Method | method bodies: exception-handler table + method header (max_stack/nargs/max_locals) + CAP bytecode |
     | 8 | StaticField | the static-field image area and array-init data |
     | 9 | ReferenceLocation | the list of positions of constant-pool token operands in the bytecode (used to patch at install time) |
     | 10 | Export (optional) | externally visible class/method/field symbols (for cross-package linking) |
     | 11 | Descriptor | the signature pool: method names, descriptors, method_offset and bytecode_count |
     | 12 | Debug (optional) | a debug-info string table (includes method names), for offline verification/recovery |

   - The "nine components" list that circulates online (Header/Directory/Import/ConstantPool/Class/Method/Descriptor/Export/Applet) is a simplification. It omits StaticField and ReferenceLocation, which bytecode linking requires — parsing follows this table
   - Header byte layout: `01 | size(u2) | magic=0xDECAFFED | fmt_minor | fmt_major | flags | pkg_minor | pkg_major | aid_len | package AID | [package name]`; flags: 0x01=ACC_INT, 0x02=ACC_EXPORT, 0x04=ACC_APPLET; a magic that is not 0xDECAFFED is not a legal CAP (or it was encrypted/truncated; see pitfall 4)

3. **Directory-driven component consistency check**:
   - Directory component: a u2 array of component sizes in tag order (Header/Directory/Applet/Import/ConstantPool/Class/Method/StaticField/ReferenceLocation/Export/Descriptor/Debug) + static-field image_size/array_init + import_count + applet_count
   - Check item by item against the component files inside the JAR: existence, tag order, and the size field agree; when an optional component (Applet/Export/Descriptor/Debug) is missing, the directory records 0
   - The install-order load file can be assembled (Header→Directory→Import→Applet→Class→Method→StaticField→Export→ConstantPool→RefLocation→Descriptor) and cross-checked with the install sequence in the firmware/reader (measured together with [[re-iot-proto]])

4. **Recover method bodies in the Method component**:
   - Method component layout: `07 | size(u2) | handler_count(u1) | exception-handler table (8 bytes each: start_offset u2, active_length bitfield u2, handler_offset u2, catch_type_index u2) | method-body sequence (method header + bytecode)`
   - Method header: 2 bytes (the high 4 bits of the first byte are flags — 0x8=ACC_EXTENDED, 0x4=ACC_ABSTRACT, the low 4 bits are max_stack; the high 4 bits of the second byte are nargs, the low 4 bits are max_locals) or an extended 4 bytes; the method's offset inside the component and the bytecode length come from the Descriptor component (method_offset + bytecode_count)
   - The applet's install() entry offset is in the Applet component (install_method_offset)
   - Disassemble by the CAP instruction set (the opcode table in pitfall 3): operands are mostly 2-byte constant-pool tokens, and a method ends with a return-family instruction / athrow
   - When a Debug component exists, its string table restores method names directly; otherwise method names are inferred from the Descriptor signature pool + call-site semantics (framework methods are cross-checked with the SDK export file)

5. **Resolve Import / constant-pool / Export cross-component references**:
   - ConstantPool entries (4 bytes each: tag u1 + a 3-byte reference): 1=classref, 2=instance fieldref, 3=virtual methodref, 4=super methodref, 5=static fieldref, 6=static methodref; the high bit 0x80 of the reference's first byte distinguishes internal (an in-class offset/token) from external (package_token + class_token + token)
   - Call instructions correspond to entry types: invokevirtual → tag 3 (a virtual method), invokespecial calling a superclass method → tag 4 (super methodref), invokespecial/invokestatic calling a constructor and a private method → tag 6 (a static method)
   - Import component: the external package AID list. The order is the package_token number of constant-pool external references
   - Positions of token operands in the bytecode are marked by the ReferenceLocation component (an incremental offset table); the parser script locates reference points from it and replaces them with constant-pool entries
   - External symbol-name resolution: this package's exports are in the Export component; a framework package (javacard.framework) is cross-checked against the SDK's .exp export file — javacard.framework is a package almost every SIM/bank-card applet imports. Its constants (OFFSET_CLA=0, OFFSET_INS=1, OFFSET_P1=2, OFFSET_P2=3, OFFSET_LC=4; SW1/SW2, 0x9000=success) are the anchors for recovering dispatch logic

6. **Recover the applet entry and process(APDU) dispatch**:
   - Lifecycle: install(APDU) (located by the Applet component's install_method_offset) → register() → after the app is selected, every APDU calls process(APDU); locate process: find the process descriptor in the Descriptor method table, or enter from the install call chain
   - Dispatch recovery: the typical shape — invokevirtual APDU.getBuffer() (an external classref virtual-method call) → baload + sconst_*/bipush/sspush takes CLA/INS → an icmp/if_* compare chain or a switch-family instruction (itableswitch/slookupswitch and similar) branch table → one handling branch per INS → the ISOException.throwIt(SW1SW2) exception path
   - Output an INS → handling-logic map: each branch entry, P1/P2/Lc/data parsing, the returned SW; cross-check it both ways with APDU captures/measurements from [[re-iot-proto]]
   - Install parameters: the install method reads install-APDU data (init parameters / cardholder data) and writes static fields or the filesystem, which affects later behavior branches — follow the parameter write points from install. Do not look only at process (see pitfall 6)

## Cross-domain

- [[re-iot-proto]]: APDU protocol interaction / capture / card-family identification — the CLA/INS dispatch table recovered by this skill and its measured APDU behavior verify each other
- [[re-firmware]] / [[re-fw-extract]]: a CAP extracted from a firmware image / OTA package
- [[re-hardware-io]]: EEPROM/flash dump acquisition, JTAG debug, physical reader access
- [[re-java]]: the general JVM bytecode reversing base (javap cross-check of a .class embedded in the CAP)
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: identifying crypto algorithms inside an applet, key extraction, and data decryption (common in smart-card apps)
- [[re-variant]]: compare several versions of the same applet's CAP and locate the differences (upgrade/patch analysis)
- [[re-patching]]: after CAP bytecode is changed, repack and reinstall (needs the matching install/signature authorization)
- [[re-sandbox]]: a mandatory prerequisite for every dynamic execution / card interaction (top principle in [[re-analyze/platform-tips]])
- [[re-triage]]: the survey prerequisite (file type / entropy / hash / architecture identification)

## Common pitfalls

- **Using the wrong component structure (treating "nine components" as the spec)**: symptom — parsing by the nine-component list that circulates misses StaticField/ReferenceLocation, bytecode references will not resolve, and static fields are shifted; cause — the simplified list omitted the two components that are directly related to bytecode linking; fix — follow the spec's 12-component table (see procedure step 2), and double-check boundaries with the Directory size table + each component file's own tag/size
- **Confusing JAR structure with a concatenated format**: symptom — components are sliced continuously from the file head by a single offset table, and everything is shifted; cause — a CAP is a ZIP (components are stored as separate files, and it may also carry META-INF, APPLET-INF/classes, and similar files); only the old format (before 2.2) or a nonstandard conversion product is component-concatenated; fix — `unzip -l` first and confirm the structure. Component boundaries follow each component file's own tag+size
- **Disassembling CAP bytecode as JVM bytecode**: symptom — the opcode table does not line up, instruction lengths are shifted, and the disassembly is garbage; cause — the CAP instruction set is numbered independently: return=0x7A (JVM 0xB1), new=0x8F (0xBB), invokevirtual/invokespecial/invokestatic/invokeinterface=0x8B-0x8E (JVM 0xB6-0xB9, and the operand is a 2-byte constant-pool token rather than a symbolic reference), aload_0=0x18; there are also typed variants JVM does not have (getfield/putfield `*_a`/`*_b`/`*_s`/`*_i` and `*_this`/`*_w`, short-only instructions such as sadd/ssub/smul, icmp/if_scmp*, iipush/sspush constant loads); there is no ldc family (constants go through sconst_*/bipush/sspush/iipush + a constant-pool token), no multianewarray (one-dimensional arrays only), no monitorenter/monitorexit (single-threaded), no invokedynamic, and no long/double arithmetic instructions (Classic 2.2.2; from 3.0.5 the language subset supports long); "no invokevirtual" is a false rumor — the four call-instruction classes are all present, and a framework-class instance method (such as APDU.getBuffer) goes through invokevirtual; fix — use a CAP-specific disassembly (caprunner's instruction table / a script you write from the table above). When cross-checking the original .class with javap, note that same-named instructions have different numbers
- **An Import external reference is a broken link**: symptom — a call-site token will not resolve to a target method name, and the logic breaks at a framework call; cause — the applet's dependencies are in external packages (a framework package / another CAP), and this CAP only contains reference tokens; fix — the Import component lists external package AIDs, and external symbols are resolved through the Export component or the SDK .exp file; javacard.framework method names and constants are cross-checked against the SDK export file
- **A card dump is ciphertext or a fragment**: symptom — the "CAP" magic is wrong or components will not unpack, and the content entropy is high; cause — the dump was encrypted by the card OS (a GlobalPlatform domain key / secure-messaging wrapper), or a truncated / cross-region extraction is incomplete; fix — judge plaintext vs an encrypted payload with entropy and magic first. Encryption follows the [[re-crypto-id]] / [[re-crypto-keys]] idea; check component integrity with the Directory size table, and check the same way when extracting from firmware
- **Recovering only process and ignoring install and the AID**: symptom — the dispatch table was recovered but behavior does not match, or several apps in the same package are confused with each other; cause — install()'s install parameters (init data / cardholder data) are written to static fields or the filesystem and affect later branches; the Applet component can contain several applet AIDs (several instances in one package); fix — follow parameter write points from install, and distinguish instances by AID; AID format: a 5-byte RID + a 0-11 byte PIX (total length 5-16, ISO/IEC 7816-5; a RID starting with 0xA0 is an internationally registered RID, such as the common SIM/USIM application RID A000000087, and the PIX is application-defined)
- **Card read/write goes past authorization**: symptom — reading and writing a real card for analysis without confirmed ownership and purpose; fix — contact with a third-party card needs authorization by default. Prefer lab samples and documentation (top principle in [[re-analyze/platform-tips]])
