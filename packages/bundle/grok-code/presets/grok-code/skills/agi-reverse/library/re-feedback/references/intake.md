# Distillation method

One entry format, redaction rules, domain decision table, dedup rules, and article-scan skip criteria.

## Entry format

One cell per entry. The format is fixed:

**Title (verb phrase, 10-20 characters)**: Symptom — (reproducible description); Cause — (root cause, do not repeat the symptom); Fix — (executable next step, including skill / tool names)

Example:

**Keep original format parameters when repacking**: Symptom — after repack / resource replacement the package crashes or fails to parse on a real device; Cause — the repack tool's default output format differs from the original (compression / alignment / container flags); Fix — use a repack tool such as Apktool (see [[re-mobile-pack]]) and keep the original package's format parameters (compression flags / alignment) so the output matches the original file's size class and format; verify locally before a real device

- One cell, one item: one symptom + one root cause + one fix. Do not merge several pitfalls into one entry
- A pitfall and a method use the same format: a pitfall writes how to avoid it; a method writes "Symptom — the old approach is inefficient; Cause — …; Fix — the better path"

## Redaction rules (hard line)

- Must not appear: company / product / project name, target sample name, internal codename, proprietary protocol name, domain / package name / signature fingerprint
- Must not hint: industry + scale + region combination, or a unique combination of technical features that can identify the subject
- Generalized wording: target → `某移动应用` / `某嵌入式设备` / `某通信协议` (a mobile app / an embedded device / a communications protocol); keep only the technical conclusion (symptom / cause / fix)
- Source field: field session → `2026-08 实战会话` (date only); article → article title + URL (public information may stay)
- Self-check before storing or filing an issue: list every proper noun in the entry and confirm each one is generalized; any failure → redistill

## Domain decision table

| Entry topic | Target skill |
|---|---|
| packer / unpack / deobfuscation / junk instructions / control-flow flattening | [[re-anti-analysis]] family ([[re-packer-id]] [[re-unpack-simple]] [[re-unpack-advanced]] [[re-deobfuscate]]) |
| malicious behavior / persistence / injection / C2 | [[re-malware]] family ([[re-behavior]] [[re-loader]] [[re-fileless]] [[re-ioc]]) |
| firmware / IoT / embedded / rootfs | [[re-firmware]] family ([[re-fw-extract]] [[re-fw-rootfs]] [[re-fw-emulate]]) |
| protocol / traffic / capture / encrypted communications | [[re-protocol]] family ([[re-netcap]] [[re-proto-rev]] [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] [[re-tls]]) |
| mobile app / JNI / Frida / packed unpack | [[re-mobile]] family ([[re-apk]] [[re-android-native]] [[re-frida]] [[re-mobile-pack]]) |
| general binary / decompile / debug / format | [[re-binary-core]] family ([[re-triage]] [[re-format-pe]] [[re-ghidra]] [[re-gdb]]) |
| cracking / license / registration code / patch | [[re-cracking]] family ([[re-license]] [[re-patching]] [[re-keygen]]) |
| fuzz / crash / vulnerability / exploit | [[re-vuln]] family ([[re-fuzzing]] [[re-crash-triage]] [[re-exploit]]) |
| CTF / angr / z3 | [[re-ctf]] family ([[re-angr]] [[re-z3]] [[re-pwn]]) |
| .NET / Java / script / WASM / contract / AI model | [[re-managed]] family ([[re-dotnet]] [[re-java]] [[re-script-deob]] [[re-wasm]] [[re-blockchain]] [[re-ai-model]]) |
| forensics / memory forensics / threat intelligence | [[re-forensics]] family ([[re-mem-forensics]] [[re-disk-forensics]] [[re-ti]]) |
| anti-cheat / kernel driver / virtualization | [[re-binary-core]] family ([[re-kernel]] [[re-anti-cheat]] [[re-hypervisor]]) |
| anti-debug / detection evasion | [[re-anti-analysis]] family ([[re-evasion]]) |
| ransomware | [[re-ransomware]] |

Fallback: `grep -rn "keyword" .claude/skills/*/SKILL.md` to find the most relevant skill; if still unsure → ask the user, do not guess.

## Dedup rules

- Before storing, `grep -n "title-keyword" .claude/skills/<skill>/references/experience.md` (file missing = no duplicate)
- Same symptom already present → skip and tell the user; a more complete new version may replace the old entry

## Article-scan skip criteria

- Tool / workflow promotion posts (beginner tutorials, tool introductions, no new method)
- Body truncated / body cannot be extracted
- Pure news / not reverse-engineering content
