---
name: re-plugin-dev
description: >
  Ghidra/IDA plugin development: from a script to an engineered plugin.
  Triggers: `插件开发`, `Ghidra插件`, `IDA插件`, `插件工程`
capabilities: [plugin-development]
---

# Ghidra / IDA plugin development

## When to use / when not to use

- Use: a repeated analysis step that should be frozen into a reusable tool (batch annotation, a decrypt loop, a custom-format parser, marking fields of a special protocol)
- Use: an interactive UI is needed (a menu / hotkey / panel), or a resident feature that "runs automatically when the project loads"
- Use: distribution inside a team, or the same analysis environment on several machines (a [[re-ghidra]] / [[re-ida]] script promoted to an engineered plugin)
- Do not use: a one-shot analysis task (a script that is used and discarded; the lightweight scripts in step 4 of [[re-ghidra]] / step 4 of [[re-ida]] are enough)
- Do not use: only rewriting existing logic in another language (confirm the scenario first; see step 1)

## Tool setup

Developing a static-analysis tool may skip the sandbox. The plugin runs inside the analysis-tool process and does not execute sample code (skip the sandbox; static-first in [[re-analyze/platform-tips]]).

### Ghidra — Java extensions / Python scripts

- Ghidra install (JDK 21+, required by Ghidra 11.3+) is in the tool setup of [[re-ghidra]]
- The GhidraDev Eclipse plugin (official, the GhidraDev directory inside the GitHub repo `NationalSecurityAgency/ghidra`): needs Eclipse (Linux `apt install eclipse` / Fedora `dnf install eclipse-platform` / Arch `pacman -S eclipse-java`; macOS `brew install --cask eclipse-java`; Windows, extract the official zip). It is not required — a pure Gradle build can also build an extension. GhidraDev versions pair with Eclipse versions; if it will not install, check the combination in the official release notes first
- Gradle (optional, for building a Java extension): Debian/Ubuntu `apt install gradle` / Fedora `dnf install gradle` / Arch `pacman -S gradle`; macOS `brew install gradle`; Windows `choco install gradle`; check `gradle --version`. The distro Gradle may be too old (building a Ghidra extension fails) — prefer the gradle wrapper shipped with a GhidraDev project (`./gradlew`)
- Check: the Ghidra GUI Script Manager lists scripts; `File > Install Extensions` shows the installed extension

### IDA — idapython plugins

- The IDA install is in the tool setup of [[re-ida]] (idapython is built in; no separate install)
- Plugin directory: Windows `%APPDATA%\Hex-Rays\IDA Pro\plugins\` (or `plugins\` under the IDA install directory); Linux/macOS `~/.idapro/plugins/`
- Check: after the plugin file is placed in the directory, the IDA startup log shows `Loading plugin ...`; `File > Script command` running `print(idaapi.IDA_SDK_VERSION)` prints the SDK version

## Steps

Run in order. Archive sha256 + path of every plugin product (source / build product / test sample and output) for the report and for reuse (the evidence-chain requirement of [[re-ioc]]).

1. **Identify the scenario (a batch script vs an interactive plugin)**:
   - One-shot or a simple repeat → a script (a GhidraScript from [[re-ghidra]] / an idapython script from [[re-ida]])
   - Resident, needs a UI, runs on load, or is distributed to several machines → a plugin (a Ghidra Java Extension / an IDA idapython plugin)
   - Four criteria; any one of them means it should be a plugin: ① an interactive UI is needed (menu / hotkey / dialog) ② it runs automatically after the project loads ③ the team distributes it to several machines (one version) ④ it must integrate with an external service or API
   - Record the decision: the scenario + the toolchain + who maintains it (state the maintenance cost of pitfall 4 up front)

2. **A Ghidra plugin skeleton (a Java extension / a program script)**:
   - A Python script (the lightest): an `@category` header comment, stored in the GhidraScripts directory, run from Script Manager (note the built-in Jython 2.7; see pitfall 2 and the pitfall in [[re-ghidra]])
   - A Java extension (engineered): GhidraDev `New > Ghidra Module Project`, choose Extension → implement a `Plugin` class (override `init`/`dispose`, and register menu actions in `init`) → Gradle `gradle buildExtension` produces a .zip → the target machine installs it with `File > Install Extensions`
   - Skeleton points: register the action with `ToolAction`/`AbstractAction` and hang it on a menu. A headless environment tests with `-postScript` (step 4 of [[re-ghidra]]). The boundary between a script and an extension is in the [[re-ghidra]] pitfall (script vs extension)
   - Extension layout: the built .zip contains extension.properties (it declares the Ghidra version range it applies to) — a version outside that range is refused. Name the version at distribution time and lock the range
   - Check: after install, trigger the action from the menu. Headless `analyzeHeadless ... -postScript MyPluginTest.java` runs and prints. After `gradle buildExtension` produces the zip, check the extension.properties version range before distributing

3. **An IDA plugin skeleton (idapython)**:
   ```python
   # myplugin.py —— 放到 plugins 目录，IDA 启动自动加载
   import idaapi
   class MyPlugin(idaapi.plugin_t):
       flags = idaapi.PLUGIN_KEEP
       comment = "demo plugin"
       help = ""
       wanted_name = "MyPlugin"
       wanted_hotkey = "Ctrl-Shift-M"
       def init(self):
           idaapi.register_action(idaapi.action_desc_t(
               "my:action", "My Action", MyAct(), "Ctrl-Shift-M"))
           return idaapi.PLUGIN_KEEP
       def run(self, arg):
           print("hello from MyPlugin")
   def PLUGIN_ENTRY():
       return MyPlugin()
   ```
   - Menu registration: `idaapi.register_action` + `idaapi.attach_action_to_menu("Edit/...", "my:action")`. Dialogs: `ida_kernwin.ask_str` / `ask_buttons` (note that in IDA 9.x some APIs moved to `ida_kernwin`; see pitfall 1)
   - Headless test: the headless executable name and the `-A -S` usage are in [[re-ida]] (`ida_auto` and the rest inside the script follow that write-up)
   - Check: the startup log has `Loading plugin ... MyPlugin`. The hotkey triggers the action and the output is normal

4. **Reuse an existing script (the scripts in [[re-ghidra]] / [[re-ida]])**:
   - Starting material: the batch-rename / decrypt-loop script in step 4 of [[re-ghidra]], and the batch-patch / annotation script in step 4 of [[re-ida]] — wrap "run it once by hand" as "trigger it from a menu"
   - Scenario examples: an automatic constant-table scan (the FindCrypt idea in [[re-crypto-id]]), a junk-instruction cleanup batch (the D-810 idea in [[re-deobfuscate]]), a custom PE/ELF format parser ([[re-format-pe]] / [[re-format-elf]])
   - Reuse discipline: logic that changes (a pattern string / a table / a threshold) lives in a config file or a plugin option. Do not hard-code it (that lowers the maintenance cost of pitfall 4)
   - Run the old script once and check the baseline output, then wrap it as a plugin — the output before and after the plugin ships must match (a regression test)

5. **Test and distribute**:
   - Test matrix: several tool versions (IDA/Ghidra; see pitfall 1), several sample architectures (x86/x64/ARM), samples with and without symbols. A modifying script runs first on a copy .i64/.idb or a separate project (the [[re-ida]] pitfall)
   - A read-only check comes first: run a read-only statistics script and confirm the expectation, then turn on modifying logic (the [[re-ida]] pitfall: a modifying script run directly on the original database is hard to roll back)
   - Distribution: a Ghidra extension .zip (`gradle buildExtension`; the README names the Ghidra version). An IDA plugin is a single .py or a package, and it names the IDA version and the Python version. Distributing a commercial IDA also has to pass plugin signing (pitfall 3)
   - Acceptance: a clean environment (a new project / a new IDB) installs from zero → triggers → the output matches the development environment. Only then is the release done

## Cross-domain handoff

- [[re-binary-core]]: this skill is the toolchain-extension stage of that gateway (an optional engineering step after decompilation, step 5 of the gateway workflow)
- [[re-ghidra]]: the starting point for Ghidra script / extension development (the script in workflow step 4 is plugin material)
- [[re-ida]]: the starting point for idapython plugin development (the script in workflow step 4 is plugin material; the headless-test write-up)
- [[re-deobfuscate]]: a plugin deobfuscation scenario (the D-810 idea)
- [[re-crypto-id]]: a plugin constant-table fingerprint scan (the FindCrypt idea)
- [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]: the target objects of a format-parser plugin
- [[re-binaryninja]]: a Binary Ninja script-API plugin (multi-tool plugin systems can borrow from each other)
- Cites the static-first principle in [[re-analyze/platform-tips]] (plugin development and testing skip the sandbox)

## Pitfalls

- **API version differences (a Ghidra/IDA upgrade breaks it)**: symptom — the plugin works on the old tool and, after an upgrade, fails to load, errors at runtime, or the menu disappears; cause — Ghidra 11.x has breaking API changes (for example a function-management class moved), and IDA 9.x reorganized some `idc`/`idaapi` functions into new modules (`ida_bytes` and the rest); fix — the plugin document locks the version (name the Ghidra/IDA versions that were tested). The test matrix covers old and new versions (step 5). After a tool upgrade, run a read-only script before changing code (the [[re-ida]] pitfall)
- **Java environment requirements**: symptom — a Ghidra extension build or run reports `UnsupportedClassVersionError`, or a Python script has a syntax error; cause — the JDK version does not match (Ghidra 11.3+ needs JDK 21; see [[re-ghidra]]), and the built-in interpreter is Jython 2.7 (Python 2 syntax; no f-strings, no walrus operator, and no pip imports); fix — `java -version` confirms 21+ and `JAVA_HOME` is correct. Write scripts in Python-2-compatible syntax. When modern Python is required, attach Python 3 through ghidra-bridge (the [[re-ghidra]] pitfall)
- **Plugin signing (commercial IDA)**: symptom — the plugin is in the plugins directory but commercial IDA does not load it (the startup log has no such plugin, and there is no error); cause — commercial IDA signature-checks third-party plugins, and an unsigned plugin is refused; fix — confirm the IDA edition (Freeware does not signature-check). During development, test with Freeware or headless mode. Formal distribution goes through the official Hex-Rays plugin-signing request. Write the "signing status" into the distribution document
- **Maintenance cost runs away**: symptom — three months after release the plugin no longer keeps up with upgrades or new sample shapes, nobody fixes it, and it slows analysis down; cause — a plugin is a long-term promise (API upgrades and scenario changes both have to be followed). A one-shot script does not have that cost; fix — step 1 decides whether it is worth it: simple logic or fast change → a script; stable and heavily reused → a plugin. Put changeable logic (a pattern string / a table / a threshold) in external config so the code surface stays small. Every release records the version and the matching tool version
- **A modifying plugin edits the database directly, and a bad edit cannot be undone**: symptom — a batch-rename or patch plugin finishes, the IDB annotations are a mess, and undo is hard; cause — the read-only check was skipped, and it was not run on a copy; fix — run a read-only statistics script first and confirm the expectation (the [[re-ida]] pitfall). Verify modifying logic on a copy .i64/.idb or a separate Ghidra project. Only after acceptance does it touch the real database
- **A Ghidra extension is refused because of its version range**: symptom — the extension is installed into Ghidra with no error, but it does not appear in the list; cause — the applicable version range declared in extension.properties does not match the current Ghidra, and the installer refused it; fix — unzip the zip and check the version range in extension.properties (the `ghidra.version` field). When GhidraDev generates the project, build it for the target version. The distribution document names the Ghidra versions that were tested
- **A headless or batch environment cannot depend on an interactive dialog**: symptom — under `analyzeHeadless` or IDA headless mode ([[re-ida]]) the plugin misbehaves or hangs; cause — batch mode has no UI event loop, so ask_* dialog APIs and menu-trigger logic are unavailable; fix — read interactive parameters (a path / a threshold / a pattern string) from command-line arguments or a config file. Inside the plugin, decide the branch from the runtime environment (whether this is a GUI session) first. A headless test script only checks pure computation
