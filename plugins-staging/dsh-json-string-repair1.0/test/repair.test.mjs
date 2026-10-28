import assert from "node:assert/strict";
import test from "node:test";
import { createScanner, repairChunk, repairJsonControls } from "../lib/repair.js";

test("escapes a raw newline inside a long string and parses", () => {
  const head = `{"content":"${"x".repeat(1000)}`;
  const broken = `${head}\nmore"}`;
  assert.throws(() => JSON.parse(broken), /control character/);
  const repaired = repairJsonControls(broken);
  assert.equal(JSON.parse(repaired).content, `${"x".repeat(1000)}\nmore`);
});

test("keeps escaped newlines and whitespace outside strings", () => {
  const text = "{\n\t\"a\": \"line\\nstill\"\n}";
  assert.equal(repairJsonControls(text), text);
});

test("repairs a tool-call delta split across chunks", () => {
  const scanners = new Map();
  const first = repairChunk({
    type: "tool-call-delta",
    index: 0,
    id: "call-1",
    name: "file_write",
    argumentsDelta: "{\"content\":\"hello",
  }, scanners);
  const second = repairChunk({
    type: "tool-call-delta",
    index: 0,
    id: "call-1",
    argumentsDelta: "\nworld\"}",
  }, scanners);
  const raw = first.argumentsDelta + second.argumentsDelta;
  assert.equal(JSON.parse(raw).content, "hello\nworld");
});

test("repairs block-end arguments and leaves other parse errors unchanged", () => {
  const chunk = repairChunk({
    type: "block-end",
    index: 1,
    block: {
      type: "tool-call",
      id: "call-2",
      name: "file_write",
      arguments: "{\"path\":\"a\"\t,\"content\":\"x\ry\"}",
    },
  }, new Map());
  assert.deepEqual(JSON.parse(chunk.block.arguments), { path: "a", content: "x\ry" });

  const broken = { type: "block-end", index: 2, block: { type: "tool-call", id: "call-3", name: "x", arguments: "{\"a\":" } };
  assert.equal(repairChunk(broken, new Map()), broken);
});

test("scanner does not treat an escaped quote as the string end", () => {
  const scanner = createScanner();
  const repaired = scanner.push("{\"a\":\"say \\\"hi\\\"\n\"}");
  assert.equal(JSON.parse(repaired).a, "say \"hi\"\n");
});
