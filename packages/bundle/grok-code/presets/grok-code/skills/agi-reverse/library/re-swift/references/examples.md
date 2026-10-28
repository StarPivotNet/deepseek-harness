# Swift minimal parse examples

Every example symbol is taken from the official test vectors (swiftlang/swift test/Demangle/Inputs/manglings.txt and the ABI document Mangling.rst) and can be checked on this machine. The grammar is in [[layout]].

## 1. Symbol extraction and the decode command chain

```sh
# Mach-O: 提取 $s 符号 → 批量解码
llvm-nm -m sample | awk '$3 ~ /^\$s/ {print $3}' | swift-demangle | head -20
# ELF 同效果
readelf -s sample | awk '$8 ~ /^\$s/ {print $8}' | swift-demangle | head -20
# 单条解码（macOS 用 xcrun swift-demangle；无参数时读 stdin）
echo '$s4main6myFuncyyF' | swift-demangle
# $s4main6myFuncyyF ---> main.myFunc() -> ()
# 精简模式与展开树
echo '$s4main3FooC3barSiyF' | swift-demangle -simplified
echo '$s4main3FooC3barSiyF' | swift-demangle -expand
```

## 2. Official test-vector comparison (an excerpt measured from manglings.txt)

| Mangled name | Demangled result |
|---|---|
| `$s4main6myFuncyyF` | `main.myFunc() -> ()` |
| `$s3foo3barC3bas3zimyAaEC_tF` | `foo.bar.bas(zim: foo.zim) -> ()` |
| `_$s3foo3barC3bas3zimyAaEC_tFTo` | `{T:_$s3foo3barC3bas3zimyAaEC_tF,C} @objc foo.bar.bas(zim: foo.zim) -> ()` (`_To` = an @objc bridging thunk) |
| `$s4main3fooyySiFyyXEfU_TA.1` | `{T:} partial apply forwarder for closure #1 () -> () in main.foo(Swift.Int) -> () with unmangled suffix ".1"` (a closure forwarder) |
| `$s4main8MyStructV3fooyyF` | `main.MyStruct.foo() -> ()` (a struct method) |
| `_T04main1_yyF` | `main._() -> ()` (the Swift 4.0 `_T0` prefix) |
| `_TtVCC4main3Foo4Ding3Str` | `main.Foo.Ding.Str` (the Swift 3.x `_Tt` prefix; V=a struct chain) |

Comparison points: the two `y`s in `yyF` are the result `()` and the parameter `()`. When `Si` is the result Int it sits before the parameters (`3barSiyF` → `bar() -> Int`). `_To` appears as a pair with the body. `TA` is a closure forwarder (the closure entry).

## 3. A minimal Python decoder (simple symbols, no substitution and no generics)

```python
import re
KIND = {'C': 'class', 'O': 'enum', 'V': 'struct', 'P': 'protocol'}
STDLIB = {'Si': 'Int', 'SS': 'String', 'Sq': 'Optional', 'Sa': 'Array',
          'Sd': 'Double', 'Sb': 'Bool'}

def ident(sym, p):            # 长度前缀标识符：3Foo -> "Foo"
    m = re.match(r'(\d+)', sym[p:])
    n = int(m.group(1)); start = p + len(m.group(1))
    return sym[start:start+n], start+n

def typ(sym, p):              # 类型单元：y=() Si=Int ...
    c = sym[p]
    if c == 'y': return '()', p + 1
    if c == 'S': return STDLIB.get(sym[p:p+2], 'S?'), p + 2
    raise ValueError('unhandled type char %r' % c)

def sig(sym, p):              # 签名顺序：结果类型在前、参数在后
    result, p = typ(sym, p)
    params, p = typ(sym, p)
    if sym[p] != 'F': raise ValueError('no F')
    return '%s -> %s' % (params, result), p + 1

def decode(sym):
    p = 2 if sym.startswith('$s') else 3   # 仅支持 $s / _$s
    mod, p = ident(sym, p)
    parts = [mod]
    while p < len(sym) and sym[p].isdigit():
        name, p = ident(sym, p)
        if p < len(sym) and sym[p] in KIND:
            parts.append('%s (%s)' % (name, KIND[sym[p]])); p += 1
        else:
            parts.append(name)
    s, _ = sig(sym, p)
    return '.'.join(parts) + s

print(decode('$s4main6myFuncyyF'))              # main.myFunc() -> ()
print(decode('$s4main3FooC3barSiyF'))           # main.Foo (class).bar() -> Int
print(decode('$s13ExampleModule3FooC3barSiyF')) # ExampleModule.Foo (class).bar() -> Int
```

Limits (against the official grammar): it does not handle the substitution table (starting at `A`), generic signatures (`G`), label lists, `E` extensions, or the `To`/`TE`/`Tg` suffixes — a complex symbol trusts `swift-demangle`. This decoder is for a quick hand read and for understanding the encoding order.

## 4. Locating reflection sections (the type-structure source of a stripped build)

```sh
otool -l sample | grep -A2 'sectname __swift5_proto'    # conformance 记录
otool -l sample | grep -A2 'sectname __swift5_protos'   # 协议描述符
otool -l sample | grep -A2 'sectname __swift5_fieldmd'  # 字段描述
otool -l sample | grep -A2 'sectname __swift5_types'    # 类型描述符
# ELF 侧
readelf -S sample | grep -i swift5
```

## 5. A byte sample (the shape of a symbol in the file)

```
$s4main6myFuncyyF 的 ASCII 字节（符号表字符串池内）：
24 73 34 6d 61 69 6e 36 6d 79 46 75 6e 63 79 79 46 00
 $  s  4  m  a  i  n  6  m  y  F  u  n  c  y  y  F \0
└前缀┘ └模块"main"┘ └函数名"myFunc"┘ └yyF 签名┘
```

Comparison point: a normal symbol ends in `\0` (inside the string table), but a symbol name that contains a symbolic reference embeds `\x01-\x1f` plus pointer bytes. Treating it as text with `strings` / `grep` truncates it — always extract from the symbol table (llvm-nm / readelf -s).

## Lessons (internalized)

- The decode order is "module → type context → entity name → signature", and inside the signature the result type comes before the parameters — when reading a symbol by hand, cut it in that order. Do not guess backwards
- Suffixes such as `_To` / `TA` / `Tg5` are entity modifiers. Strip them before reading the body
- The official test vectors (manglings.txt) are the best offline comparison set: any decoder or tool output can be checked against them

## Notes

- Extract symbols with a symbol-table tool, not with strings. A stripped build relies on the `__swift5_*` reflection sections (see pitfall 5 of SKILL.md)
- Use together with [[re-format-macho]] (section location) and [[re-cpp-abi]] (the vtable idea)
