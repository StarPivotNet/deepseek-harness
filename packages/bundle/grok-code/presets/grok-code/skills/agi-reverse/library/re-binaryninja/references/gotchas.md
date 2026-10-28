# Binary Ninja tool-specific pitfalls and boundaries

## Version differences

- **The Python API is tightly bound to the software version**: the API does not sync with the software automatically — after a reinstall or an upgrade you must rerun `install_api.py` in the install directory, or `import binaryninja` points at the old API and behavior does not match the docs (the most common failure source)
- **API changes between major versions**: 2.x → 3.x (type-API rewrite) → 4.x → 6.x each have breaking changes — a script dependency first checks `core_version()` and the matching version's docs; an old plugin may fail to load outright on a new major version
- **The 6.0 migration (Plugin Manager → Extension Manager)**: from 6.0 the plugin manager is rebuilt as Extension Manager, and the old `pluginmanager` is only a shim; bundled Python rises to 3.13 (covering Linux for the first time), and external Python is still 3.10 minimum — after an upgrade, run the dependency migration once (reinstall plugin dependencies), or old plugins report missing dependencies or fail to load
- **The `i` key cycles IL; `m` does not**: in the official docs `m` is "apply an enumeration display to an integer" (a type operation) — the circulating claim "m switches to MLIL" does not match the current version; switch IL with `i` or the bottom-right Options menu
- **Plugin compatibility**: plugins are built/adapted per major version — plugins in Extension Manager (6.x; the old menu is `File > Manage Plugins`) that mark a version requirement must be verified one by one after a cross-major upgrade

## Personal-edition limits

- **No headless automation**: headless is a commercial-edition capability (there is no `binaryninja-headless` CLI — the proper path is `binaryninja.load()` in a script after `install_api.py` registers it, and a headless license uses the official standalone download package); the personal edition runs scripts in the GUI `File > Python` panel
- **Automation frequency/scale limits**: the personal edition limits script automation (batch runs, headless operation), and the license terms constrain personal use — before a batch job, judge whether it exceeds the limit; past the limit, use [[re-ghidra]] analyzeHeadless (free) instead
- **Commercial-edition features are cut**: some plugins require the commercial edition; confirm the license type in `Options > About`, and do not debug a commercial-feature failure on the personal edition

## Analysis-quality pitfalls

- **MLIL distorts obfuscation**: junk instructions / control-flow flattening break data-flow recovery — when the decompile shows dead code / a constantly-false condition, drop to LLIL/assembly and cross-check, or do [[re-deobfuscate]] first
- **A large binary's first analysis is slow**: a 100MB+ sample with every default analysis pass on can take several minutes — turn passes off as needed in `Options > Analysis`, or do local analysis of key functions with the `f.analysis_skip_override` approach
- **Analyzing a packed sample directly = a false result**: the packer region is not decrypted and function identification is garbage — unpack with [[re-packer-id]] / [[re-anti-analysis]] before import
- **Headless mode does not run analysis automatically**: after `binaryninja.load()` you must call `update_analysis_and_wait()` — the GUI analyzes automatically, headless does not, and forgetting that line makes every result empty

## Plugin and path pitfalls

- **The macOS plugin directory is special**: `~/Library/Application Support/Binary Ninja/plugins` — not `~/.binaryninja/plugins` (that is Linux only); a plugin in the wrong place does not load
- **The Windows plugin directory**: `%APPDATA%\Binary Ninja\plugins` — do not put it under the install directory (permissions / upgrade overwrite)
- **The macOS build installed by cask**: `brew install --cask binary-ninja` installs a GUI app; the Python API still needs `install_api.py` run in the app directory to register it into your Python environment

## Usage notes

- Run everything inside the sandbox ([[re-analyze/platform-tips]] supreme rule); a script that triggers dynamic execution defaults to inside the sandbox
- Switching stacks (Ghidra/IDA ↔ BN) has no project interchange format — annotations rely on a scripted unified naming convention, or are moved by hand per function
- Version-dependent behavior follows the actual values of `Options > About` and `core_version()`
