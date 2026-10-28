"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { traceLines, scanGates } = require("../jsc");

test("writeBack when the same function writes moduleStatus and calls checkActivation", () => {
  const report = scanGates([
    {
      file: "act.jsc",
      index: 1,
      funcName: "",
      methodName: "saveActivationState",
      fields: [{ pc: 10, dir: "put", atom: "moduleStatus" }],
      calls: [{ pc: 4, callee: "checkActivation", argc: 0, args: [] }],
      statusReturn: null,
    },
  ]);
  assert.equal(report.writeBack, true);
  assert.equal(report.fieldWrites.length, 1);
  assert.equal(report.fieldWrites[0].atom, "moduleStatus");
});

test("score storage alone is not a writeBack", () => {
  const report = scanGates([
    {
      file: "game.jsc",
      index: 3,
      funcName: "",
      methodName: "saveScore",
      fields: [],
      calls: [{ pc: 8, callee: "setStorage", argc: 1, args: ["score"] }],
      statusReturn: null,
    },
  ]);
  assert.equal(report.writeBack, false);
  assert.equal(report.storageSets.length, 1);
  assert.equal(report.storageSets[0].key, "score");
  assert.equal(report.fieldWrites.length, 0);
});

test("empty cpool array returned by a function is shape empty", () => {
  const traced = traceLines(
    {
      cpool: [{ type: "array", items: [] }],
      locals: [],
      closures: [],
    },
    [
      { pc: 0, name: "push_const", fmt: "const", size: 5, args: { constIndex: 0 } },
      { pc: 5, name: "return", fmt: "none", size: 1, args: {} },
    ]
  );
  assert.ok(traced.statusReturn);
  assert.equal(traced.statusReturn.shape, "empty");
});

test("label8 target is an absolute pc", () => {
  const traced = traceLines(
    { locals: [], closures: [], cpool: [] },
    [{ pc: 0, name: "if_false8", fmt: "label8", size: 2, args: { imm: 5 } }]
  );
  assert.equal(traced.edges[0].target, 6);
});

test("an empty status return plus a moduleStatus write in another function is writeBack", () => {
  const report = scanGates([
    {
      file: "app.jsc",
      index: 2,
      funcName: "",
      methodName: "checkActivation",
      fields: [],
      calls: [],
      statusReturn: { shape: "empty" },
    },
    {
      file: "act.jsc",
      index: 4,
      funcName: "",
      methodName: "saveActivationState",
      fields: [{ pc: 20, dir: "put", atom: "moduleStatus" }],
      calls: [],
      statusReturn: null,
    },
  ]);
  assert.equal(report.writeBack, true);
  assert.equal(report.statusReturns[0].shape, "empty");
  assert.equal(report.fieldWrites[0].file, "act.jsc");
});
