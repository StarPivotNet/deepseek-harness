# Unicorn / Qiling command cheat sheet and operation sequences

Both frameworks are Python libraries: a "command" is an API. Division of labor: Unicorn handles only CPU+memory (a single function/code segment); Qiling sits on Unicorn and takes over syscalls/files/dynamic linking (program level). API names follow the official docs and the target version's source (version differences are in [[gotchas]]).

## Unicorn API family

```python
from unicorn import *
from unicorn.x86_const import *        # 按架构: arm_const / arm64_const / mips_const ...

mu = Uc(UC_ARCH_X86, UC_MODE_32)       # 架构 × 模式
mu = Uc(UC_ARCH_ARM, UC_MODE_ARM | UC_MODE_BIG_ENDIAN)   # armeb 大端

# 内存（必须先 mem_map 再 mem_write；地址与大小须页对齐）
mu.mem_map(0x1000, 0x1000)             # 一页
mu.mem_write(0x1000, CODE)             # 写代码/数据
data = mu.mem_read(0x2000, 0x100)      # 读内存（脱壳明文落盘）
mu.mem_protect(0x1000, 0x1000, UC_PROT_ALL)   # 改权限（UC_PROT_READ/WRITE/EXEC/ALL）
mu.mem_unmap(0x1000, 0x1000)

# 寄存器
mu.reg_write(UC_X86_REG_ESP, 0x2000)   # 栈必须设，否则崩
rax = mu.reg_read(UC_X86_REG_EAX)

# 执行
mu.emu_start(0x1000, 0x1000 + len(CODE), timeout=0, count=0)  # until 必须覆盖代码结束
mu.emu_stop()

# 钩子
mu.hook_add(UC_HOOK_CODE, hook_code)              # 每指令
mu.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, hook_mem)  # 内存读写
mu.hook_add(UC_HOOK_MEM_UNMAPPED, hook_bad)       # 未映射访问（可现场补映射继续）
mu.hook_add(UC_HOOK_MEM_FETCH, hook_fetch)        # 取指（追踪执行流）
mu.hook_add(UC_HOOK_INTR, hook_intr)              # 中断（syscall 类拦截）
mu.hook_del(handle)                               # 卸钩
```

Hook callback signatures (2.x matches 1.x):

```python
def hook_code(uc, address, size, user_data): ...                 # UC_HOOK_CODE
def hook_mem(uc, access, address, size, value, user_data): ...   # 内存类
def hook_bad(uc, access, address, size, value, user_data): ...   # 返回 True 继续
```

Common constants (see the version group in [[gotchas]]): `UC_ARCH_X86/ARM/ARM64/MIPS/RISCV`; `UC_MODE_16/32/64/ARM/THUMB/BIG_ENDIAN`; `UC_PROT_READ/WRITE/EXEC/ALL`; registers `UC_X86_REG_RAX/ESP/EIP/RIP` and similar.

## Qiling API family

```python
from qiling import Qiling
ql = Qiling(["./rootfs/x8664_linux/bin/target", "arg1"], "./rootfs/x8664_linux")
# 构造: Qiling(argv, rootfs, env=..., verbose=..., console=...)；rootfs 下才是目标可见文件系统
ql.run()                                  # 或 ql.run(begin, end, timeout, count)
ql.save(snapshot="stage1.qsave")          # 状态存档（1.1.x+；reg/mem/fd 等可分别开关）
ql.restore(snapshot="stage1.qsave")       # 恢复继续
ql.hook_address(fn, addr)                 # 地址断点（等价 Unicorn 按地址判断的 hook_code）
ql.hook_code(fn)                          # 每指令
ql.hook_mem_read(fn) / ql.hook_mem_write(fn) / ql.hook_mem_unmapped(fn)
ql.mem.read(addr, size) / ql.mem.write(addr, data)
ql.reg.read("eax") / ql.reg.write("eax", 0)
ql.os.fs                                   # 文件系统视图（rootfs 内路径）
```

## Operation sequences (combined patterns)

### 1. Unpack: extract the decrypt routine, emulate it, and take the plaintext

```
Statically locate the decrypt loop ([[re-unpack-simple]] / [[re-unpack-advanced]] + [[re-ghidra]])
Extract: code-segment bytes + entry register initial values (stack/data pointers) + the input ciphertext region
Unicorn load: mem_map code page + data page + stack page → mem_write → reg_write → emu_start
hook_mem_write records when the target region is written → mem_read the plaintext segment → archive sha256
Verify: compare with a real sandbox run ([[re-sandbox]]) decrypt result
```

### 2. Single-function logic verification (decompiler product ↔ emulation ground truth)

```
Recover the algorithm by decompilation ([[re-binary-core]]) → extract the assembly-level implementation (objdump segment)
Run that segment in Unicorn; inputs use ground truth / boundary values (0, -1, 0x7fffffff) → compare output with the decompiler expectation
A mismatch means the decompiler understanding is wrong — correct the logic against the emulation
```

### 3. Shellcode behavior analysis

```
Extract shellcode from the sample ([[re-shellcode]]) → map an executable page
hook_code records the instruction sequence + hook_mem_write records writes (find where the decrypt loop lands)
hook_intr intercepts int 0x80/syscall and prints eax and arguments (does not really execute the syscall)
Products (instruction trace / write sites) go into the evidence directory
```

### 4. Qiling whole-program emulation + dump at a key point

```
Qiling load (put libc/ld-linux and input files in the rootfs)
hook_address at the OEP / decrypt-complete point → ql.save or ql.mem.read to dump the decrypted segment
ql.restore back to the saved point and continue branch exploration (for a multi-stage flow)
```

## Lessons internalized

- **Page alignment**: mem_map address and size must be page-aligned (0x1000); if it reports `Invalid memory`, check alignment first
- **Stack and until are required**: if ESP is not set, the first stack instruction crashes; `emu_start`'s until must cover the code end address, or it runs into an illegal address
- **An exception in a callback = a silent stop**: 2.x stores the callback exception and emu_stop; the outer layer may only see "emulation ended early" — try/except + print inside the callback, and after `emu_start` use `reg_read` to check PC and see where it stopped
- **Changing PC inside a hook can jump**: `reg_write(UC_X86_REG_EIP, target)` implements a patch jump; after the jump, remember `hook_del` so it does not re-enter
- **Syscalls are not emulated**: a bare Unicorn run stops at a syscall — fake-return with hook_intr, or switch to Qiling
- **Slow**: a per-instruction `UC_HOOK_CODE` callback is an order-of-magnitude cost; use it only on the trace segment; bulk-read/write a large data region with mem_read/mem_write rather than a per-byte hook

## Usage notes

- Emulation is dynamic execution; default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle); cross-check emulation conclusions against a real sandbox run
- Archive products (plaintext segments/traces/snapshots) with sha256 ([[re-triage]]); conclusions go into [[re-analyze/analysis-contract]]
