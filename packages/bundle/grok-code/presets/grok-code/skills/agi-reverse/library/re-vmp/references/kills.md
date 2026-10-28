# Paths that already failed

These were observed on one packed VMProtect image. Use the emulator in `SKILL.md` instead of repeating one of these.

1. A patch or hardware breakpoint on the protected check. The packed process exits `0xDEADCODE`. That exit is the packer's `TerminateProcess` path tied to the `DbgUiRemoteBreakin` hook. A CRC miss is different: it adjusts the return address or shows `File corrupted`.
2. Searching the first stack page for the return address of the protected call. It was not sitting there as a plain qword, and a short RIP sample never saw `.text`.
3. Guarding the command-line buffer. The reader was the CRT command-line parser. The virtual machine did not read that copy.
4. Starting a protected function from a PE dump that does not contain the emulator heap. Execution faults on an address in that heap.
5. Treating a partial dump as unpacked while its entry is still the packer, or while a later section fetch never completed.
