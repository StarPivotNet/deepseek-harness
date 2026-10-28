"use strict";

const fs = require("fs");
const path = require("path");

const tables = JSON.parse(
  fs.readFileSync(path.join(__dirname, "qjs_tables.json"), "utf8")
);

const FIRST_ATOM = tables.first_atom;
const BUILTIN_ATOMS = tables.builtin_atoms;
const OPCODES = tables.opcodes;

const OPCODE_BY_NAME = {};
for (let i = 0; i < OPCODES.length; i++) {
  OPCODE_BY_NAME[OPCODES[i].name] = Object.assign({ op: i }, OPCODES[i]);
}

const BC_TAG = {
  NULL: 1,
  UNDEFINED: 2,
  BOOL_FALSE: 3,
  BOOL_TRUE: 4,
  INT32: 5,
  FLOAT64: 6,
  STRING: 7,
  OBJECT: 8,
  ARRAY: 9,
  BIG_INT: 10,
  BIG_FLOAT: 11,
  BIG_DECIMAL: 12,
  TEMPLATE_OBJECT: 13,
  FUNCTION_BYTECODE: 14,
  MODULE: 15,
  TYPED_ARRAY: 16,
  ARRAY_BUFFER: 17,
  SHARED_ARRAY_BUFFER: 18,
  DATE: 19,
  OBJECT_VALUE: 20,
  OBJECT_REFERENCE: 21,
};

const TAG_NAME = Object.fromEntries(
  Object.entries(BC_TAG).map(([k, v]) => [v, k])
);

const EXPORT_TYPE_LOCAL = 0;

class DecodeError extends Error {
  constructor(message, pos) {
    super(pos == null ? message : `${message} (pos=${pos})`);
    this.pos = pos;
  }
}

function encodeLeb128(v) {
  v = v >>> 0;
  const out = [];
  for (;;) {
    let a = v & 0x7f;
    v >>>= 7;
    if (v !== 0) out.push(a | 0x80);
    else {
      out.push(a);
      break;
    }
  }
  return Buffer.from(out);
}

function encodeSleb128(v1) {
  const v = v1 | 0;
  const u = ((v << 1) ^ (v >> 31)) >>> 0;
  return encodeLeb128(u);
}

function encodeJSString(text, wide) {
  if (wide) {
    const payload = Buffer.from(text, "utf16le");
    const len = text.length;
    return Buffer.concat([encodeLeb128((len << 1) | 1), payload]);
  }
  const payload = Buffer.from(text, "latin1");
  return Buffer.concat([encodeLeb128(payload.length << 1), payload]);
}

class Reader {
  constructor(buf, firstAtom) {
    this.buf = buf;
    this.pos = 0;
    this.firstAtom = firstAtom;
    this.atoms = [];
  }

  remain() {
    return this.buf.length - this.pos;
  }

  check(n) {
    if (this.pos + n > this.buf.length) {
      throw new DecodeError("read past end", this.pos);
    }
  }

  u8() {
    this.check(1);
    return this.buf[this.pos++];
  }

  u16() {
    this.check(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  u32() {
    this.check(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  u64() {
    this.check(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  f64() {
    this.check(8);
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  bytes(n) {
    this.check(n);
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(slice);
  }

  leb128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const a = this.u8();
      v |= (a & 0x7f) << (i * 7);
      if ((a & 0x80) === 0) return v >>> 0;
    }
    throw new DecodeError("invalid leb128", this.pos);
  }

  sleb128() {
    const u = this.leb128();
    return (u >>> 1) ^ -(u & 1);
  }

  readJSString() {
    const start = this.pos;
    const packed = this.leb128();
    const wide = (packed & 1) !== 0;
    const len = packed >>> 1;
    const size = wide ? len * 2 : len;
    const data = this.bytes(size);
    const text = wide ? data.toString("utf16le") : data.toString("latin1");
    return { text, wide, raw: this.buf.subarray(start, this.pos) };
  }

  resolveAtomIndex(idx) {
    if (idx & 0x80000000) {
      return { kind: "int", value: idx & 0x7fffffff };
    }
    if (idx < this.firstAtom) {
      return { kind: "builtin", index: idx, value: BUILTIN_ATOMS[idx] };
    }
    const custom = idx - this.firstAtom;
    if (custom < 0 || custom >= this.atoms.length) {
      throw new DecodeError(`invalid atom index ${idx}`, this.pos);
    }
    return {
      kind: "custom",
      index: idx,
      customIndex: custom,
      value: this.atoms[custom].text,
    };
  }

  atom() {
    const v = this.leb128();
    if (v & 1) {
      return { kind: "int", value: v >>> 1, encoded: v };
    }
    return { ...this.resolveAtomIndex(v >>> 1), encoded: v };
  }

  atomName(a) {
    if (a.kind === "int") return String(a.value);
    return a.value == null ? `#${a.index}` : a.value;
  }

  readObject() {
    const start = this.pos;
    const tag = this.u8();
    let value;
    switch (tag) {
      case BC_TAG.NULL:
        value = { type: "null" };
        break;
      case BC_TAG.UNDEFINED:
        value = { type: "undefined" };
        break;
      case BC_TAG.BOOL_FALSE:
        value = { type: "bool", value: false };
        break;
      case BC_TAG.BOOL_TRUE:
        value = { type: "bool", value: true };
        break;
      case BC_TAG.INT32:
        value = { type: "int32", value: this.sleb128() };
        break;
      case BC_TAG.FLOAT64:
        value = { type: "float64", value: this.f64() };
        break;
      case BC_TAG.STRING:
        value = { type: "string", ...this.readJSString() };
        break;
      case BC_TAG.OBJECT: {
        const count = this.leb128();
        const props = [];
        for (let i = 0; i < count; i++) {
          const name = this.atom();
          const val = this.readObject();
          props.push({ name, value: val });
        }
        value = { type: "object", props };
        break;
      }
      case BC_TAG.ARRAY:
      case BC_TAG.TEMPLATE_OBJECT: {
        const len = this.leb128();
        const items = [];
        for (let i = 0; i < len; i++) items.push(this.readObject());
        let raw = null;
        if (tag === BC_TAG.TEMPLATE_OBJECT) raw = this.readObject();
        value = {
          type: tag === BC_TAG.TEMPLATE_OBJECT ? "template" : "array",
          items,
          raw,
        };
        break;
      }
      case BC_TAG.FUNCTION_BYTECODE:
        value = this.readFunction(start);
        break;
      case BC_TAG.MODULE:
        value = this.readModule();
        break;
      case BC_TAG.TYPED_ARRAY: {
        const arrayTag = this.u8();
        const len = this.leb128();
        const offset = this.leb128();
        const buffer = this.readObject();
        value = { type: "typedarray", arrayTag, len, offset, buffer };
        break;
      }
      case BC_TAG.ARRAY_BUFFER: {
        const byteLength = this.leb128();
        value = { type: "arraybuffer", data: this.bytes(byteLength) };
        break;
      }
      case BC_TAG.SHARED_ARRAY_BUFFER: {
        const byteLength = this.leb128();
        const ptr = this.u64();
        value = { type: "sharedarraybuffer", byteLength, ptr: ptr.toString() };
        break;
      }
      case BC_TAG.DATE:
        value = { type: "date", value: this.readObject() };
        break;
      case BC_TAG.OBJECT_VALUE:
        value = { type: "object_value", value: this.readObject() };
        break;
      case BC_TAG.OBJECT_REFERENCE:
        value = { type: "object_reference", index: this.leb128() };
        break;
      case BC_TAG.BIG_INT:
      case BC_TAG.BIG_FLOAT:
      case BC_TAG.BIG_DECIMAL:
        throw new DecodeError(
          `bignum tag ${tag} not supported in BC_VERSION 1`,
          start
        );
      default:
        throw new DecodeError(
          `invalid tag ${tag} (${TAG_NAME[tag] || "?"})`,
          start
        );
    }
    value.tag = tag;
    value.start = start;
    value.end = this.pos;
    return value;
  }

  readFunction(_start) {
    const flags = this.u16();
    let idx = 0;
    const take = (n) => {
      const val = (flags >> idx) & ((1 << n) - 1);
      idx += n;
      return val;
    };
    const meta = {
      hasPrototype: take(1),
      hasSimpleParameterList: take(1),
      isDerivedClassConstructor: take(1),
      needHomeObject: take(1),
      funcKind: take(2),
      newTargetAllowed: take(1),
      superCallAllowed: take(1),
      superAllowed: take(1),
      argumentsAllowed: take(1),
      hasDebug: take(1),
      backtraceBarrier: take(1),
    };
    const jsMode = this.u8();
    const funcName = this.atom();
    const argCount = this.leb128();
    const varCount = this.leb128();
    const definedArgCount = this.leb128();
    const stackSize = this.leb128();
    const closureVarCount = this.leb128();
    const cpoolCount = this.leb128();
    const byteCodeLen = this.leb128();
    const localCount = this.leb128();
    const locals = [];
    for (let i = 0; i < localCount; i++) {
      const varName = this.atom();
      const scopeLevel = this.leb128();
      const scopeNext = this.leb128();
      const vflags = this.u8();
      locals.push({ varName, scopeLevel, scopeNext, flags: vflags });
    }
    const closures = [];
    for (let i = 0; i < closureVarCount; i++) {
      const varName = this.atom();
      const varIdx = this.leb128();
      const vflags = this.u8();
      closures.push({ varName, varIdx, flags: vflags });
    }
    const bytecode = this.bytes(byteCodeLen);
    let debug = null;
    if (meta.hasDebug) {
      const filename = this.atom();
      const lineNum = this.leb128();
      const pc2lineLen = this.leb128();
      const pc2line = this.bytes(pc2lineLen);
      debug = { filename, lineNum, pc2line };
    }
    const cpool = [];
    for (let i = 0; i < cpoolCount; i++) cpool.push(this.readObject());
    return {
      type: "function",
      flags,
      meta,
      jsMode,
      funcName,
      argCount,
      varCount,
      definedArgCount,
      stackSize,
      locals,
      closures,
      bytecode,
      debug,
      cpool,
    };
  }

  readModule() {
    const moduleName = this.atom();
    const reqCount = this.leb128();
    const reqModules = [];
    for (let i = 0; i < reqCount; i++) reqModules.push(this.atom());
    const exportCount = this.leb128();
    const exports_ = [];
    for (let i = 0; i < exportCount; i++) {
      const exportType = this.u8();
      let localVarIdx = null;
      let reqModuleIdx = null;
      let localName = null;
      if (exportType === EXPORT_TYPE_LOCAL) {
        localVarIdx = this.leb128();
      } else {
        reqModuleIdx = this.leb128();
        localName = this.atom();
      }
      const exportName = this.atom();
      exports_.push({
        exportType,
        localVarIdx,
        reqModuleIdx,
        localName,
        exportName,
      });
    }
    const starCount = this.leb128();
    const starExports = [];
    for (let i = 0; i < starCount; i++) starExports.push(this.leb128());
    const importCount = this.leb128();
    const imports = [];
    for (let i = 0; i < importCount; i++) {
      const varIdx = this.leb128();
      const importName = this.atom();
      const reqModuleIdx = this.leb128();
      imports.push({ varIdx, importName, reqModuleIdx });
    }
    const func = this.readObject();
    return {
      type: "module",
      moduleName,
      reqModules,
      exports: exports_,
      starExports,
      imports,
      func,
    };
  }
}

function parseJsc(buf, options = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const firstAtom = options.firstAtom || FIRST_ATOM;
  const r = new Reader(buf, firstAtom);
  const version = r.u8();
  if (version !== 1 && version !== 2) {
    throw new DecodeError(`unsupported BC_VERSION ${version}`, 0);
  }
  const atomCount = r.leb128();
  const atoms = [];
  for (let i = 0; i < atomCount; i++) atoms.push(r.readJSString());
  r.atoms = atoms;
  const objectOffset = r.pos;
  const root = r.readObject();
  if (r.pos !== buf.length) {
    throw new DecodeError(
      `trailing ${buf.length - r.pos} bytes after object`,
      r.pos
    );
  }
  return {
    version,
    firstAtom,
    atoms,
    objectOffset,
    root,
    buffer: buf,
  };
}

function rewriteAtoms(parsed, newAtoms) {
  const header = [Buffer.from([parsed.version]), encodeLeb128(newAtoms.length)];
  for (const atom of newAtoms) {
    if (atom.raw && atom.text === undefined) {
      header.push(atom.raw);
    } else {
      header.push(encodeJSString(atom.text, !!atom.wide));
    }
  }
  const objectBytes = parsed.buffer.subarray(parsed.objectOffset);
  return Buffer.concat([...header, objectBytes]);
}

function patchAtoms(parsed, replacements, options = {}) {
  const exact = options.exact !== false;
  const atoms = parsed.atoms.map((a) => ({ ...a }));
  const hits = [];
  for (const [from, to] of Object.entries(replacements)) {
    let n = 0;
    for (const atom of atoms) {
      if (exact ? atom.text === from : atom.text.includes(from)) {
        atom.text = exact ? to : atom.text.split(from).join(to);
        atom.wide = [...atom.text].some((ch) => ch.charCodeAt(0) > 255);
        atom.raw = null;
        n += 1;
      }
    }
    hits.push({ from, to, count: n });
  }
  return { buffer: rewriteAtoms(parsed, atoms), hits, atoms };
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  switch (node.type) {
    case "object":
      for (const p of node.props) walk(p.value, visit);
      break;
    case "array":
    case "template":
      for (const it of node.items) walk(it, visit);
      if (node.raw) walk(node.raw, visit);
      break;
    case "function":
      for (const c of node.cpool) walk(c, visit);
      break;
    case "module":
      walk(node.func, visit);
      break;
    case "date":
    case "object_value":
      walk(node.value, visit);
      break;
    case "typedarray":
      walk(node.buffer, visit);
      break;
    default:
      break;
  }
}

function collectStrings(parsed) {
  const out = [];
  parsed.atoms.forEach((a, i) => {
    out.push({ kind: "atom", index: i, atomId: parsed.firstAtom + i, value: a.text, wide: a.wide });
  });
  walk(parsed.root, (node) => {
    if (node.type === "string") {
      out.push({ kind: "string", start: node.start, value: node.text, wide: node.wide });
    }
  });
  return out;
}

function collectFunctions(parsed) {
  const fns = [];
  walk(parsed.root, (node) => {
    if (node.type === "function") fns.push(node);
  });
  return fns;
}

function resolveBcAtom(parsed, idx) {
  if (idx & 0x80000000) return `int:${idx & 0x7fffffff}`;
  if (idx < parsed.firstAtom) {
    const s = BUILTIN_ATOMS[idx];
    return s == null ? `builtin:${idx}` : JSON.stringify(s);
  }
  const custom = idx - parsed.firstAtom;
  const atom = parsed.atoms[custom];
  return atom ? JSON.stringify(atom.text) : `atom:${idx}`;
}

function disassembleFunction(parsed, fn) {
  const bc = fn.bytecode;
  const lines = [];
  let pos = 0;
  while (pos < bc.length) {
    const op = bc[pos];
    const info = OPCODES[op];
    if (!info) {
      lines.push({ pc: pos, op, name: `?${op}`, raw: [op] });
      break;
    }
    if (pos + info.size > bc.length) {
      throw new DecodeError(
        `opcode ${info.name} truncated at ${pos}`,
        fn.start
      );
    }
    const raw = [...bc.subarray(pos, pos + info.size)];
    const args = decodeOperands(parsed, fn, bc, pos, info);
    lines.push({ pc: pos, op, name: info.name, fmt: info.fmt, size: info.size, args, raw });
    pos += info.size;
  }
  if (pos !== bc.length) {
    throw new DecodeError(`bytecode not consumed ${pos}/${bc.length}`, fn.start);
  }
  return lines;
}

function u16at(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}
function i16at(buf, off) {
  const v = u16at(buf, off);
  return v & 0x8000 ? v - 0x10000 : v;
}
function u32at(buf, off) {
  return (
    (buf[off] |
      (buf[off + 1] << 8) |
      (buf[off + 2] << 16) |
      (buf[off + 3] << 24)) >>>
    0
  );
}
function i32at(buf, off) {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}
function i8at(buf, off) {
  const v = buf[off];
  return v & 0x80 ? v - 256 : v;
}

function decodeOperands(parsed, fn, bc, pos, info) {
  const a = {};
  switch (info.fmt) {
    case "none":
    case "none_int":
    case "none_loc":
    case "none_arg":
    case "none_var_ref":
    case "npopx":
      break;
    case "u8":
    case "const8":
    case "loc8":
      a.imm = bc[pos + 1];
      break;
    case "i8":
    case "label8":
      a.imm = i8at(bc, pos + 1);
      break;
    case "u16":
    case "npop":
    case "loc":
    case "arg":
    case "var_ref":
      a.imm = u16at(bc, pos + 1);
      break;
    case "i16":
    case "label16":
      a.imm = i16at(bc, pos + 1);
      break;
    case "u32":
      a.imm = u32at(bc, pos + 1);
      break;
    case "i32":
    case "label":
      a.imm = i32at(bc, pos + 1);
      break;
    case "const":
      a.constIndex = u32at(bc, pos + 1);
      break;
    case "atom":
      a.atom = u32at(bc, pos + 1);
      a.atomName = resolveBcAtom(parsed, a.atom);
      break;
    case "atom_u8":
      a.atom = u32at(bc, pos + 1);
      a.atomName = resolveBcAtom(parsed, a.atom);
      a.imm = bc[pos + 5];
      break;
    case "atom_u16":
      a.atom = u32at(bc, pos + 1);
      a.atomName = resolveBcAtom(parsed, a.atom);
      a.imm = u16at(bc, pos + 5);
      break;
    case "atom_label_u8":
      a.atom = u32at(bc, pos + 1);
      a.atomName = resolveBcAtom(parsed, a.atom);
      a.label = i32at(bc, pos + 5);
      a.imm = bc[pos + 9];
      break;
    case "atom_label_u16":
      a.atom = u32at(bc, pos + 1);
      a.atomName = resolveBcAtom(parsed, a.atom);
      a.label = i32at(bc, pos + 5);
      a.imm = u16at(bc, pos + 9);
      break;
    case "label_u16":
      a.label = i32at(bc, pos + 1);
      a.imm = u16at(bc, pos + 5);
      break;
    case "npop_u16":
      a.n = u16at(bc, pos + 1);
      a.imm = u16at(bc, pos + 3);
      break;
    default:
      a.raw = [...bc.subarray(pos + 1, pos + info.size)];
  }
  if (info.fmt === "const" || info.fmt === "const8") {
    const idx = info.fmt === "const8" ? a.imm : a.constIndex;
    if (idx != null && fn.cpool[idx]) a.constPreview = summarize(fn.cpool[idx]);
  }
  return a;
}

function summarize(node) {
  if (!node) return null;
  switch (node.type) {
    case "null":
    case "undefined":
      return node.type;
    case "bool":
    case "int32":
    case "float64":
      return node.value;
    case "string":
      return node.text;
    case "function":
      return `<function ${atomText(node.funcName)}>`;
    case "module":
      return `<module ${atomText(node.moduleName)}>`;
    case "object":
      return `<object ${node.props.length}>`;
    case "array":
      return `<array ${node.items.length}>`;
    default:
      return `<${node.type}>`;
  }
}

function atomText(a) {
  if (!a) return "";
  if (a.kind === "int") return String(a.value);
  return a.value == null ? "" : a.value;
}

function resolveBcAtomName(parsed, idx) {
  if (idx & 0x80000000) return String(idx & 0x7fffffff);
  if (idx < parsed.firstAtom) {
    const s = BUILTIN_ATOMS[idx];
    return s == null ? `builtin:${idx}` : s;
  }
  const custom = idx - parsed.firstAtom;
  const atom = parsed.atoms[custom];
  return atom ? atom.text : `atom:${idx}`;
}

function cloneAtom(a) {
  if (!a) return a;
  return { ...a };
}

function asBuffer(x) {
  if (!x) return Buffer.alloc(0);
  if (Buffer.isBuffer(x)) return x;
  if (x.type === "Buffer" && Array.isArray(x.data)) return Buffer.from(x.data);
  if (Array.isArray(x)) return Buffer.from(x);
  return Buffer.from(x);
}

function nodeToIR(parsed, node) {
  if (!node || typeof node !== "object") return node;
  switch (node.type) {
    case "null":
    case "undefined":
      return { type: node.type };
    case "bool":
    case "int32":
    case "float64":
      return { type: node.type, value: node.value };
    case "string":
      return { type: "string", text: node.text, wide: !!node.wide };
    case "object":
      return {
        type: "object",
        props: node.props.map((p) => ({
          name: cloneAtom(p.name),
          value: nodeToIR(parsed, p.value),
        })),
      };
    case "array":
    case "template":
      return {
        type: node.type,
        items: node.items.map((it) => nodeToIR(parsed, it)),
        raw: node.raw ? nodeToIR(parsed, node.raw) : null,
      };
    case "function":
      return functionToIR(parsed, node);
    case "module":
      return {
        type: "module",
        moduleName: cloneAtom(node.moduleName),
        reqModules: node.reqModules.map(cloneAtom),
        exports: node.exports.map((e) => ({
          exportType: e.exportType,
          localVarIdx: e.localVarIdx,
          reqModuleIdx: e.reqModuleIdx,
          localName: cloneAtom(e.localName),
          exportName: cloneAtom(e.exportName),
        })),
        starExports: node.starExports.slice(),
        imports: node.imports.map((im) => ({
          varIdx: im.varIdx,
          importName: cloneAtom(im.importName),
          reqModuleIdx: im.reqModuleIdx,
        })),
        func: nodeToIR(parsed, node.func),
      };
    case "typedarray":
      return {
        type: "typedarray",
        arrayTag: node.arrayTag,
        len: node.len,
        offset: node.offset,
        buffer: nodeToIR(parsed, node.buffer),
      };
    case "arraybuffer":
      return { type: "arraybuffer", data: Buffer.from(node.data) };
    case "sharedarraybuffer":
      return {
        type: "sharedarraybuffer",
        byteLength: node.byteLength,
        ptr: node.ptr,
      };
    case "date":
    case "object_value":
      return { type: node.type, value: nodeToIR(parsed, node.value) };
    case "object_reference":
      return { type: "object_reference", index: node.index };
    default:
      throw new DecodeError(`cannot convert type ${node.type} to IR`);
  }
}

function functionToIR(parsed, fn) {
  const lines = disassembleFunction(parsed, fn);
  const ops = lines.map((line) => {
    const args = { ...line.args };
    delete args.constPreview;
    if (line.fmt === "label8" || line.fmt === "label16" || line.fmt === "label") {
      args.label = (line.pc + 1) + args.imm;
      delete args.imm;
    } else if (line.fmt === "atom_label_u8" || line.fmt === "atom_label_u16") {
      args.label = (line.pc + 5) + args.label;
    } else if (line.fmt === "label_u16") {
      args.label = (line.pc + 1) + args.label;
    }
    if (args.atom != null) args.atomName = resolveBcAtomName(parsed, args.atom);
    return {
      pc: line.pc,
      op: line.op,
      name: line.name,
      fmt: line.fmt,
      size: line.size,
      ...args,
    };
  });
  return {
    type: "function",
    flags: fn.flags,
    meta: { ...fn.meta },
    jsMode: fn.jsMode,
    funcName: cloneAtom(fn.funcName),
    argCount: fn.argCount,
    varCount: fn.varCount,
    definedArgCount: fn.definedArgCount,
    stackSize: fn.stackSize,
    locals: fn.locals.map((l) => ({
      varName: cloneAtom(l.varName),
      scopeLevel: l.scopeLevel,
      scopeNext: l.scopeNext,
      flags: l.flags,
    })),
    closures: fn.closures.map((c) => ({
      varName: cloneAtom(c.varName),
      varIdx: c.varIdx,
      flags: c.flags,
    })),
    ops,
    debug: fn.debug
      ? {
          filename: cloneAtom(fn.debug.filename),
          lineNum: fn.debug.lineNum,
          pc2line: Buffer.from(fn.debug.pc2line),
        }
      : null,
    cpool: fn.cpool.map((c) => nodeToIR(parsed, c)),
  };
}

function toIR(parsed) {
  return {
    format: "aiot-jsc-ir",
    irVersion: 1,
    bcVersion: parsed.version,
    firstAtom: parsed.firstAtom,
    atoms: parsed.atoms.map((a) => ({ text: a.text, wide: !!a.wide })),
    root: nodeToIR(parsed, parsed.root),
  };
}

function writeU8(v) {
  return Buffer.from([v & 0xff]);
}

function writeU16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
}

function writeU32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function writeI32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v | 0, 0);
  return b;
}

function writeF64(v) {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v, 0);
  return b;
}

function writeU64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(typeof v === "bigint" ? v : BigInt(v));
  return b;
}

function flagsFromMeta(meta) {
  if (!meta) return 0;
  let flags = 0;
  let idx = 0;
  const set = (val, n) => {
    flags |= (val & ((1 << n) - 1)) << idx;
    idx += n;
  };
  set(meta.hasPrototype, 1);
  set(meta.hasSimpleParameterList, 1);
  set(meta.isDerivedClassConstructor, 1);
  set(meta.needHomeObject, 1);
  set(meta.funcKind, 2);
  set(meta.newTargetAllowed, 1);
  set(meta.superCallAllowed, 1);
  set(meta.superAllowed, 1);
  set(meta.argumentsAllowed, 1);
  set(meta.hasDebug, 1);
  set(meta.backtraceBarrier, 1);
  return flags;
}

function writeAtom(atom, firstAtom) {
  if (!atom) throw new DecodeError("missing atom");
  let v;
  if (atom.encoded != null) v = atom.encoded >>> 0;
  else if (atom.kind === "int") v = ((atom.value << 1) | 1) >>> 0;
  else if (atom.kind === "builtin") v = (atom.index << 1) >>> 0;
  else if (atom.kind === "custom") {
    const idx =
      atom.index != null ? atom.index : firstAtom + (atom.customIndex || 0);
    v = (idx << 1) >>> 0;
  } else if (atom.index != null) v = (atom.index << 1) >>> 0;
  else throw new DecodeError(`cannot encode atom ${atomText(atom)}`);
  return encodeLeb128(v);
}

function opInfo(op) {
  if (op.name && OPCODE_BY_NAME[op.name]) return OPCODE_BY_NAME[op.name];
  if (op.op != null && OPCODES[op.op]) {
    return Object.assign({ op: op.op }, OPCODES[op.op]);
  }
  throw new DecodeError(`unknown opcode ${op.name} ${op.op}`);
}

function opField(op, key) {
  if (op[key] !== undefined) return op[key];
  if (op.args && op.args[key] !== undefined) return op.args[key];
  return undefined;
}

function writeOperands(buf, pc, info, op) {
  const imm = opField(op, "imm");
  const atom = opField(op, "atom");
  const label = opField(op, "label");
  const constIndex = opField(op, "constIndex");
  const n = opField(op, "n");
  switch (info.fmt) {
    case "none":
    case "none_int":
    case "none_loc":
    case "none_arg":
    case "none_var_ref":
    case "npopx":
      break;
    case "u8":
    case "const8":
    case "loc8":
      buf[pc + 1] = imm & 0xff;
      break;
    case "i8":
      buf.writeInt8(imm, pc + 1);
      break;
    case "label8": {
      const rel = label != null ? label - (pc + 1) : imm;
      buf.writeInt8(rel, pc + 1);
      break;
    }
    case "u16":
    case "npop":
    case "loc":
    case "arg":
    case "var_ref":
      buf.writeUInt16LE(imm, pc + 1);
      break;
    case "i16":
      buf.writeInt16LE(imm, pc + 1);
      break;
    case "label16": {
      const rel = label != null ? label - (pc + 1) : imm;
      buf.writeInt16LE(rel, pc + 1);
      break;
    }
    case "u32":
      buf.writeUInt32LE(imm >>> 0, pc + 1);
      break;
    case "i32":
      buf.writeInt32LE(imm | 0, pc + 1);
      break;
    case "label": {
      const rel = label != null ? label - (pc + 1) : imm;
      buf.writeInt32LE(rel, pc + 1);
      break;
    }
    case "const":
      buf.writeUInt32LE((constIndex != null ? constIndex : imm) >>> 0, pc + 1);
      break;
    case "atom":
      buf.writeUInt32LE(atom >>> 0, pc + 1);
      break;
    case "atom_u8":
      buf.writeUInt32LE(atom >>> 0, pc + 1);
      buf[pc + 5] = imm & 0xff;
      break;
    case "atom_u16":
      buf.writeUInt32LE(atom >>> 0, pc + 1);
      buf.writeUInt16LE(imm, pc + 5);
      break;
    case "atom_label_u8": {
      buf.writeUInt32LE(atom >>> 0, pc + 1);
      const rel = label != null ? label - (pc + 5) : imm;
      buf.writeInt32LE(rel, pc + 5);
      buf[pc + 9] = opField(op, "imm") & 0xff;
      break;
    }
    case "atom_label_u16": {
      buf.writeUInt32LE(atom >>> 0, pc + 1);
      const rel = label != null ? label - (pc + 5) : 0;
      buf.writeInt32LE(rel, pc + 5);
      buf.writeUInt16LE(imm, pc + 9);
      break;
    }
    case "label_u16": {
      const rel = label != null ? label - (pc + 1) : 0;
      buf.writeInt32LE(rel, pc + 1);
      buf.writeUInt16LE(imm, pc + 5);
      break;
    }
    case "npop_u16":
      buf.writeUInt16LE(n, pc + 1);
      buf.writeUInt16LE(imm, pc + 3);
      break;
    default:
      throw new DecodeError(`unhandled opcode fmt ${info.fmt}`);
  }
}

function stripAtomName(name) {
  if (name == null) return "";
  const s = String(name);
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return JSON.parse(s);
    } catch (_err) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function resolveAtomFromName(parsedOrIr, name) {
  const text = stripAtomName(name);
  if (text === "") throw new DecodeError("empty atom name");
  const firstAtom = parsedOrIr.firstAtom || FIRST_ATOM;
  const atoms = parsedOrIr.atoms || [];
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i] && atoms[i].text === text) return firstAtom + i;
  }
  const bi = BUILTIN_ATOMS.indexOf(text);
  if (bi >= 0) return bi;
  throw new DecodeError(`unknown atom name ${text}`);
}

function fillOpAtoms(fn, ctx) {
  if (!fn || !fn.ops) return;
  for (const op of fn.ops) {
    const info = opInfo(op);
    if (!info.fmt || info.fmt.indexOf("atom") !== 0) continue;
    if (op.atom == null && op.atomName != null) {
      op.atom = resolveAtomFromName(ctx, op.atomName);
    }
  }
}

function fillIrAtoms(ir) {
  const ctx = { firstAtom: ir.firstAtom || FIRST_ATOM, atoms: ir.atoms || [] };
  walk(ir.root, (node) => {
    if (node && node.type === "function") fillOpAtoms(node, ctx);
  });
}

function estimateStackSize(ops) {
  if (!ops || !ops.length) return 1;
  let sp = 0;
  let max = 0;
  for (const op of ops) {
    const info = opInfo(op);
    sp -= info.pop || 0;
    if (sp < 0) sp = 0;
    sp += info.push || 0;
    if (sp > max) max = sp;
  }
  return Math.max(1, max);
}

function windowStack(ops) {
  let net = 0;
  let min = 0;
  let pops = 0;
  for (const op of ops) {
    const info = opInfo(op);
    pops += info.pop || 0;
    net -= info.pop || 0;
    if (net < min) min = net;
    net += info.push || 0;
  }
  return { net, min, pops };
}

function falseProducerOps(count) {
  if ((count & 1) === 0) {
    throw new DecodeError(`false producer needs an odd length, got ${count}`);
  }
  const ops = [];
  for (let i = 0; i < count - 1; i += 2) {
    ops.push({ name: "push_0" });
    ops.push({ name: "drop" });
  }
  ops.push({ name: "push_0" });
  return ops;
}

function spliceWindow(parsed, selector, spec) {
  spec = spec || {};
  const hit = selectFunction(parsed, selector);
  const fn = hit.fn;
  const ops = functionOps(parsed, fn).map((op) => Object.assign({}, op, op.args ? { args: Object.assign({}, op.args) } : {}));
  const from = Number(spec.from);
  const count = Number(spec.count);
  if (!Number.isInteger(from) || from < 0 || from >= ops.length) {
    throw new DecodeError(`splice from ${spec.from} outside 0..${ops.length - 1}`);
  }
  if (!Number.isInteger(count) || count < 1 || from + count > ops.length) {
    throw new DecodeError(`splice count ${spec.count} does not fit at ${from}`);
  }
  const oldWindow = ops.slice(from, from + count);
  const oldStack = windowStack(oldWindow);
  if (oldStack.pops < 1 || oldStack.min < 0 || oldStack.net !== 1) {
    throw new DecodeError(`splice window must pop, stay at or above its start, and finish at +1, got pops ${oldStack.pops} min ${oldStack.min} net ${oldStack.net}`);
  }
  let replacement;
  if (spec.kind === "false" || spec.false === true) {
    replacement = falseProducerOps(count);
  } else {
    throw new DecodeError("splice only supports --false");
  }
  const newStack = windowStack(replacement);
  if (newStack.net !== oldStack.net) {
    throw new DecodeError(`splice stack ${oldStack.net} -> ${newStack.net}`);
  }
  ops.splice(from, count, ...replacement);
  commitFunctionOps(parsed, fn, ops);
  return {
    buffer: assembledBuffer(parsed),
    function: {
      funcName: hit.funcName,
      methodName: hit.methodName,
      index: hit.index,
      from,
      count,
      oldNet: oldStack.net,
      newNet: newStack.net,
      replaced: oldWindow.map((op) => op.name),
      ops: ops.map((op) => op.name),
    },
  };
}

function stackSizeFor(node) {
  if (node && node.stackSize != null) return node.stackSize;
  return estimateStackSize((node && node.ops) || []);
}

function functionOps(parsed, fn) {
  if (fn.ops && fn.ops.length) return fn.ops;
  if (fn.bytecode) return disassembleFunction(parsed, fn);
  return [];
}

function opAtomName(op) {
  if (!op) return "";
  if (op.atomName != null) return stripAtomName(op.atomName);
  if (op.args && op.args.atomName != null) return stripAtomName(op.args.atomName);
  return "";
}

function opConstIndex(op) {
  const args = op.args || op;
  if (args.constIndex != null) return args.constIndex;
  if (op.fmt === "const8" || (op.args && op.args.imm != null && op.name === "fclosure8")) return args.imm;
  return args.constIndex;
}

function walkFunctionsWithParent(node, parent, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type === "function") {
    visit(node, parent);
    for (const c of node.cpool || []) walkFunctionsWithParent(c, node, visit);
    return;
  }
  if (node.type === "module") {
    walkFunctionsWithParent(node.func, null, visit);
    return;
  }
  if (node.type === "object") {
    for (const p of node.props || []) walkFunctionsWithParent(p.value, parent, visit);
    return;
  }
  if (node.type === "array" || node.type === "template") {
    for (const it of node.items || []) walkFunctionsWithParent(it, parent, visit);
    if (node.raw) walkFunctionsWithParent(node.raw, parent, visit);
    return;
  }
  if (node.type === "date" || node.type === "object_value") {
    walkFunctionsWithParent(node.value, parent, visit);
    return;
  }
  if (node.type === "typedarray") walkFunctionsWithParent(node.buffer, parent, visit);
}

function methodNameFromParent(parsed, parent, child) {
  if (!parent || !parent.cpool) return "";
  const idx = parent.cpool.indexOf(child);
  if (idx < 0) return "";
  const lines = functionOps(parsed, parent);
  let lastConst = -1;
  for (const line of lines) {
    const name = line.name;
    if (name === "fclosure" || name === "push_const" || name === "fclosure8") {
      const ci = opConstIndex(line);
      if (ci != null) lastConst = ci;
    }
    if (name === "define_method" || name === "define_func" || name === "define_class") {
      if (lastConst === idx) return opAtomName(line);
    }
  }
  return "";
}

function findFunctions(parsed, query) {
  query = query || {};
  const hits = [];
  const root = parsed.root || parsed;
  walkFunctionsWithParent(root, null, (fn, parent) => {
    const lines = functionOps(parsed, fn);
    const names = lines.map((l) => l.name);
    const atoms = [];
    for (const l of lines) {
      const an = opAtomName(l);
      if (an) atoms.push(an);
    }
    hits.push({
      index: hits.length,
      funcName: atomText(fn.funcName),
      methodName: methodNameFromParent(parsed, parent, fn),
      argCount: fn.argCount,
      varCount: fn.varCount,
      async: names.indexOf("return_async") >= 0 || names.indexOf("await") >= 0,
      atoms,
      opsSummary: names.join(","),
      fn,
    });
  });
  const atomQ = query.atom
    ? String(query.atom)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const fnQ = query.fn != null ? String(query.fn) : "";
  const contains = !!query.contains;
  return hits.filter((h) => {
    if (fnQ) {
      const exact = h.funcName === fnQ || h.methodName === fnQ;
      const fuzzy =
        (h.funcName && h.funcName.indexOf(fnQ) >= 0) ||
        (h.methodName && h.methodName.indexOf(fnQ) >= 0);
      if (!(contains ? exact || fuzzy : exact)) return false;
    }
    if (atomQ.length) {
      const set = new Set(h.atoms);
      for (const a of atomQ) {
        if (!set.has(a)) return false;
      }
    }
    if (query.index != null && query.index !== "" && Number(query.index) !== h.index) return false;
    return true;
  });
}

function selectFunction(parsed, selector) {
  if (selector && selector.index != null && selector.fn == null && selector.atom == null) {
    const all = findFunctions(parsed);
    const hit = all[selector.index];
    if (!hit) throw new DecodeError(`function index ${selector.index} not found`);
    return hit;
  }
  const hits = findFunctions(parsed, selector || {});
  if (hits.length !== 1) {
    throw new DecodeError(
      `function selector matched ${hits.length} functions` +
        (selector && selector.fn ? ` fn=${selector.fn}` : "") +
        (selector && selector.atom ? ` atom=${selector.atom}` : "")
    );
  }
  return hits[0];
}

function findAtomInFn(parsed, fn, name) {
  const want = stripAtomName(name);
  const lines = functionOps(parsed, fn);
  for (const l of lines) {
    if (opAtomName(l) === want) {
      if (l.atom != null) return l.atom;
      if (l.args && l.args.atom != null) return l.args.atom;
    }
  }
  return resolveAtomFromName(parsed, want);
}

function booleanReturnOps(value, async) {
  if (async) {
    return [{ name: value ? "push_true" : "push_false" }, { name: "return_async" }];
  }
  return [
    { name: value ? "push_0" : "push_1" },
    { name: "lnot" },
    { name: "return" },
  ];
}

function setFieldOps(parsed, fn, fieldPath, value, async) {
  const parts = String(fieldPath)
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new DecodeError("empty setField path");
  const ops = [];
  if ((fn.varCount || 0) >= 1) {
    ops.push({ name: "push_this" });
    ops.push({ name: "put_loc0" });
    ops.push({ name: "get_loc0" });
  } else {
    ops.push({ name: "push_this" });
  }
  for (let i = 0; i < parts.length - 1; i++) {
    const atom = findAtomInFn(parsed, fn, parts[i]);
    ops.push({ name: "get_field", atom, atomName: parts[i] });
  }
  ops.push({ name: value ? "push_true" : "push_false" });
  const last = parts[parts.length - 1];
  ops.push({
    name: "put_field",
    atom: findAtomInFn(parsed, fn, last),
    atomName: last,
  });
  ops.push({ name: "undefined" });
  ops.push({ name: async ? "return_async" : "return" });
  return ops;
}

function commitFunctionOps(parsed, fn, ops) {
  const ctx = { firstAtom: parsed.firstAtom || FIRST_ATOM, atoms: parsed.atoms || [] };
  fn.ops = ops;
  fillOpAtoms(fn, ctx);
  fn.stackSize = estimateStackSize(ops);
  fn.bytecode = assembleBytecode(fn);
}

function assembledBuffer(parsed) {
  if (parsed && parsed.format === "aiot-jsc-ir") return assembleJsc(parsed);
  return assembleJsc(toIR(parsed));
}

function stubFunction(parsed, selector, spec) {
  spec = spec || {};
  const hit = selectFunction(parsed, selector);
  const fn = hit.fn;
  const async = !!(spec.async || hit.async);
  let field = spec.setField;
  let fieldValue = spec.value;
  if (typeof field === "string" && field.indexOf("=") >= 0) {
    const eq = field.split("=");
    field = eq[0];
    fieldValue = eq.slice(1).join("=") !== "false";
  }
  if (fieldValue == null) fieldValue = spec.false !== true && spec.kind !== "false";
  let ops;
  if (field) {
    ops = setFieldOps(parsed, fn, field, fieldValue, async);
  } else {
    const truthy = spec.kind === "true" || spec.true === true || (spec.kind !== "false" && spec.false !== true);
    ops = booleanReturnOps(truthy, async);
  }
  commitFunctionOps(parsed, fn, ops);
  return {
    buffer: assembledBuffer(parsed),
    function: {
      funcName: hit.funcName,
      methodName: hit.methodName,
      async,
      ops: ops.map((o) => o.name),
    },
  };
}

function patchBooleanProducer(ops, defineIdx, value) {
  let k = defineIdx - 1;
  if (k >= 0 && ops[k].name === "lnot") {
    const p = ops[k - 1];
    if (p && (p.name === "push_0" || p.name === "push_1")) {
      p.name = value ? "push_0" : "push_1";
      delete p.op;
      return;
    }
  }
  if (k >= 0) {
    const p = ops[k];
    if (p.name === "push_true" || p.name === "push_false" || p.name === "push_0" || p.name === "push_1") {
      p.name = value ? "push_0" : "push_1";
      delete p.op;
      if (!ops[k + 1] || ops[k + 1].name !== "lnot") {
        ops.splice(k + 1, 0, { name: "lnot" });
      }
      return;
    }
  }
  ops.splice(defineIdx, 0, { name: value ? "push_0" : "push_1" }, { name: "lnot" });
}

function patchDefineField(parsed, spec) {
  spec = spec || {};
  const want = stripAtomName(spec.atom || spec.fn);
  if (!want) throw new DecodeError("patchDefineField requires atom");
  const value = spec.value !== false && spec.false !== true && spec.kind !== "false";
  let n = 0;
  for (const hit of findFunctions(parsed)) {
    const fn = hit.fn;
    const ops = functionOps(parsed, fn).map((op) => {
      if (op.args) {
        return {
          name: op.name,
          op: op.op,
          atom: op.atom != null ? op.atom : op.args.atom,
          atomName: op.atomName || op.args.atomName,
          imm: op.imm != null ? op.imm : op.args.imm,
          label: op.label != null ? op.label : op.args.label,
          constIndex: op.constIndex != null ? op.constIndex : op.args.constIndex,
        };
      }
      return { ...op };
    });
    let changed = false;
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].name === "define_field" && opAtomName(ops[i]) === want) {
        patchBooleanProducer(ops, i, value);
        changed = true;
        n += 1;
      }
    }
    if (changed) commitFunctionOps(parsed, fn, ops);
  }
  if (!n) throw new DecodeError(`define_field ${want} not found`);
  return { count: n, buffer: assembledBuffer(parsed) };
}

function assembleBytecode(fn) {
  const ops = fn.ops;
  if (!ops || !ops.length) {
    // toIR always emits ops, so identity round-trip never uses this memcpy fallback.
    if (fn.bytecode) return asBuffer(fn.bytecode);
    return Buffer.alloc(0);
  }
  let pc = 0;
  const infos = [];
  for (const op of ops) {
    const info = opInfo(op);
    infos.push(info);
    pc += info.size;
  }
  const buf = Buffer.alloc(pc);
  pc = 0;
  for (let i = 0; i < ops.length; i++) {
    const info = infos[i];
    buf[pc] = info.op;
    writeOperands(buf, pc, info, ops[i]);
    pc += info.size;
  }
  return buf;
}

function writeObject(node, firstAtom) {
  if (!node || typeof node !== "object") {
    throw new DecodeError("invalid IR node");
  }
  switch (node.type) {
    case "null":
      return writeU8(BC_TAG.NULL);
    case "undefined":
      return writeU8(BC_TAG.UNDEFINED);
    case "bool":
      return writeU8(node.value ? BC_TAG.BOOL_TRUE : BC_TAG.BOOL_FALSE);
    case "int32":
      return Buffer.concat([writeU8(BC_TAG.INT32), encodeSleb128(node.value)]);
    case "float64":
      return Buffer.concat([writeU8(BC_TAG.FLOAT64), writeF64(node.value)]);
    case "string":
      return Buffer.concat([
        writeU8(BC_TAG.STRING),
        encodeJSString(node.text, !!node.wide),
      ]);
    case "object": {
      const parts = [writeU8(BC_TAG.OBJECT), encodeLeb128(node.props.length)];
      for (const p of node.props) {
        parts.push(writeAtom(p.name, firstAtom));
        parts.push(writeObject(p.value, firstAtom));
      }
      return Buffer.concat(parts);
    }
    case "array":
    case "template": {
      const tag = node.type === "template" ? BC_TAG.TEMPLATE_OBJECT : BC_TAG.ARRAY;
      const parts = [writeU8(tag), encodeLeb128(node.items.length)];
      for (const it of node.items) parts.push(writeObject(it, firstAtom));
      if (node.type === "template") {
        parts.push(writeObject(node.raw, firstAtom));
      }
      return Buffer.concat(parts);
    }
    case "function":
      return writeFunction(node, firstAtom);
    case "module":
      return writeModule(node, firstAtom);
    case "typedarray":
      return Buffer.concat([
        writeU8(BC_TAG.TYPED_ARRAY),
        writeU8(node.arrayTag),
        encodeLeb128(node.len),
        encodeLeb128(node.offset),
        writeObject(node.buffer, firstAtom),
      ]);
    case "arraybuffer": {
      const data = asBuffer(node.data);
      return Buffer.concat([
        writeU8(BC_TAG.ARRAY_BUFFER),
        encodeLeb128(data.length),
        data,
      ]);
    }
    case "sharedarraybuffer":
      return Buffer.concat([
        writeU8(BC_TAG.SHARED_ARRAY_BUFFER),
        encodeLeb128(node.byteLength),
        writeU64(node.ptr),
      ]);
    case "date":
      return Buffer.concat([
        writeU8(BC_TAG.DATE),
        writeObject(node.value, firstAtom),
      ]);
    case "object_value":
      return Buffer.concat([
        writeU8(BC_TAG.OBJECT_VALUE),
        writeObject(node.value, firstAtom),
      ]);
    case "object_reference":
      return Buffer.concat([
        writeU8(BC_TAG.OBJECT_REFERENCE),
        encodeLeb128(node.index),
      ]);
    default:
      throw new DecodeError(`cannot assemble type ${node.type}`);
  }
}

function writeFunction(node, firstAtom) {
  const flags =
    node.flags != null ? node.flags : flagsFromMeta(node.meta || {});
  const locals = node.locals || [];
  const closures = node.closures || [];
  const cpool = node.cpool || [];
  const bc = assembleBytecode(node);
  const parts = [
    writeU8(BC_TAG.FUNCTION_BYTECODE),
    writeU16(flags),
    writeU8(node.jsMode),
    writeAtom(node.funcName, firstAtom),
    encodeLeb128(node.argCount),
    encodeLeb128(node.varCount),
    encodeLeb128(node.definedArgCount),
    encodeLeb128(stackSizeFor(node)),
    encodeLeb128(closures.length),
    encodeLeb128(cpool.length),
    encodeLeb128(bc.length),
    encodeLeb128(locals.length),
  ];
  for (const l of locals) {
    parts.push(writeAtom(l.varName, firstAtom));
    parts.push(encodeLeb128(l.scopeLevel));
    parts.push(encodeLeb128(l.scopeNext));
    parts.push(writeU8(l.flags));
  }
  for (const c of closures) {
    parts.push(writeAtom(c.varName, firstAtom));
    parts.push(encodeLeb128(c.varIdx));
    parts.push(writeU8(c.flags));
  }
  parts.push(bc);
  const hasDebug = node.meta ? node.meta.hasDebug : !!node.debug;
  if (hasDebug && node.debug) {
    const pc2 = asBuffer(node.debug.pc2line);
    parts.push(writeAtom(node.debug.filename, firstAtom));
    parts.push(encodeLeb128(node.debug.lineNum));
    parts.push(encodeLeb128(pc2.length));
    parts.push(pc2);
  }
  for (const c of cpool) parts.push(writeObject(c, firstAtom));
  return Buffer.concat(parts);
}

function writeModule(node, firstAtom) {
  const parts = [
    writeU8(BC_TAG.MODULE),
    writeAtom(node.moduleName, firstAtom),
    encodeLeb128(node.reqModules.length),
  ];
  for (const req of node.reqModules) parts.push(writeAtom(req, firstAtom));
  const exports_ = node.exports || [];
  parts.push(encodeLeb128(exports_.length));
  for (const e of exports_) {
    parts.push(writeU8(e.exportType));
    if (e.exportType === EXPORT_TYPE_LOCAL) {
      parts.push(encodeLeb128(e.localVarIdx));
    } else {
      parts.push(encodeLeb128(e.reqModuleIdx));
      parts.push(writeAtom(e.localName, firstAtom));
    }
    parts.push(writeAtom(e.exportName, firstAtom));
  }
  const stars = node.starExports || [];
  parts.push(encodeLeb128(stars.length));
  for (const s of stars) parts.push(encodeLeb128(s));
  const imports = node.imports || [];
  parts.push(encodeLeb128(imports.length));
  for (const im of imports) {
    parts.push(encodeLeb128(im.varIdx));
    parts.push(writeAtom(im.importName, firstAtom));
    parts.push(encodeLeb128(im.reqModuleIdx));
  }
  parts.push(writeObject(node.func, firstAtom));
  return Buffer.concat(parts);
}

function assembleJsc(irOrParsed) {
  const ir =
    irOrParsed && irOrParsed.format === "aiot-jsc-ir"
      ? irOrParsed
      : toIR(irOrParsed);
  const firstAtom = ir.firstAtom || FIRST_ATOM;
  const version = ir.bcVersion != null ? ir.bcVersion : 1;
  const atoms = ir.atoms || [];
  fillIrAtoms(ir);
  const header = [writeU8(version), encodeLeb128(atoms.length)];
  for (const atom of atoms) {
    header.push(encodeJSString(atom.text, !!atom.wide));
  }
  header.push(writeObject(ir.root, firstAtom));
  return Buffer.concat(header);
}

function fromIR(ir) {
  return parseJsc(assembleJsc(ir));
}

function unquoteAtom(name) {
  if (name == null) return "";
  const text = String(name);
  if (text.length >= 2 && text.charCodeAt(0) === 34 && text.charCodeAt(text.length - 1) === 34) {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === "string" ? parsed : text;
    } catch (_err) {
      return text;
    }
  }
  return text;
}

function absoluteTarget(pc, fmt, args) {
  const a = args || {};
  if (fmt === "label8" || fmt === "label16" || fmt === "label") {
    return a.imm == null ? null : pc + 1 + a.imm;
  }
  if (fmt === "atom_label_u8" || fmt === "atom_label_u16") {
    return a.label == null ? null : pc + 5 + a.label;
  }
  if (fmt === "label_u16") {
    return a.label == null ? null : pc + 1 + a.label;
  }
  return null;
}

function isCmpName(name) {
  return /^(eq|neq|strict_eq|strict_neq|lt|lte|gt|gte)[0-9]*$/.test(name || "");
}

function callArgc(line) {
  const name = line.name || "";
  const numbered = /^call([0-3])$/.exec(name);
  if (numbered) return Number(numbered[1]);
  if (
    name === "call" ||
    name === "tail_call" ||
    name === "call_method" ||
    name === "tail_call_method" ||
    name === "call_constructor"
  ) {
    const args = line.args || {};
    if (args.n != null) return args.n;
    if (args.imm != null) return args.imm;
    return 0;
  }
  return null;
}

function callPopCount(line, argc) {
  const info = OPCODE_BY_NAME[line.name] || {};
  const base = info.pop || 0;
  const name = line.name || "";
  if (
    name === "call" ||
    name === "tail_call" ||
    name === "call_method" ||
    name === "tail_call_method" ||
    name === "call_constructor"
  ) {
    return base + (argc || 0);
  }
  return base;
}

function localAt(fn, fmt, imm) {
  if (imm == null || !fn) return null;
  if (fmt === "loc" || fmt === "loc8" || fmt === "arg") {
    const loc = fn.locals && fn.locals[imm];
    if (!loc || !loc.varName) return null;
    const text = atomText(loc.varName);
    return text ? unquoteAtom(text) : null;
  }
  if (fmt === "var_ref") {
    const closure = fn.closures && fn.closures[imm];
    if (!closure || !closure.varName) return null;
    const text = atomText(closure.varName);
    return text ? unquoteAtom(text) : null;
  }
  return null;
}

function constNode(fn, line) {
  if (!fn || !fn.cpool || !line || !line.args) return null;
  let idx = null;
  if (line.args.constIndex != null) idx = line.args.constIndex;
  else if (line.fmt === "const8") idx = line.args.imm;
  if (idx == null) return null;
  return fn.cpool[idx] || null;
}

function arrayReturnShape(node) {
  if (!node || node.type !== "array") return null;
  const items = node.items || [];
  if (items.length === 0) return "empty";
  for (const item of items) {
    if (!item) return null;
    if (item.type === "int32" || item.type === "float64") {
      if (item.value !== 0) return null;
    } else if (item.type === "bool") {
      if (item.value) return null;
    } else {
      return null;
    }
  }
  return "zeros";
}

function previewFromNode(node) {
  if (!node) return null;
  if (node.type === "string") return { text: node.text, node };
  if (node.type === "bool") return { text: node.value ? "true" : "false", node };
  if (node.type === "int32" || node.type === "float64") return { text: String(node.value), node };
  if (node.type === "array") {
    const shape = arrayReturnShape(node);
    if (shape === "empty") return { text: "[]", node };
    if (shape === "zeros") return { text: "[0]", node };
    return { text: "<array " + node.items.length + ">", node };
  }
  return { text: "<" + node.type + ">", node };
}

function traceLines(fn, lines) {
  fn = fn || {};
  lines = lines || [];
  const last = lines.length ? lines[lines.length - 1] : null;
  const end =
    fn.bytecode && fn.bytecode.length != null
      ? fn.bytecode.length
      : last
        ? last.pc + (last.size || 1)
        : 0;
  const edges = [];
  const calls = [];
  const stores = [];
  const fields = [];
  const cmps = [];
  const stack = [];
  let statusReturn = null;
  const storageNames = {
    getStorage: true,
    setStorage: true,
    getStorageSync: true,
    setStorageSync: true,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const args = line.args || {};
    const info = OPCODE_BY_NAME[line.name] || {};
    const size = line.size != null ? line.size : info.size || 1;
    const next = i + 1 < lines.length ? lines[i + 1].pc : end;
    const target = absoluteTarget(line.pc, line.fmt, args);
    edges.push({
      pc: line.pc,
      name: line.name,
      size,
      next,
      target,
      local: localAt(fn, line.fmt, args.imm),
    });

    const argc = callArgc(line);
    if (argc != null) {
      const slot = stack.length - 1 - argc;
      let callee = slot >= 0 && stack[slot] ? unquoteAtom(stack[slot].text) : "";
      if (!callee) callee = unquoteAtom(args.atomName) || "?";
      if (!callee) callee = "?";
      const argVals = [];
      for (let a = 0; a < argc; a++) {
        const idx = slot + 1 + a;
        if (idx >= 0 && idx < stack.length && stack[idx]) argVals.push(stack[idx].text);
      }
      calls.push({ pc: line.pc, callee, argc, args: argVals });
      if (storageNames[callee]) {
        let key = null;
        for (const value of argVals) {
          if (value && value !== callee) {
            key = value;
            break;
          }
        }
        stores.push({ pc: line.pc, op: callee, key });
      }
    }

    const atom = unquoteAtom(args.atomName);
    if (line.name && line.name.indexOf("get_field") === 0) {
      fields.push({ pc: line.pc, dir: "get", atom });
    } else if (
      line.name &&
      (line.name.indexOf("put_field") === 0 ||
        line.name === "define_field" ||
        line.name.indexOf("define_field") === 0)
    ) {
      fields.push({ pc: line.pc, dir: "put", atom });
    }

    if (isCmpName(line.name)) {
      const top = stack.length ? stack[stack.length - 1] : null;
      cmps.push({
        pc: line.pc,
        name: line.name,
        constPreview: top && top.text ? top.text : null,
        target,
      });
    }

    if (line.name === "return" || line.name === "return_async") {
      const top = stack.length ? stack[stack.length - 1] : null;
      if (top && top.node) {
        const shape = arrayReturnShape(top.node);
        if (shape) statusReturn = { shape };
        else if (top.node.type === "bool" && top.node.value === false) statusReturn = { shape: "false" };
      } else if (top && top.text === "false") {
        statusReturn = { shape: "false" };
      }
    }

    const popN = argc != null ? callPopCount(line, argc) : info.pop || 0;
    for (let p = 0; p < popN && stack.length; p++) stack.pop();

    let pushed = previewFromNode(constNode(fn, line));
    if (!pushed && line.name === "push_false") pushed = { text: "false", node: { type: "bool", value: false } };
    else if (!pushed && line.name === "push_true") pushed = { text: "true", node: { type: "bool", value: true } };
    else if (!pushed && atom && line.fmt && String(line.fmt).indexOf("atom") === 0) {
      pushed = { text: atom, node: null };
    } else if (!pushed && args.constPreview != null) {
      pushed = { text: String(args.constPreview), node: null };
    }

    const pushN = info.push || 0;
    if (pushN > 0) {
      stack.push(pushed || { text: "", node: null });
      for (let k = 1; k < pushN; k++) stack.push({ text: "", node: null });
    }
  }

  return { edges, calls, stores, fields, cmps, statusReturn };
}

const GATE_ATOMS = new Set([
  "moduleStatus",
  "activationStatus",
  "activationResult",
  "lock",
  "license",
  "grantAccess",
  "requireAccess",
  "deviceCode",
  "hmac",
  "vip",
  "trial",
  "expire",
  "paywall",
  "授权",
  "激活",
  "解锁",
  "试用",
  "会员",
]);

function isGateAtom(atom) {
  const text = unquoteAtom(atom);
  if (!text) return false;
  if (GATE_ATOMS.has(text)) return true;
  return /^(activat|license|paywall)/i.test(text);
}

function scanGates(records) {
  const fieldWrites = [];
  const storageSets = [];
  const statusReturns = [];
  const readers = [];
  let linked = false;
  let emptyStatus = false;
  let statusField = false;
  const triggers = {
    checkActivation: true,
    verifyActivation: true,
    getStorage: true,
    getStorageSync: true,
  };
  for (const rec of records || []) {
    const base = {
      file: rec.file,
      index: rec.index,
      funcName: rec.funcName || "",
      methodName: rec.methodName || "",
    };
    let hasWrite = false;
    let hasTrigger = !!(rec.statusReturn && rec.statusReturn.shape);
    for (const field of rec.fields || []) {
      if (!isGateAtom(field.atom)) continue;
      const row = Object.assign({}, base, { pc: field.pc, atom: unquoteAtom(field.atom) });
      if (field.dir === "put") {
        hasWrite = true;
        fieldWrites.push(row);
        if (
          row.atom === "moduleStatus" ||
          row.atom === "activationStatus" ||
          row.atom === "activationResult"
        ) {
          statusField = true;
        }
      } else if (field.dir === "get") {
        readers.push(row);
      }
    }
    for (const call of rec.calls || []) {
      const callee = unquoteAtom(call.callee);
      if (callee === "setStorage" || callee === "setStorageSync") {
        hasWrite = true;
        let key = null;
        for (const value of call.args || []) {
          if (value && value !== callee) {
            key = value;
            break;
          }
        }
        storageSets.push(Object.assign({}, base, { pc: call.pc, key }));
      }
      if (triggers[callee]) hasTrigger = true;
    }
    if (rec.statusReturn && rec.statusReturn.shape) {
      statusReturns.push(Object.assign({}, base, { shape: rec.statusReturn.shape }));
      if (rec.statusReturn.shape === "empty" || rec.statusReturn.shape === "zeros") emptyStatus = true;
    }
    if (hasWrite && hasTrigger) linked = true;
  }
  return {
    fieldWrites,
    storageSets,
    statusReturns,
    readers,
    writeBack: linked || (emptyStatus && statusField),
  };
}

module.exports = {
  BC_TAG,
  FIRST_ATOM,
  BUILTIN_ATOMS,
  OPCODES,
  OPCODE_BY_NAME,
  DecodeError,
  parseJsc,
  rewriteAtoms,
  patchAtoms,
  collectStrings,
  collectFunctions,
  disassembleFunction,
  atomText,
  encodeLeb128,
  encodeSleb128,
  encodeJSString,
  toIR,
  fromIR,
  assembleJsc,
  resolveAtomFromName,
  estimateStackSize,
  findFunctions,
  stubFunction,
  patchDefineField,
  spliceWindow,
  traceLines,
  scanGates,
};
