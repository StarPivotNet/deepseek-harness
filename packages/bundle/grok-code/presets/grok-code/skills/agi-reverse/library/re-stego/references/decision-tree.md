# Steganography detection decision tree and evidence grading

Steganography detection picks the method from the carrier first. A failed extraction enumerates order. This file is used together with steps 1-4 of SKILL.md.

## Carrier × feature decision tree

```
怀疑对象
├─ 文件尾部异常（大小不整/尾随数据）→ 尾部附加检查（binwalk/hexdump）
├─ 图片（PNG/BMP）→ LSB 位平面扫描（zsteg/脚本/stegsolve）
├─ 图片（JPEG）→ DCT 域方法（outguess 类），不做 LSB（有损压缩已破坏位平面）
├─ 音频 → 频谱图目检（sox spectrogram）+ steghide 尝试
├─ EXIF/元数据 → exiftool 查看异常字段
├─ 压缩包未用空间 → 解包后对比原始大小/CRC 检查
└─ 无特征 → 不进入隐写流程（先 [[re-triage]] 确认文件类型与可疑点）
```

## Tool-selection branch

```
确认载体后
├─ PNG/BMP + 怀疑 LSB → zsteg 全通道 → 指定平面提取（-E 语法）
├─ 任何载体 + 怀疑常规隐写 → steghide extract（需要密码则标注）
├─ 尾部/附加数据 → binwalk 分割提取 → magic 验证
├─ 需要逐位平面目检 → stegsolve（Java GUI）
└─ 工具无输出但怀疑仍在 → python3 脚本（按位提取 + 顺序枚举）
```

## Extraction-failure branch

```
提取乱码/无结果
├─ 怀疑顺序问题 → 枚举组合：行序（正/逆）× 位序（LSB/MSB）× 通道（RGB 各通道/组合）× 位平面（b1/b2…）
├─ 怀疑压缩 → 查压缩头（zlib 78 9C / gzip 1F 8B / bzip2 42 5A 68）→ 先解压再读
├─ 怀疑加密 → 查密钥线索（密码提示/附近文件）→ 有则 [[re-crypto-decrypt]]，无则标注
├─ 怀疑嵌套 → 每层提取物再过一遍检测流程（多载体分层）
└─ 全部排除 → 标注「未检出」（不等于不存在，见 [[gotchas]]）
```

## Detection-conclusion grades

| Grade | Criterion | Action |
|---|---|---|
| Confirmed embedding | Valid data was extracted (a magic hit / readable content) | Extract + archive (path + sha256) |
| Strongly suspicious | A structural anomaly + an entropy anomaly + a tool hit, but the extract is invalid | Keep enumerating order / compression / encryption hypotheses |
| Suspicious feature | A single feature (for example a high-entropy span) | Treat it as a clue, not a conclusion; merge it with other clues |
| Not detected | No feature, or enumeration was exhausted with nothing | Report "not detected" plus the list of methods already used (a blind-spot statement) |

## Combined routine (the full flow)

1. File first look ([[re-triage]]: type / magic / size check)
2. Structure check (pngcheck / exiftool / hexdump of the tail)
3. Steganography scan (zsteg / steghide / binwalk, by carrier)
4. Extract → check (magic / readability / compression header)
5. Enumerate (order / channel / bit plane) → still nothing → mark not detected + the method list

## Lessons (internalized)

- Detection conclusions have three grades. An entropy or structure anomaly is a clue, not evidence — a conclusion requires a successful extract or a confirmed structure-level anomaly
- Enumerating extraction order is the most common failed-extract repair. A scripted enumeration is faster than doing it by hand
- "Not detected" must carry the method list and a blind-spot statement (the hider may use an unusual order, encryption, or a new carrier)
- Archive sha256 of each step's product so the conclusion can be rechecked

## Notes

- In a forensics case, confirm the authorized scope first (target carriers / data classes)
- The extract's first look goes to [[re-triage]]; decryption continues at [[re-crypto-decrypt]]
- In a CTF, watch the flag format (the flag prefix in the challenge statement). Run strings over the extract first
