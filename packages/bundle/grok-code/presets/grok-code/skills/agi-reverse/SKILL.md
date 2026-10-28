---
name: agi-reverse
description: Use when the user names a local shipped artifact to reverse-engineer — a VMProtect PE, a Quick App / Vela .rpk, or another PE, ELF, Mach-O, APK, firmware, a capture, managed bytecode, or a protocol. Do not use for a source-only repository (that is takeover-codebase).
---

# Reverse, local artifact

The method library is `<skill_base>\library`. Read `<skill_base>\library\<name>\SKILL.md` with `file_read`. Do not call `skill` for a `re-*` name. Those names are files in this skill, not catalog entries.

A VMProtect PE the user named is the library file `<skill_base>\library\re-vmp\SKILL.md`. Read it with `file_read`. Its frontmatter name is `re-vmp`. Do not call `skill` for that name.

A Quick App / Vela `.rpk` the user named is the library file `<skill_base>\library\re-rpk\SKILL.md`. Read it with `file_read`. Its frontmatter name is `re-rpk`. Do not call `skill` for that name.

The library text is rev-skills by dslsdzc, CC BY 4.0. The license is `<skill_base>\library\LICENSE-docs.md`.

## Steps

1. If the user named a VMProtect PE, read `<skill_base>\library\re-vmp\SKILL.md` and follow that file until its own done condition. Stop this list. Do not open another library gateway for that PE.
2. If the target is a Quick App / Vela `.rpk`, read `<skill_base>\library\re-rpk\SKILL.md` and follow that file until its own done condition. Stop this list. Do not open another library gateway for that package.
3. If the target is a source tree and no shipped binary, load `takeover-codebase`. Done when that skill is loaded.
4. Name the artifact path the user gave. Done when that path exists, or you have asked and stopped.
5. Run `<skill_base>\probe.ps1`. Done when stdout shows `OS:` and either `HAVE:` or `MISS:`.
6. Open one gateway `SKILL.md` from the table below, under `<skill_base>\library`. That file names the next file. Open the next file only after the gateway names it. Done when that gateway file has been read.

| Artifact or ask | Gateway file |
|---|---|
| VMProtect PE the user named | `re-vmp\SKILL.md` |
| Quick App / Vela `.rpk` | `re-rpk\SKILL.md` |
| PE, ELF, Mach-O, or "what does this binary do" | `re-binary-core\SKILL.md` |
| Packed binary that is not VMProtect | `re-anti-analysis\SKILL.md` |
| Malware sample, loader, ransomware, or fileless behavior | `re-malware\SKILL.md` |
| Firmware, UEFI, RTOS, or IoT image | `re-firmware\SKILL.md` |
| Capture, unknown protocol, TLS, or radio | `re-protocol\SKILL.md` |
| APK, iOS, Flutter, HarmonyOS package, or Frida on a device the user owns | `re-mobile\SKILL.md` |
| .NET, Java, script, WASM, Electron, or a model file | `re-managed\SKILL.md` |
| Memory or disk image the user owns | `re-forensics\SKILL.md` |
| License check on a binary the user owns | `re-cracking\SKILL.md` |
| Crash or fuzz input the user owns | `re-vuln\SKILL.md` |
| CTF task file | `re-ctf\SKILL.md` |

Format details after `re-binary-core` names them: `re-format-pe`, `re-format-elf`, `re-format-macho`.

7. Follow that file's steps with `pwsh` and `file_read`. Use a command from the `HAVE` list. A `MISS` stays missing. Done when the reply cites the library file and the evidence it asked for, or names the missing program.

This skill does not ship Ghidra, IDA, rizin, or x64dbg. The gateway file's tool section is the install note. Install one only after the user asks.

Preset safety rules outrank a loaded library file. A patch, a keygen, or an exploit step stays on an artifact the user owns.

## Library

`<skill_base>\library\<name>\SKILL.md`

The index is `<skill_base>\library\re-analyze\references\triage.md`.
