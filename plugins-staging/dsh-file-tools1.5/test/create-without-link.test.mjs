import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { FsError } from "@deepseek-ai/dsh-fs";
import { createFileWithoutLink, replaceFileWithoutLink } from "../lib/create-without-link.js";

test("createFileWithoutLink publishes a missing file and preserves an occupied destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-file-tools-"));
  const missingParent = join(root, "nested", "created.txt");
  try {
    const created = await createFileWithoutLink(missingParent, "alpha\r\nbeta\n");
    assert.equal(created.operation, "create");
    assert.equal(created.before, null);
    assert.equal(created.after, "alpha\nbeta\n");
    assert.equal(await readFile(missingParent, "utf8"), "alpha\r\nbeta\n");

    const occupied = join(root, "occupied.txt");
    await writeFile(occupied, "kept\n");
    await assert.rejects(
      () => createFileWithoutLink(occupied, "replaced\n"),
      (error) => error instanceof FsError && error.code === "FS_NOT_OBSERVED",
    );
    assert.equal(await readFile(occupied, "utf8"), "kept\n");
    assert.deepEqual(await readdir(root), ["nested", "occupied.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createFileWithoutLink writes directly inside an existing drive root", async () => {
  if (process.platform !== "win32") return;
  const destination = join("D:\\", `dsh-file-tools-${process.pid}-${randomUUID()}.txt`);
  try {
    const created = await createFileWithoutLink(destination, "hello world\n");
    assert.equal(created.operation, "create");
    assert.equal(await readFile(destination, "utf8"), "hello world\n");
    assert.equal((await stat(destination)).isFile(), true);
    const replaced = await replaceFileWithoutLink(destination, "hello dsh\n", created.version);
    assert.equal(replaced.operation, "update");
    assert.equal(await readFile(destination, "utf8"), "hello dsh\n");
    await assert.rejects(
      () => replaceFileWithoutLink(destination, "stale\n", created.version),
      (error) => error instanceof FsError && error.code === "FS_STALE_VERSION",
    );
    assert.equal(await readFile(destination, "utf8"), "hello dsh\n");
  } finally {
    await rm(destination, { force: true });
  }
});
