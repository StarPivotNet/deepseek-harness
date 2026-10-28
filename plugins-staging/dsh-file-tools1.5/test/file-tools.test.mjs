import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { FsError } from "@deepseek-ai/dsh-fs";
import { apply, Config, inject, name } from "../lib/index.js";
import { publication as driveRootPublication } from "../lib/create-without-link.js";

function targetFor(filePath) {
  return { targetKey: filePath, displayPath: filePath };
}

function createContext(files, options = {}) {
  const tools = [];
  const observed = [];
  const intents = [];
  return {
    tools,
    observed,
    intents,
    ctx: {
      fs: {
        sandboxMode: options.sandboxMode,
        async resolve(filePath, resolveOptions) {
          const base = resolveOptions?.cwd ?? "C:\\workspace";
          const resolved = isAbsolute(filePath) ? filePath : `${base}\\${filePath}`;
          return targetFor(resolved);
        },
        async stat(target) {
          const entry = files.get(target.targetKey);
          return entry === undefined ? undefined : { version: entry.version, type: "file", size: entry.content.length };
        },
        async readText(target) {
          const entry = files.get(target.targetKey);
          if (entry === undefined) throw new Error(`missing ${target.displayPath}`);
          return entry.content;
        },
        processPath(target) {
          return target.targetKey;
        },
        async withLock(targetKey, operation) {
          const previous = options.locks?.get(targetKey) ?? Promise.resolve();
          const run = previous.then(operation, operation);
          const tail = run.then(() => undefined, () => undefined);
          options.locks ??= new Map();
          options.locks.set(targetKey, tail);
          try {
            return await run;
          } finally {
            if (options.locks.get(targetKey) === tail) options.locks.delete(targetKey);
          }
        },
        async writeText(target, content, expected) {
          const existing = files.get(target.targetKey);
          if (expected?.kind === "createIfAbsent" && existing !== undefined) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
          if (expected?.kind === "replaceIfVersion") {
            if (existing === undefined) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
            if (existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
          }
          const version = `v${(existing?.generation ?? 0) + 1}`;
          files.set(target.targetKey, { content, version, generation: (existing?.generation ?? 0) + 1 });
          return { operation: existing === undefined ? "create" : "update", version, before: existing?.content ?? null, after: content };
        },
        async editText(target, edit, expected) {
          return this.withLock(target.targetKey, async () => {
            const existing = files.get(target.targetKey);
            if (existing === undefined) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
            if (expected && existing.version !== expected.version) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
            const crlfCount = existing.content.slice(0, 4096).split("\r\n").length - 1;
            const lineEndings = crlfCount > existing.content.slice(0, 4096).split("\n").length - 1 - crlfCount ? "CRLF" : "LF";
            const before = existing.content.replaceAll("\r\n", "\n");
            const pattern = edit.oldString.replaceAll("\r\n", "\n").split("\n").map((line) => line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\r?\\n");
            const matches = [...before.matchAll(new RegExp(pattern, "gu"))];
            if (matches.length === 0) throw new FsError(`old_string at ${target.displayPath} did not appear`, "FS_EDIT_NOT_FOUND");
            if (matches.length > 1 && edit.replaceAll !== true) throw new FsError(`old_string at ${target.displayPath} appears ${matches.length} times`, "FS_AMBIGUOUS_EDIT");
            const selected = edit.replaceAll === true ? matches : [matches[0]];
            let after = before;
            for (const match of [...selected].reverse()) after = `${after.slice(0, match.index)}${edit.newString}${after.slice(match.index + match[0].length)}`;
            const stored = lineEndings === "LF" ? after : after.replaceAll("\n", "\r\n");
            const version = `v${existing.generation + 1}`;
            files.set(target.targetKey, { content: stored, version, generation: existing.generation + 1 });
            return { version, before, after };
          });
        },
      },
      tools: { register(definition) { tools.push(definition); } },
      systemPrompt: { getSectionOrder() { return 10; }, section() {} },
      waterfall(...args) {
        const passed = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
        const thisArg = this?.currentEditVersion !== undefined ? this : passed;
        const [eventName, target, eventActor] = args;
        const inner = args.pop();
        intents.push({ eventName, targetKey: target?.targetKey, thisKey: thisArg?.agent === undefined });
        const listeners = [...(options.listeners?.[eventName] ?? [])].map((listener) => listener.bind(thisArg));
        const dispatch = (index) => index >= listeners.length ? inner() : listeners[index](target, eventActor, () => dispatch(index + 1));
        return dispatch(0);
      },
      emit(eventName, target, observation) {
        observed.push({ eventName, target, observation });
        options.onObserved?.(target, observation);
      },
      on(eventName, listener, optionsForListener) {
        options.listeners ??= {};
        const listeners = options.listeners[eventName] ?? [];
        if (optionsForListener?.prepend === true) listeners.unshift(listener);
        else listeners.push(listener);
        if (options.listeners?.[eventName] === undefined) options.listeners[eventName] = listeners;
      },
      get(service) { return options.services?.[service]; },
    },
  };
}

test("exports the published plugin contract", () => {
  assert.equal(name, "dsh-file-tools");
  assert.deepEqual([...inject], ["tools", "fs", "systemPrompt"]);
  assert.equal(typeof Config["~standard"].validate, "function");
  assert.equal(typeof apply, "function");
});

test("file_read reads multiple files concurrently and reports windows", async () => {
  let active = 0
  let peak = 0
  const files = new Map([
    ["C:\\workspace\\one.txt", { content: "a\nb\nc\n", version: "v1", generation: 1 }],
    ["C:\\workspace\\two.txt", { content: `${"x".repeat(3000)}\n${"y".repeat(50 * 1024)}\n`, version: "v2", generation: 1 }],
  ])
  const harness = createContext(files)
  const original = harness.ctx.fs.readText
  harness.ctx.fs.readText = async (target, signal) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
    return original(target, signal)
  }
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 })
  const read = harness.tools.find((tool) => tool.name === "file_read")
  const result = await read.execute({ files: [{ file_path: "one.txt", offset: 2, limit: 1 }, { file_path: "two.txt", limit: 2 }] }, { signal: new AbortController().signal })
  assert.equal(peak, 2)
  assert.deepEqual(result.files[0], { path: "C:\\workspace\\one.txt", offset: 2, lines: [{ number: 2, text: "b" }], totalLines: 3, truncated: false })
  assert.equal(result.files[1].lines[0].text.endsWith("... (line truncated to 2000 chars)"), true)
  assert.equal(result.files[1].lines.length, 2)
  assert.equal(result.files[1].lines[1].text.endsWith("... (line truncated to 2000 chars)"), true)
  assert.equal(result.files[1].truncated, false)
  assert.equal(harness.observed.length, 2)
})

test("file_write and file_edit are safe to run in a parallel batch", () => {
  const files = new Map();
  const harness = createContext(files);
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const write = harness.tools.find((tool) => tool.name === "file_write");
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  assert.equal(write.isConcurrencySafe({ file_path: "notes.txt", content: "" }), true);
  assert.equal(edit.isConcurrencySafe({ files: [{ file_path: "notes.txt", edits: [{ old_string: "a", new_string: "b" }] }] }), true);
  assert.equal(write.isConcurrencySafe({}), false);
  assert.equal(edit.isConcurrencySafe({}), false);
});

function hardLinkFailure(displayPath) {
  const cause = new Error(`EISDIR: illegal operation on a directory, link 'staged.tmp' -> '${displayPath}'`);
  cause.code = "EISDIR";
  cause.syscall = "link";
  return new FsError(`cannot write "${displayPath}": ${cause.message}`, "FS_IO_ERROR", { cause });
}

test("file_write preserves a file created before a hard-link rejection can be retried", async () => {
  const files = new Map();
  const harness = createContext(files);
  const key = "D:\\workspace\\patch-gate.js";
  harness.ctx.fs.writeText = async (target) => {
    files.set(target.targetKey, { content: "old\n", version: "v1", generation: 1 });
    throw hardLinkFailure(target.displayPath);
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const write = harness.tools.find((tool) => tool.name === "file_write");
  await assert.rejects(
    () => write.execute({ file_path: key, content: "new\n" }, { signal: new AbortController().signal }),
    (error) => error instanceof FsError && error.code === "FS_NOT_OBSERVED" && error.message.includes("has not been read"),
  );
  assert.equal(files.get(key).content, "old\n");
});

test("file_write creates through the no-replace publisher when a hard link is rejected", async () => {
  const files = new Map();
  const harness = createContext(files);
  const key = "D:\\workspace\\missing.js";
  harness.ctx.fs.writeText = async (target) => { throw hardLinkFailure(target.displayPath); };
  const publisher = await import("../lib/create-without-link.js");
  const original = publisher.publication.createFileWithoutLink;
  publisher.publication.createFileWithoutLink = async (absolutePath, content) => {
    if (files.has(absolutePath)) throw new FsError(`cannot overwrite existing "${absolutePath}" without reading it first`, "FS_NOT_OBSERVED");
    files.set(absolutePath, { content, version: "created", generation: 1 });
    return { operation: "create", version: "created", before: null, after: content };
  };
  try {
    apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
    const write = harness.tools.find((tool) => tool.name === "file_write");
    const written = await write.execute({ file_path: key, content: "new\n" }, { signal: new AbortController().signal });
    assert.equal(written.operation, "create");
    assert.equal(files.get(key).content, "new\n");
    files.set(key, { content: "kept\n", version: "external", generation: 2 });
    await assert.rejects(
      () => write.execute({ file_path: key, content: "replaced\n" }, { signal: new AbortController().signal }),
      (error) => error instanceof FsError && error.code === "FS_NOT_OBSERVED",
    );
    assert.equal(files.get(key).content, "kept\n");
  } finally {
    publisher.publication.createFileWithoutLink = original;
  }
});

test("file_edit writes different files concurrently and keeps one file ordered", async () => {
  let active = 0;
  let peak = 0;
  const files = new Map([
    ["C:\\workspace\\one.txt", { content: "one\n", version: "v1", generation: 1 }],
    ["C:\\workspace\\two.txt", { content: "two\n", version: "v1", generation: 1 }],
  ]);
  const harness = createContext(files);
  const original = harness.ctx.fs.editText;
  harness.ctx.fs.editText = async (target, edit, expected, signal, policy) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return original.call(harness.ctx.fs, target, edit, expected, signal, policy);
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const changed = await edit.execute({
    files: [
      { file_path: "one.txt", edits: [{ old_string: "one", new_string: "alpha" }, { old_string: "alpha", new_string: "beta" }] },
      { file_path: "two.txt", edits: [{ old_string: "two", new_string: "gamma" }] },
    ],
  }, { signal: new AbortController().signal });
  assert.equal(peak, 2);
  assert.deepEqual(changed.files.map((file) => file.replacements), [2, 1]);
  assert.equal(files.get("C:\\workspace\\one.txt").content, "beta\n");
  assert.equal(files.get("C:\\workspace\\two.txt").content, "gamma\n");
});

test("file_edit does not write any file when another file in the call does not match", async () => {
  const files = new Map([
    ["C:\\workspace\\one.txt", { content: "one\n", version: "v1", generation: 1 }],
    ["C:\\workspace\\two.txt", { content: "two\n", version: "v1", generation: 1 }],
  ]);
  const harness = createContext(files);
  let writes = 0;
  const original = harness.ctx.fs.writeText;
  harness.ctx.fs.writeText = async (...args) => {
    writes += 1;
    return original(...args);
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  await assert.rejects(
    () => edit.execute({
      files: [
        { file_path: "one.txt", edits: [{ old_string: "one", new_string: "alpha" }] },
        { file_path: "two.txt", edits: [{ old_string: "missing", new_string: "gamma" }] },
      ],
    }, { signal: new AbortController().signal }),
    (error) => error.code === "FS_EDIT_NOT_FOUND",
  );
  assert.equal(writes, 0);
  assert.equal(files.get("C:\\workspace\\one.txt").content, "one\n");
});

test("file_write creates a missing file and file_edit changes multiple files", async () => {
  const files = new Map([["C:\\workspace\\second.txt", { content: "one\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const write = harness.tools.find((tool) => tool.name === "file_write");
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const created = await write.execute({ file_path: "notes.txt", content: "alpha\nbeta\n" }, { signal: new AbortController().signal });
  assert.equal(created.operation, "create");
  const changed = await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "beta", new_string: "gamma" }, { old_string: "alpha", new_string: "delta" }] }, { file_path: "second.txt", edits: [{ old_string: "one", new_string: "two" }] }] }, { signal: new AbortController().signal });
  assert.deepEqual(changed.files.map((file) => file.replacements), [2, 1]);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "delta\ngamma\n");
  assert.equal(files.get("C:\\workspace\\second.txt").content, "two\n");
});

test("file_write replaces an existing file and file_edit rejects ambiguity", async () => {
  const replacementFiles = new Map([["C:\\workspace\\notes.txt", { content: "old\n", version: "v1", generation: 1 }]]);
  const replacement = createContext(replacementFiles);
  apply(replacement.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const replaced = await replacement.tools.find((tool) => tool.name === "file_write").execute({ file_path: "notes.txt", content: "fresh\n" }, { signal: new AbortController().signal });
  assert.equal(replaced.operation, "update");
  const ambiguousFiles = new Map([["C:\\workspace\\notes.txt", { content: "same\nsame\n", version: "v1", generation: 1 }]]);
  const ambiguous = createContext(ambiguousFiles);
  apply(ambiguous.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = ambiguous.tools.find((tool) => tool.name === "file_edit");
  await assert.rejects(() => edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "same", new_string: "other" }] }] }, { signal: new AbortController().signal }), /appears 2 times/);
  await assert.rejects(() => edit.execute({ files: [{ file_path: "missing.txt", edits: [{ old_string: "x", new_string: "y" }] }] }, { signal: new AbortController().signal }), /does not exist/);
});

test("file_write recreates a file deleted outside the session", async () => {
  const key = "D:\\desktop\\desktop\\t.txt";
  const files = new Map([[key, { content: "old\n", version: "v1", generation: 1 }]]);
  const listeners = { "fs/write-intent": [], "fs/observed": [] };
  const harness = createContext(files, { listeners });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const observed = new Map();
  listeners["fs/observed"].push((target, observation) => {
    if (observation.kind === "absent") observed.delete(target.targetKey);
    else observed.set(target.targetKey, observation.version);
  });
  listeners["fs/write-intent"].push((target, _actor, next) => {
    const prior = observed.get(target.targetKey);
    return prior === undefined ? next() : { kind: "replaceIfVersion", version: prior };
  });
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  await harness.tools.find((tool) => tool.name === "file_read").execute({ files: [{ file_path: key }] }, exec);
  files.delete(key);
  const created = await harness.tools.find((tool) => tool.name === "file_write").execute({ file_path: key, content: "hello world\n" }, exec);
  assert.equal(created.operation, "create");
  assert.equal(files.get(key).content, "hello world\n");
});

test("file_write and file_edit bypass host mkdir at a Windows drive root", async () => {
  const key = "D:\\t.txt";
  const files = new Map();
  const harness = createContext(files);
  let hostWrites = 0;
  const originalWrite = harness.ctx.fs.writeText;
  const originalEdit = harness.ctx.fs.editText;
  harness.ctx.fs.writeText = async (...args) => {
    hostWrites += 1;
    if (args[0].targetKey === key) throw new Error("EPERM: operation not permitted, mkdir 'D:\\'");
    return originalWrite.apply(harness.ctx.fs, args);
  };
  harness.ctx.fs.editText = async (...args) => {
    hostWrites += 1;
    if (args[0].targetKey === key) throw new Error("EPERM: operation not permitted, mkdir 'D:\\'");
    return originalEdit.apply(harness.ctx.fs, args);
  };
  const publicationCalls = [];
  driveRootPublication.createFileWithoutLink = async (absolutePath, content) => {
    publicationCalls.push(["create", absolutePath]);
    const version = "drive-v1";
    files.set(absolutePath, { content, version, generation: 1 });
    return { operation: "create", version, before: null, after: content };
  };
  driveRootPublication.replaceFileWithoutLink = async (absolutePath, content, expectedVersion) => {
    publicationCalls.push(["replace", absolutePath, expectedVersion]);
    const existing = files.get(absolutePath);
    if (existing?.version !== expectedVersion) throw new Error("stale drive-root version");
    const version = `drive-v${existing.generation + 1}`;
    files.set(absolutePath, { content, version, generation: existing.generation + 1 });
    return { operation: "update", version, before: null, after: content };
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  const created = await harness.tools.find((tool) => tool.name === "file_write").execute({ file_path: key, content: "hello world\n" }, exec);
  const edited = await harness.tools.find((tool) => tool.name === "file_edit").execute({ files: [{ file_path: key, edits: [{ old_string: "world", new_string: "dsh" }] }] }, exec);
  const replaced = await harness.tools.find((tool) => tool.name === "file_write").execute({ file_path: key, content: "complete\n" }, exec);
  assert.equal(created.operation, "create");
  assert.equal(edited.files[0].replacements, 1);
  assert.equal(replaced.operation, "update");
  assert.equal(files.get(key).content, "complete\n");
  assert.equal(hostWrites, 0);
  assert.deepEqual(publicationCalls.map((call) => call[0]), ["create", "replace", "replace"]);
});

test("file_write refreshes the version used by the next file_edit", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "v1", generation: 1 }]]);
  const listeners = { "fs/write-intent": [], "fs/edit-intent": [] };
  const observed = new Map();
  const harness = createContext(files, { listeners });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const emit = harness.ctx.emit;
  harness.ctx.emit = (eventName, target, observation, actor) => {
    emit(eventName, target, observation, actor);
    if (observation.kind === "present") observed.set(target.targetKey, observation.version);
  };
  listeners["fs/write-intent"].push((target, _actor, next) => {
    const prior = observed.get(target.targetKey);
    return prior === undefined ? next() : { kind: "replaceIfVersion", version: prior };
  });
  listeners["fs/edit-intent"].push((_target, _actor, next) => next());
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  await harness.tools.find((tool) => tool.name === "file_write").execute({ file_path: "notes.txt", content: "second\n" }, exec);
  await harness.tools.find((tool) => tool.name === "file_edit").execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "second", new_string: "third" }] }] }, exec);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "third\n");
});

test("file_edit can run again immediately without another read", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "v1", generation: 1 }]]);
  const listeners = { "fs/edit-intent": [] };
  listeners["fs/edit-intent"].push((_target, actor, next) => {
    const intent = next();
    if (intent?.version === undefined && actor?.agent?.session === undefined) throw new Error("read required");
    return intent;
  });
  const harness = createContext(files, { listeners });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "first", new_string: "second" }] }] }, exec);
  await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "second", new_string: "third" }] }] }, exec);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "third\n");
});

test("file_edit keeps backticks that a markdown fence would drop", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "const name = `value`;\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  assert.match(edit.description, /do not wrap either value in markdown code fences/);
  const changed = await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "const name = `value`;", new_string: "const name = `other`;" }] }] }, { signal: new AbortController().signal });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "const name = `other`;\n");
});

test("file_edit tolerates CRLF but keeps other hidden characters exact", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "alpha\r\n\tbeta\r\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const changed = await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "alpha\n\tbeta\n", new_string: "gamma\n\tbeta\n" }] }] }, { signal: new AbortController().signal });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "gamma\r\n\tbeta\r\n");
  const tabbed = await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "beta", new_string: "delta" }] }] }, { signal: new AbortController().signal });
  assert.equal(tabbed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "gamma\r\n\tdelta\r\n");
});

test("module URL is stable", () => {
  assert.equal(pathToFileURL("C:\\Users\\yuluk\\.dsh\\plugins\\dsh-file-tools\\lib\\index.js").protocol, "file:");
});

test("misaligned intent listeners keep the real path and a fresh write counts as a read", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "old\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files, { listeners: {} });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  harness.ctx.on("fs/write-intent", (first) => ({ kind: "replaceIfVersion", version: first?.targetKey === undefined ? "" : "stale" }), { prepend: true });
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  const write = harness.tools.find((tool) => tool.name === "file_write");
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const rejected = await write.execute({ file_path: "notes.txt", content: "new\n" }, exec).then(() => undefined, (error) => error);
  assert.equal(rejected?.code, "FS_STALE_VERSION");
  assert.match(rejected.message, /C:\\workspace\\notes.txt/);
  assert.doesNotMatch(rejected.message, /""/);
  harness.ctx.waterfall = ((original) => (...args) => {
    if (args[0] === "fs/write-intent") return { kind: "replaceIfVersion", version: files.get("C:\\workspace\\notes.txt").version };
    return original(...args);
  })(harness.ctx.waterfall);
  await write.execute({ file_path: "notes.txt", content: "fresh\n" }, exec);
  await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "fresh", new_string: "done" }] }] }, exec);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "done\n");
});

test("file_edit survives a metadata-only version change after its freshness check", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  const original = harness.ctx.fs.stat;
  harness.ctx.fs.stat = async (target, signal) => {
    const info = await original(target, signal);
    if (info !== undefined) files.get(target.targetKey).version = "metadata-only";
    return info;
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const changed = await harness.tools.find((tool) => tool.name === "file_edit").execute({
    files: [{ file_path: "notes.txt", edits: [{ old_string: "first", new_string: "second" }] }],
  }, { signal: new AbortController().signal });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "second\n");
});

test("file_edit accepts a version change when only CRLF and LF differ", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "alpha\r\nbeta\r\n", version: "v1", generation: 1 }]]);
  const observed = new Map();
  const harness = createContext(files, { listeners: {}, onObserved(target, observation) {
    if (observation.kind === "present") observed.set(target.targetKey, observation.version);
  } });
  harness.ctx.on("fs/edit-intent", (target) => ({ version: observed.get(target.targetKey) }), { prepend: true });
  let statCount = 0;
  const originalStat = harness.ctx.fs.stat;
  const originalRead = harness.ctx.fs.readText;
  harness.ctx.fs.stat = async (target, signal) => {
    statCount += 1;
    const info = await originalStat(target, signal);
    if (statCount >= 2) return { ...info, version: "line-endings-only" };
    return info;
  };
  harness.ctx.fs.readText = async (target, signal) => {
    const content = await originalRead(target, signal);
    return statCount >= 2 ? content.replaceAll("\r\n", "\n") : content;
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const changed = await harness.tools.find((tool) => tool.name === "file_edit").execute({
    files: [{ file_path: "notes.txt", edits: [{ old_string: "alpha\nbeta", new_string: "gamma\ndelta" }] }],
  }, { signal: new AbortController().signal });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "gamma\r\ndelta\r\n");
});

test("file_edit rejects content read before an external change", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  const original = harness.ctx.fs.readText;
  harness.ctx.fs.readText = async (target, signal) => {
    const content = await original(target, signal);
    files.set(target.targetKey, { content: "external\n", version: "v9", generation: 9 });
    return content;
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const pending = harness.tools.find((tool) => tool.name === "file_edit").execute({
    files: [{ file_path: "notes.txt", edits: [{ old_string: "first", new_string: "second" }] }],
  }, { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } });
  const settled = await pending.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  assert.equal(settled.ok, false);
  assert.equal(settled.error.code, "FS_STALE_VERSION");
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "external\n");
});

test("file_edit prefers the verified version when a ranged read left a stale host observation", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "current", generation: 2 }]]);
  const observed = new Map([["C:\\workspace\\notes.txt", "stale-from-ranged-read"]]);
  const listeners = { "fs/edit-intent": [] };
  const harness = createContext(files, { listeners });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  listeners["fs/edit-intent"].push((target, _actor, next) => {
    const prior = observed.get(target.targetKey);
    return prior === undefined ? next() : { version: prior };
  });
  const changed = await harness.tools.find((tool) => tool.name === "file_edit").execute({
    files: [{ file_path: "notes.txt", edits: [{ old_string: "first", new_string: "second" }] }],
  }, { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(changed.files[0].version, "v3");
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "second\n");
  assert.equal(files.get("C:\\workspace\\notes.txt").version, "v3");
});

test("file_edit rejects a stale remembered version when the file changed outside this plugin", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "first\n", version: "v1", generation: 1 }]]);
  const observed = new Map();
  let acceptObservations = true;
  const harness = createContext(files, { listeners: {}, onObserved(target, observation) {
    if (acceptObservations && observation.kind === "present") observed.set(target.targetKey, observation.version);
  } });
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  harness.ctx.on("fs/edit-intent", (target) => ({ version: observed.get(target.targetKey) }), { prepend: true });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: "C:\\workspace" } } } };
  await edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "first", new_string: "second" }] }] }, exec);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "second\n");
  acceptObservations = false;
  files.set("C:\\workspace\\notes.txt", { content: "external\n", version: "v9", generation: 9 });
  const pending = edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "external", new_string: "kept" }] }] }, exec);
  const settled = await pending.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  assert.equal(settled.ok, false);
  assert.equal(settled.error.code, "FS_STALE_VERSION");
  assert.match(settled.error.message, /re-read the file/);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "external\n");
});

test("file_edit keeps spaces and indentation exact while CRLF still matches LF", async () => {
  const files = new Map([["C:\\workspace\\notes.txt", { content: "alpha \r\n  beta\r\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const edit = harness.tools.find((tool) => tool.name === "file_edit");
  await assert.rejects(
    () => edit.execute({ files: [{ file_path: "notes.txt", edits: [{ old_string: "alpha\nbeta", new_string: "gamma\ndelta" }] }] }, { signal: new AbortController().signal }),
    (error) => error.code === "FS_EDIT_NOT_FOUND",
  );
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "alpha \r\n  beta\r\n");
  const changed = await edit.execute({
    files: [{ file_path: "notes.txt", edits: [{ old_string: "alpha \n  beta", new_string: "gamma\n  delta" }] }],
  }, { signal: new AbortController().signal });
  assert.equal(changed.files[0].replacements, 1);
  assert.equal(files.get("C:\\workspace\\notes.txt").content, "gamma\r\n  delta\r\n");
});

test("file_read streams a file at or above the size threshold", async () => {
  const files = new Map([["C:\\workspace\\big.txt", { content: "alpha\nbeta\n", version: "v1", generation: 1 }]]);
  const harness = createContext(files);
  let streamed = 0;
  harness.ctx.fs.streamText = async function* (target) {
    streamed += 1;
    yield files.get(target.targetKey).content;
  };
  harness.ctx.fs.stat = async (target) => {
    const entry = files.get(target.targetKey);
    return entry === undefined ? undefined : { version: entry.version, type: "file", size: 262144 };
  };
  apply(harness.ctx, { readMaxBytes: 307200, readStreamMinSize: 262144 });
  const result = await harness.tools.find((tool) => tool.name === "file_read").execute(
    { files: [{ file_path: "big.txt" }] },
    { signal: new AbortController().signal },
  );
  assert.equal(streamed, 1);
  assert.deepEqual(result.files[0].lines.map((line) => line.text), ["alpha", "beta"]);
});
