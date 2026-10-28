#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  parseJsc,
  patchAtoms,
  collectStrings,
  disassembleFunction,
  traceLines,
  scanGates,
  toIR,
  assembleJsc,
  findFunctions,
  stubFunction,
  patchDefineField,
  spliceWindow,
} = require("./jsc");

const { unpackRpk, packRpk, packFilePlan, listFiles } = require("./rpk");

function usage() {
  console.error(`Usage:
  node cli.js unpack <file.rpk> --out <dir>
  node cli.js pack <dir> --out <file.rpk> [--no-sign] [--allow-extra]
  node cli.js classify <dir>
  node cli.js decompile <file.jsc> [--ir out.ir.json]
  node cli.js compile <file.ir.json> --out <file.jsc>
  node cli.js find <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains]
  node cli.js stub <file.jsc> [--fn NAME|--atom A,B|--index N] [--true|--false] [--set-field path[=bool]] [--async] [--out file.jsc]
  node cli.js stub <file.jsc> --define-field ATOM [--true|--false] [--out file.jsc]
  node cli.js splice <file.jsc> [--fn NAME|--atom A,B|--index N] --from N --count N --false [--out file.jsc]
  node cli.js verify <file.jsc> [--fn NAME|--atom A,B|--index N] --ops name,name,...
  node cli.js strings <file.jsc> [--contains TEXT]
  node cli.js disasm <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains] [--out file.txt]
  node cli.js flow <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains]
  node cli.js gates <unpackDir>
  node cli.js patch <file.jsc> --from TEXT --to TEXT [--out file.jsc]
  node cli.js patch <file.jsc> --map replacements.json [--out file.jsc]

Notes:
  cli is this file. JS pages: edit .js then pack. JSC: decompile IR, edit, compile.
  --fn matches funcName/methodName exactly; pass --contains for substring.
  strings --contains filters atoms and string constants; no hit exits 1.
  splice --false replaces an odd-length window with push_0,drop pairs plus push_0. Same count, same net stack. The following if_false falls through.
  minify names: find --atom fingerprint, stub --atom or --index, verify with the recorded --index.
  unpack/pack use AIoT SignUtil. pack signs unless --no-sign.
  pack refuses extra files vs .rpk-meta.json unless --allow-extra.
`);
  process.exit(1);
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

function has(flag) {
  return process.argv.includes(flag);
}

function parseSelector() {
  const selector = {};
  const fn = arg("--fn");
  const atom = arg("--atom");
  const indexRaw = arg("--index");
  if (fn != null && fn !== "" && !String(fn).startsWith("-")) selector.fn = fn;
  if (atom != null && atom !== "" && !String(atom).startsWith("-")) selector.atom = atom;
  if (indexRaw != null && indexRaw !== "" && !String(indexRaw).startsWith("-")) {
    selector.index = Number(indexRaw);
  }
  if (has("--contains")) selector.contains = true;
  return selector;
}

function hasSelector(sel) {
  return !!(sel.fn || sel.atom || (sel.index != null && !Number.isNaN(sel.index)));
}
function readJsc(p) {
  return parseJsc(fs.readFileSync(p));
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

function looksLikeIr(obj) {
  return obj && typeof obj === "object" && obj.format === "aiot-jsc-ir";
}

function defaultJscOut(input) {
  if (/\.ir\.json$/i.test(input)) return input.replace(/\.ir\.json$/i, ".jsc");
  if (/\.json$/i.test(input)) return input.replace(/\.json$/i, ".jsc");
  return input + ".jsc";
}

function cmdStrings(file) {
  const parsed = readJsc(file);
  const needle = arg("--contains");
  const filter = needle != null && needle !== "" && !String(needle).startsWith("-");
  let hits = 0;
  for (const s of collectStrings(parsed)) {
    const value = s.value == null ? "" : String(s.value);
    if (filter && value.indexOf(needle) < 0) continue;
    hits += 1;
    process.stdout.write(`${s.kind}\t${s.index ?? s.start}\t${JSON.stringify(s.value)}\n`);
  }
  if (filter && hits === 0) {
    console.error(JSON.stringify({ ok: false, contains: needle, hits: 0 }));
    process.exit(1);
  }
}

function formatOps(ops) {
  const lines = [];
  for (const op of ops) {
    const extra = [];
    const args = op.args || op;
    if (args.atomName) extra.push(args.atomName);
    if (args.constPreview != null) extra.push(JSON.stringify(args.constPreview));
    if (args.imm != null && !args.atomName) extra.push(String(args.imm));
    if (args.label != null) extra.push(`L${args.label}`);
    const pc = op.pc != null ? String(op.pc).padStart(4, "0") : "    ";
    lines.push(`  ${pc}  ${String(op.name).padEnd(20)} ${extra.join(" ")}`.trimEnd());
  }
  return lines;
}

function padPc(n) {
  return String(n == null ? 0 : n).padStart(4, "0");
}

function formatFlow(hits) {
  const lines = [];
  const writes = [];
  const callsites = [];
  for (const hit of hits) {
    const traced = hit.traced;
    lines.push(
      `fn ${hit.index} name=${JSON.stringify(hit.funcName || "")} method=${JSON.stringify(hit.methodName || "")} args=${hit.argCount} vars=${hit.varCount} async=${hit.async ? 1 : 0}`
    );
    for (const edge of traced.edges) {
      const local = edge.local ? ` local=${JSON.stringify(edge.local)}` : "";
      lines.push(
        `edge ${padPc(edge.pc)} ${edge.name} size=${edge.size} next=${edge.next} target=${edge.target == null ? "-" : edge.target}${local}`
      );
    }
    for (const call of traced.calls) {
      lines.push(`call ${padPc(call.pc)} ${call.callee} argc=${call.argc} args=${JSON.stringify(call.args)}`);
      callsites.push(
        `callsite ${call.callee} #${hit.index} method=${JSON.stringify(hit.methodName || "")} pc=${call.pc}`
      );
    }
    for (const store of traced.stores) {
      lines.push(
        `store ${padPc(store.pc)} ${store.op} key=${store.key == null ? "-" : JSON.stringify(store.key)}`
      );
    }
    for (const field of traced.fields) {
      lines.push(`field ${padPc(field.pc)} ${field.dir} ${JSON.stringify(field.atom)}`);
      if (field.dir === "put") {
        writes.push(
          `write ${field.atom} #${hit.index} method=${JSON.stringify(hit.methodName || "")} pc=${field.pc}`
        );
      }
    }
    for (const cmp of traced.cmps) {
      lines.push(
        `cmp ${padPc(cmp.pc)} ${cmp.name} const=${cmp.constPreview == null ? "-" : JSON.stringify(cmp.constPreview)} target=${cmp.target == null ? "-" : cmp.target}`
      );
    }
    lines.push("");
  }
  lines.push(...writes);
  lines.push(...callsites);
  return lines;
}

function traceHit(parsed, hit) {
  const ops = hit.fn.ops && hit.fn.ops.length ? hit.fn.ops : disassembleFunction(parsed, hit.fn);
  return Object.assign({}, hitPublic(hit), {
    argCount: hit.argCount,
    varCount: hit.varCount,
    async: hit.async,
    traced: traceLines(hit.fn, ops),
  });
}

function cmdFlow(file) {
  const parsed = readJsc(file);
  const hits = findFunctions(parsed, parseSelector()).map((hit) => traceHit(parsed, hit));
  process.stdout.write(formatFlow(hits).join("\n") + "\n");
}

function cmdGates(dir) {
  const records = [];
  for (const rel of listFiles(dir)) {
    if (!/\.jsc$/i.test(rel)) continue;
    const parsed = readJsc(path.join(dir, rel));
    for (const hit of findFunctions(parsed, {})) {
      const ops = hit.fn.ops && hit.fn.ops.length ? hit.fn.ops : disassembleFunction(parsed, hit.fn);
      const traced = traceLines(hit.fn, ops);
      records.push({
        file: rel,
        index: hit.index,
        funcName: hit.funcName,
        methodName: hit.methodName,
        fields: traced.fields,
        calls: traced.calls,
        stores: traced.stores,
        statusReturn: traced.statusReturn,
      });
    }
  }
  process.stdout.write(JSON.stringify(scanGates(records), null, 2) + "\n");
}

function cmdDisasm(file) {
  const parsed = readJsc(file);
  const lines = [];
  const hits = findFunctions(parsed, parseSelector());
  hits.forEach((hit) => {
    const fn = hit.fn;
    const ops = fn.ops && fn.ops.length ? fn.ops : disassembleFunction(parsed, fn);
    lines.push(
      `# function ${hit.index} name=${JSON.stringify(hit.funcName)} method=${JSON.stringify(hit.methodName)} args=${fn.argCount} vars=${fn.varCount} bc=${(fn.bytecode && fn.bytecode.length) || 0}`
    );
    lines.push(...formatOps(ops));
    lines.push("");
  });
  const text = lines.join("\n");
  const out = arg("--out");
  if (out) fs.writeFileSync(out, text);
  else process.stdout.write(text + "\n");
}

function hitPublic(h) {
  return {
    index: h.index,
    funcName: h.funcName,
    methodName: h.methodName,
    argCount: h.argCount,
    varCount: h.varCount,
    async: h.async,
    atoms: h.atoms,
    opsSummary: h.opsSummary,
  };
}

function cmdFind(file) {
  const parsed = readJsc(file);
  const hits = findFunctions(parsed, parseSelector());
  process.stdout.write(JSON.stringify(hits.map(hitPublic), null, 2) + "\n");
}

function cmdStub(file) {
  const parsed = readJsc(file);
  const defineField = arg("--define-field");
  const out = arg("--out") || file;
  let result;
  if (defineField) {
    result = patchDefineField(parsed, {
      atom: defineField,
      kind: has("--false") ? "false" : "true",
      false: has("--false"),
      value: !has("--false"),
    });
    fs.writeFileSync(out, result.buffer);
    console.error(JSON.stringify({ out, count: result.count, size: result.buffer.length }, null, 2));
    return;
  }
  const selector = parseSelector();
  if (!hasSelector(selector)) usage();
  result = stubFunction(
    parsed,
    selector,
    {
      true: has("--true"),
      false: has("--false"),
      kind: has("--false") ? "false" : "true",
      setField: arg("--set-field"),
      async: has("--async"),
    }
  );
  fs.writeFileSync(out, result.buffer);
  console.error(JSON.stringify({ out, function: result.function, size: result.buffer.length }, null, 2));
}

function cmdSplice(file) {
  const parsed = readJsc(file);
  const selector = parseSelector();
  if (!hasSelector(selector)) usage();
  if (!has("--false")) {
    console.error("splice requires --false");
    process.exit(1);
  }
  const result = spliceWindow(parsed, selector, {
    from: arg("--from"),
    count: arg("--count"),
    false: true,
    kind: "false",
  });
  const out = arg("--out") || file;
  fs.writeFileSync(out, result.buffer);
  console.error(
    JSON.stringify(
      {
        out,
        function: result.function.methodName || result.function.funcName,
        index: result.function.index,
        from: result.function.from,
        count: result.function.count,
        oldNet: result.function.oldNet,
        newNet: result.function.newNet,
        replaced: result.function.replaced,
        size: result.buffer.length,
      },
      null,
      2
    )
  );
}

function cmdVerify(file) {
  const parsed = readJsc(file);
  const selector = parseSelector();
  const want = (arg("--ops") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!hasSelector(selector) || !want.length) usage();
  const hits = findFunctions(parsed, selector);
  if (hits.length !== 1) {
    console.error(JSON.stringify({ ok: false, reason: `matched ${hits.length}`, hits: hits.map(hitPublic) }, null, 2));
    process.exit(1);
  }
  const names = (
    hits[0].fn.ops && hits[0].fn.ops.length
      ? hits[0].fn.ops
      : disassembleFunction(parsed, hits[0].fn)
  ).map((o) => o.name);
  const ok = names.join(",") === want.join(",");
  process.stdout.write(JSON.stringify({ ok, selector, got: names, want }, null, 2) + "\n");
  if (!ok) process.exit(1);
}

function walkPageFiles(dir) {
  const acc = { js: [], jsc: [] };
  for (const rel of listFiles(dir)) {
    if (/^pages\/.*\.jsc$/i.test(rel) || /^app\.jsc$/i.test(rel)) acc.jsc.push(rel);
    else if (/^pages\/.*\.js$/i.test(rel) || /^app\.js$/i.test(rel)) acc.js.push(rel);
  }
  return acc;
}

function readJsonIf(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_err) {
    return null;
  }
}

function cmdClassify(dir) {
  const pages = walkPageFiles(dir);
  const kind = pages.jsc.length ? "jsc" : pages.js.length ? "js" : "unknown";
  const plan = packFilePlan(dir);
  const man = readJsonIf(path.join(dir, "manifest.json"));
  const manWatch = readJsonIf(path.join(dir, "manifest-watch.json"));
  const entry = (man && man.router && man.router.entry) || null;
  const watchEntry = (manWatch && manWatch.router && manWatch.router.entry) || null;
  process.stdout.write(
    JSON.stringify(
      {
        kind,
        js: pages.js.length,
        jsc: pages.jsc.length,
        files: plan.files.length,
        extra: plan.extra,
        missing: plan.missing,
        entry,
        watchEntry,
        package: man && man.package,
        versionName: man && man.versionName,
      },
      null,
      2
    ) + "\n"
  );
}

function cmdPatch(file) {
  const parsed = readJsc(file);
  const replacements = {};
  const mapFile = arg("--map");
  if (mapFile) Object.assign(replacements, JSON.parse(fs.readFileSync(mapFile, "utf8")));
  const from = arg("--from");
  const to = arg("--to");
  if (from != null) {
    if (to == null) {
      console.error("--to required with --from");
      process.exit(1);
    }
    replacements[from] = to;
  }
  if (!Object.keys(replacements).length) usage();
  const { buffer, hits } = patchAtoms(parsed, replacements, { exact: !has("--contains") });
  const out = arg("--out") || file.replace(/\.jsc$/i, ".patched.jsc");
  fs.writeFileSync(out, buffer);
  console.error(JSON.stringify({ out, hits, size: buffer.length }, null, 2));
}

function cmdDecompile(file) {
  const parsed = readJsc(file);
  const ir = toIR(parsed);
  const irPath = arg("--ir") || `${file}.ir.json`;
  ensureParent(irPath);
  fs.writeFileSync(irPath, JSON.stringify(ir, null, 2));
  console.error(
    JSON.stringify(
      {
        ir: irPath,
        note: "IR JSON only. Edit this file and compile it back with assembleJsc.",
      },
      null,
      2
    )
  );
}

function compileIr(ir, out) {
  const buf = assembleJsc(ir);
  ensureParent(out);
  fs.writeFileSync(out, buf);
  console.error(JSON.stringify({ out, size: buf.length, note: "compile of .ir.json uses assembleJsc (lossless identity)" }, null, 2));
}

function cmdCompile(input) {
  const st = fs.statSync(input);
  if (st.isDirectory() || /\.(js|dec\.js)$/i.test(input)) {
    console.error("compile only accepts IR JSON from decompile. Edit plaintext .js in the unpack dir and pack; do not compile JS to JSC.");
    process.exit(1);
  }
  let ir;
  try {
    ir = JSON.parse(fs.readFileSync(input, "utf8"));
  } catch (err) {
    throw new Error(`cannot compile ${input}: expected IR JSON (${err.message})`);
  }
  if (!looksLikeIr(ir)) {
    throw new Error(`${input} is JSON but not format aiot-jsc-ir`);
  }
  compileIr(ir, arg("--out") || defaultJscOut(input));
}

async function cmdUnpack(file) {
  const out = arg("--out");
  if (!out) {
    console.error("unpack requires --out <dir>");
    process.exit(1);
  }
  const result = await unpackRpk(file, out);
  console.error(JSON.stringify({ out, ...result }, null, 2));
}

async function cmdPack(dir) {
  const out = arg("--out");
  if (!out) {
    console.error("pack requires --out <file.rpk>");
    process.exit(1);
  }
  const result = await packRpk(dir, out, {
    sign: !has("--no-sign"),
    allowExtra: has("--allow-extra"),
  });
  console.error(JSON.stringify(result, null, 2));
}

const cmd = process.argv[2];
const file = process.argv[3];
if (!cmd || !file) usage();
(async () => {
  if (cmd === "decompile") cmdDecompile(file);
  else if (cmd === "compile") cmdCompile(file);
  else if (cmd === "strings") cmdStrings(file);
  else if (cmd === "disasm") cmdDisasm(file);
  else if (cmd === "flow") cmdFlow(file);
  else if (cmd === "gates") cmdGates(file);
  else if (cmd === "patch") cmdPatch(file);
  else if (cmd === "unpack") await cmdUnpack(file);
  else if (cmd === "pack") await cmdPack(file);
  else if (cmd === "find") cmdFind(file);
  else if (cmd === "stub") cmdStub(file);
  else if (cmd === "splice") cmdSplice(file);
  else if (cmd === "verify") cmdVerify(file);
  else if (cmd === "classify") cmdClassify(file);
  else usage();
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
