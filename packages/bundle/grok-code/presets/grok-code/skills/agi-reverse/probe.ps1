# Reports OS, memory, and which reverse-engineering commands are already installed.
# A missing command is a MISS. This script does not download or install anything.
$ErrorActionPreference = 'Continue'
Write-Output '== ENV =='
Write-Output 'OS: Windows'
Write-Output ("ARCH: {0}" -f $env:PROCESSOR_ARCHITECTURE)
$cores = @(Get-CimInstance Win32_Processor | ForEach-Object { $_.NumberOfLogicalProcessors } | Measure-Object -Sum).Sum
Write-Output ("CORES: {0}" -f $cores)
$bytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
Write-Output ("MEM_GB: {0}" -f ([math]::Round($bytes / 1GB, 1)))

Write-Output '== TOOLS =='
$names = @(
    'aapt2','adb','afl-clang-fast','afl-cmin','afl-fuzz','afl-tmin','apksigner','apktool',
    'arm-linux-gnueabi-readelf','atos','binwalk','blkls','canbusload','candump','cansniffer',
    'capinfos','class-dump','codesign','cpuid','cramfsck','defaults','dexdump','diec','docker',
    'dotnet','dotnet-dump','dpkg-deb','driverquery','eu-stack','ffprobe','firejail','flashrom',
    'fls','fltmc','frida','frida-dexdump','frida-trace','fsstat','gcore','gdb','gdb-multiarch',
    'Get-WinEvent','ghc','hackrf_transfer','hbc-decompiler','hbc-disassembler','hbc-file-parser',
    'icat','idevicebackup2','iproxy','iptables','jadx','jar','java','javap','jdb','js-beautify',
    'jtool2','keytool','ld64.lld','lipo','lldb','llvm-nm','llvm-objdump','llvm-readobj','logman',
    'ltrace','mactime','mitmproxy','mmls','modprobe','mono','mp4dump','netron','nm','npx','objcopy',
    'objdump','ocamlc','ocamlobjinfo','ocamlopt','olevba','one_gadget','openocd','openssl','otool',
    'palera1n','panoramix','pdf-parser','pdfid.py','photorec','picocom','powershell','procdump',
    'pwsh','pycdc','pyinstaller','qemu-arm','qemu-system-arm','qemu-system-mips',
    'qemu-system-x86_64','readelf','rg','rizin','ROPgadget','ropper','rr','rtfobj','rtl_sdr',
    'rz-diff','rz-pm','schtasks','sdkmanager','spctl','strace','sysctl','systemctl','tcpdump',
    'testdisk','tshark','tsk_recover','uefiextract','ueifind','unblob','unsquashfs','upx',
    'VBoxManage','vmrun','vol','wasm-decompile','wasm-objdump','wasm2wat','wasm3','wasmtime',
    'yara','zig','zipalign','zsteg',
    'python','python3','radare2','r2','ida','idat','ida64','idat64','analyzeHeadless','x64dbg','x32dbg'
)
$missing = @()
foreach ($name in $names) {
    if (Get-Command $name -ErrorAction SilentlyContinue) {
        Write-Output ("HAVE: {0}" -f $name)
    } else {
        $missing += $name
    }
}
if ($missing.Count -gt 0) {
    Write-Output ("MISS:{0}" -f (($missing | ForEach-Object { " $_" }) -join ''))
}
Write-Output '== HINT =='
Write-Output 'Use a HAVE command. A MISS stays missing until the user asks to install it.'
