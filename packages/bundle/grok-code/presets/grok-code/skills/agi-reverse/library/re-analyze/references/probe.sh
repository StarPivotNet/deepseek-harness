#!/bin/sh
# probe.sh — environment probe: OS / CPU / memory / installed reverse-engineering tools
# Output contract: OS: / ARCH: / CORES: / MEM_GB: / HAVE:tool (one per line) / MISS: tool tool … (one summary line)
#   —— HAVE is the "prefer these" list, one tool per line; MISS is only a hint, collapsed to one line so it does not flood the screen
# The tool list is generated from the register (see the GENERATED-TOOLS block below). Do not hand-edit it.
# General rule: a blank environment (no tools at all) must still print normally and must never abort.

echo "== ENV =="
if command -v uname >/dev/null 2>&1; then
  case "$(uname -s)" in
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "OS: WSL-Linux"
      else
        echo "OS: Linux"
      fi
      ;;
    Darwin) echo "OS: macOS" ;;
    MINGW*|MSYS*|CYGWIN*) echo "OS: Windows(msys)" ;;
    *) echo "OS: $(uname -s)" ;;
  esac
  echo "ARCH: $(uname -m)"
  if command -v nproc >/dev/null 2>&1; then echo "CORES: $(nproc)"; else echo "CORES: unknown"; fi
  if command -v free >/dev/null 2>&1; then
    # Must pin LC_ALL=C: a localized free translates "Mem:" into a CJK label such as `内存：`, and awk then misses the line (this field used to stay empty)
    echo "MEM_GB: $(LC_ALL=C free -g 2>/dev/null | awk '/^Mem:/{print $2}')"
  else
    echo "MEM_GB: unknown"
  fi
else
  echo "OS: Windows"
  echo "ARCH: unknown"
  echo "CORES: unknown"
  echo "MEM_GB: unknown"
fi

echo "== TOOLS =="
# >>> GENERATED-TOOLS (source: docs/audit/tool-register.json; to change the list, edit the register and run node bin/probelist.mjs)
# shellcheck disable=SC2034
PROBE_TOOLS="aapt2 adb afl-clang-fast afl-cmin afl-fuzz afl-tmin apksigner apktool arm-linux-gnueabi-readelf atos binwalk blkls canbusload candump cansniffer capinfos class-dump codesign cpuid cramfsck defaults dexdump diec docker dotnet dotnet-dump dpkg-deb driverquery eu-stack ffprobe firejail flashrom fls fltmc frida frida-dexdump frida-trace fsstat gcore gdb gdb-multiarch Get-WinEvent ghc hackrf_transfer hbc-decompiler hbc-disassembler hbc-file-parser icat idevicebackup2 iproxy iptables jadx jar java javap jdb js-beautify jtool2 keytool ld64.lld lipo lldb llvm-nm llvm-objdump llvm-readobj logman ltrace mactime mitmproxy mmls modprobe mono mp4dump netron nm npx objcopy objdump ocamlc ocamlobjinfo ocamlopt olevba one_gadget openocd openssl otool palera1n panoramix pdf-parser pdfid.py photorec picocom powershell procdump pwsh pycdc pyinstaller qemu-arm qemu-system-arm qemu-system-mips qemu-system-x86_64 readelf rg rizin ROPgadget ropper rr rtfobj rtl_sdr rz-diff rz-pm schtasks sdkmanager spctl strace sysctl systemctl tcpdump testdisk tshark tsk_recover uefiextract ueifind unblob unsquashfs upx VBoxManage vmrun vol wasm-decompile wasm-objdump wasm2wat wasm3 wasmtime yara zig zipalign zsteg"
# <<< GENERATED-TOOLS
MISS_LIST=""
for t in $PROBE_TOOLS; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "HAVE: $t"
  else
    MISS_LIST="$MISS_LIST $t"
  fi
done
[ -n "$MISS_LIST" ] && echo "MISS:$MISS_LIST"

echo "== HINT =="
echo "Prefer installed tools (HAVE). For missing tools (MISS), follow the Tool preparation section of the matching skill. Do not abort the analysis."
