"use strict";

const fs = require("fs");
const path = require("path");

function loadJSZip() {
  return require("jszip");
}

function loadSignStack() {
  return {
    ZipUtil: require("./vendor/sign/ZipUtil").default,
    SignUtil: require("./vendor/sign/SignUtil").default,
  };
}

function defaultPemDir() {
  return path.join(__dirname, "vendor", "sign", "pem");
}

function assertZipMagic(buf) {
  if (!buf || buf.length < 4) {
    throw new Error("not a zip/rpk (file too short)");
  }
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x04034b50 && magic !== 0x06054b50) {
    const head = buf.subarray(0, Math.min(16, buf.length)).toString("hex");
    throw new Error(`not a zip/rpk (magic ${head})`);
  }
}

async function unpackRpk(rpkPath, outDir) {
  const JSZip = loadJSZip();
  const buf = fs.readFileSync(rpkPath);
  assertZipMagic(buf);
  const zip = await JSZip.loadAsync(buf);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const tasks = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) {
      fs.mkdirSync(path.join(outDir, relPath), { recursive: true });
      return;
    }
    files.push(relPath);
    tasks.push(
      entry.async("nodebuffer").then((content) => {
        const dest = path.join(outDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
      })
    );
  });
  await Promise.all(tasks);
  const comment = zip.comment || "";
  fs.writeFileSync(
    path.join(outDir, ".rpk-meta.json"),
    JSON.stringify({ comment, files }, null, 2)
  );
  return { comment, files, size: buf.length };
}

function posixRel(rel) {
  return String(rel || "").replace(/\\/g, "/");
}

function shouldIgnoreRel(rel) {
  const p = posixRel(rel).replace(/^\/+/, "");
  if (!p) return true;
  if (p === ".rpk-meta.json") return true;
  const segs = p.split("/");
  for (const s of segs) {
    if (s === ".agent" || s === ".git" || s === ".dsh") return true;
    if (s === "_work") return true;
  }
  if (/\.ir\.json$/i.test(p)) return true;
  if (/\.disasm\.txt$/i.test(p)) return true;
  if (/\.orig\.bak$/i.test(p)) return true;
  if (/\.bak$/i.test(p)) return true;
  return false;
}

function listFiles(dir) {
  const out = [];
  function walk(cur, rel) {
    let names;
    try {
      names = fs.readdirSync(cur);
    } catch (_err) {
      return;
    }
    for (const name of names) {
      const next = rel ? `${rel}/${name}` : name;
      if (shouldIgnoreRel(next)) continue;
      const abs = path.join(cur, name);
      let st;
      try {
        st = fs.statSync(abs);
      } catch (_err) {
        continue;
      }
      if (st.isDirectory()) walk(abs, next);
      else out.push(posixRel(next));
    }
  }
  walk(dir, "");
  return out;
}

function readMeta(dir) {
  const metaPath = path.join(dir, ".rpk-meta.json");
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

function packFilePlan(dir, options) {
  options = options || {};
  const meta = readMeta(dir) || {};
  const comment = options.comment != null ? options.comment : meta.comment || "";
  const files = listFiles(dir);
  const metaFiles = Array.isArray(meta.files) ? meta.files.map(posixRel) : null;
  const disk = new Set(files);
  const extra = [];
  const missing = [];
  const ignored = [];
  if (metaFiles) {
    const orig = new Set(metaFiles);
    for (const f of files) {
      if (!orig.has(f)) extra.push(f);
    }
    for (const f of metaFiles) {
      if (shouldIgnoreRel(f)) {
        ignored.push(f);
        continue;
      }
      if (!disk.has(f)) missing.push(f);
    }
  }
  return {
    comment,
    files,
    ignored,
    extra,
    missing,
    metaFiles: metaFiles || [],
  };
}

function makePackage(dir, comment, files) {
  const resourceList = files.map((rel) => {
    const abs = path.join(dir, rel.split("/").join(path.sep));
    return {
      fileBuildPath: rel,
      fileContentBuffer: fs.readFileSync(abs),
    };
  });
  const dic = Object.fromEntries(resourceList.map((r) => [r.fileBuildPath, true]));
  return {
    comment,
    resourceList,
    resourceDic: dic,
    include(p) {
      return !!dic[p];
    },
    getResource(p) {
      return resourceList.find((r) => r.fileBuildPath === p);
    },
  };
}

async function packRpk(dir, outPath, options = {}) {
  const plan = packFilePlan(dir, options);
  const allowExtra = options.allowExtra === true;
  if (plan.extra.length && !allowExtra) {
    throw new Error(`pack extra files not in original rpk (pass allowExtra): ${plan.extra.join(", ")}`);
  }
  const { ZipUtil, SignUtil } = loadSignStack();
  const target = makePackage(dir, plan.comment, plan.files);
  let buffer;
  if (options.sign === false) {
    buffer = await ZipUtil.createZipBufferFromFileList(
      target.resourceList.map((r) => ({
        path: r.fileBuildPath,
        content: r.fileContentBuffer,
      })),
      plan.comment
    );
  } else {
    const pemDir = options.pemDir || defaultPemDir();
    const privatekey = fs.readFileSync(path.join(pemDir, "private.pem"));
    const certificate = fs.readFileSync(path.join(pemDir, "certificate.pem"));
    buffer = await SignUtil.signPackage(target, privatekey, certificate);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  return {
    outPath,
    size: buffer.length,
    signed: options.sign !== false,
    extra: plan.extra,
    missing: plan.missing,
    files: plan.files.length,
  };
}

module.exports = {
  unpackRpk,
  packRpk,
  listFiles,
  packFilePlan,
  shouldIgnoreRel,
  defaultPemDir,
};
