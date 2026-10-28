---
name: re-vmp
description: Identify, unpack under Unicorn, rebuild imports, recover a rolling-XOR string key, or list CRC and LZMA sites in a local VMProtect PE the user owns. Triggers: VMProtect, VMP, unpack, Unicorn. Not another protector, a PE the user did not name, or a write-up meant to be published as a general crack recipe.
capabilities: [unpack, emulation, pe-parser, key-extraction]
---

# VMProtect, local sample

This file is `library\re-vmp` inside `agi-reverse`. It is not a catalog skill. Do not call `skill` for `re-vmp`.

## When to use / when not to use

- Use when the user named a local VMProtect PE and wants it identified, unpacked, imports rebuilt, or a string key recovered.
- Do not use for another protector. Read [[re-anti-analysis]]. A simple packer continues at [[re-unpack-simple]].
- Do not use when the user has not given a PE path. Ask, then stop.
- Do not use to publish a general crack recipe.
- Do not switch a named VMProtect PE to the debugger steps in [[re-unpack-advanced]]. This file's tool is the Unicorn driver beside it.

## Tools

The driver is `<skill_base>\library\re-vmp\vmp3104.py`. The emulator is `<skill_base>\library\re-vmp\unpack`. The Windows export catalog is `<skill_base>\library\re-vmp\catalog`. Do not read `catalog.json` into the conversation. Do not run the copy under `VMPReseach\vmp-lazy-unpack-main`.

Unicorn is the installed package. `unpack\tracer.py` creates `Uc(UC_ARCH_X86, …)`. It is not copied into this directory.

Default `--work` is `vmp3104-work` under the current working directory. Traces and the reconstructed image go there, not under `<skill_base>`. A `--work` path inside `<skill_base>` makes the driver stop and ask for another path.

- Check: `python <skill_base>\library\re-vmp\vmp3104.py doctor` prints `pefile`, `capstone`, `unicorn`, both catalog pairs, and `engine ok`.

## Steps

Run these in order. The command's own stdout is the result.

1. **Name the sample.** Done when that path exists, or you have asked and stopped.
2. **Doctor.** Run the check above. Done when stdout shows `engine ok`.
3. **Identify.** `python <skill_base>\library\re-vmp\vmp3104.py identify PE`. Done when stdout gives `shape`, `bits`, `entry_rva`, `entry_section`, and `packed_sections`.
4. **Branch on shape.**
   - `packed`: at least one section has a virtual size and no raw bytes, and either `.text` is empty or the entry is outside `.text`. Continue.
   - `image`: the file already has raw code. `keys` and `imports` still apply. Say that `emulate` is for a packer entry before a long run.
5. **String key.** `python <skill_base>\library\re-vmp\vmp3104.py keys PE`. Done when stdout prints a key and offsets, or `no key`.
6. **Rebuild imports.** `python <skill_base>\library\re-vmp\vmp3104.py imports PE OUTPUT`. This does not emulate. Pass `--32bit` when `bits` is 32. Done when stdout prints the output path, or the command's error.
7. **Unpack.** `python <skill_base>\library\re-vmp\vmp3104.py emulate PE`. Add `--32bit` when `bits` is 32. Optional `output_name` is a file name, not a path. Done when the process exits and stdout names a `trace_*` directory, or you can quote the error.
8. **Summary.** `python <skill_base>\library\re-vmp\vmp3104.py summary`. Done when stdout prints `kind`, or says there is no trace.

`crc PE` and `lzma PE` list sites without starting Unicorn. Use them when you need the addresses before a long `emulate`. Done when stdout prints addresses, or `no crc` / `no lzma`.

`unwind PE OUTPUT` repairs the exception directory of a PE that already has bytes. Done when stdout prints `pdata_status` and the output path.

## Related files

- A VMProtect PE the user named stays on this file. Do not open [[re-unpack-advanced]] for that PE.
- An unknown packer goes to [[re-packer-id]] and [[re-anti-analysis]]. Leave this file once it is not VMProtect.
- Import, section, and exception-directory fields are [[re-format-pe]].
- Failed approaches on one packed image are [references/kills.md](references/kills.md). They are not offsets for a different PE.

## Pitfalls

- **A breakpoint or patch on the protected check.** The packed process exits `0xDEADCODE`. That exit is the packer's `TerminateProcess` path on the `DbgUiRemoteBreakin` hook. A CRC miss is different: it adjusts the return address or shows `File corrupted`. Use this emulator instead of repeating that breakpoint.
- **Searching the first stack page for the return address.** A short RIP sample never saw `.text`. The return address was not a plain qword there. Do not treat that sample as a restored entry.
- **Guarding the command-line buffer.** The reader was the CRT parser. The virtual machine did not read that copy.
- **Starting a protected function from a dump that has no emulator heap.** Execution faults on an address in that heap. The heap is not in the PE.
- **Treating an unfinished dump as unpacked.** The entry is still the packer, or a later section fetch never finished. The engine stops at `emulation_reached_unpacked_entry` only after a section with no raw bytes has been written. The packer entry itself does not count.

## Engine

- Restored code: execution that enters a section with no raw bytes, after that page has been written, stops as `emulation_reached_unpacked_entry`.
- CRC and LZMA: `unpack\loader_crc.py` and `unpack\semantic_lzma.py` scan executable sections. `crc` and `lzma` print the addresses. `emulate` uses the CRC sites it finds to skip slow loops.
- Exception directory: `unpack\unwind.py` `repair_exception_tables`. `unwind` writes the repaired PE.
- The research engine writes `summary.json` and `progress.log` in the trace directory. It does not write `capture.txt`. `capture` prints `no capture.txt` until a trace actually contains that file.

## Report

State the shape, the trace directory, and the stop information `summary.json` contains. A string is a candidate only after the sample's own check accepts it.
