import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { CLIENT_PIN_SCRIPT, injectHeadScript, patchDesktopRuntime } from "../lib/index.js";

const root = dirname(fileURLToPath(import.meta.url));

test("injectHeadScript places the pin before later head scripts", () => {
  const html = "<!doctype html><html><head><script>window.__later=1</script></head><body></body></html>";
  const out = injectHeadScript(html, "window.__pin=1");
  assert.match(out, /<head><script>window\.__pin=1<\/script><script>window\.__later=1<\/script>/);
});

test("patchDesktopRuntime admits every path and restores the original", async () => {
  const calls = [];
  const runtime = {
    async validateDirectory(path) {
      calls.push(path);
      return false;
    },
  };
  const restore = patchDesktopRuntime(runtime);
  assert.equal(await runtime.validateDirectory("D:\\desktop\\desktop"), true);
  assert.deepEqual(calls, []);
  restore();
  assert.equal(await runtime.validateDirectory("D:\\desktop\\desktop"), false);
  assert.deepEqual(calls, ["D:\\desktop\\desktop"]);
});

test("CLIENT_PIN_SCRIPT swallows native validator assignment and fetch", async () => {
  const fetches = [];
  const target = {
    location: { href: "http://127.0.0.1:43120/" },
    fetch(input) {
      fetches.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ allowed: false }), { status: 200 }));
    },
  };
  const sandbox = createContext({
    window: target,
    URL,
    Response,
    Promise,
    location: target.location,
    Object,
    JSON,
  });
  sandbox.window = sandbox;
  sandbox.location = target.location;
  Object.defineProperty(sandbox, "fetch", {
    configurable: true,
    writable: true,
    value: target.fetch.bind(target),
  });
  runInContext(CLIENT_PIN_SCRIPT, sandbox);
  sandbox.__DSH_DESKTOP_VALIDATE_DIRECTORY__ = async () => false;
  assert.equal(await sandbox.__DSH_DESKTOP_VALIDATE_DIRECTORY__("D:\\desktop\\desktop"), true);
  const response = await sandbox.fetch("/_dsh/desktop/validate-directory", {
    method: "POST",
    body: JSON.stringify({ path: "D:\\desktop\\desktop" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { allowed: true });
  assert.deepEqual(fetches, []);
});

test("HTTP handler sees the patched runtime.validateDirectory", async () => {
  const runtime = {
    async validateDirectory() { return false; },
  };
  patchDesktopRuntime(runtime);
  const allowed = await runtime.validateDirectory("D:\\desktop\\desktop");
  assert.equal(allowed, true);
});

test("client bundle registers the expected module id", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /id:\s*"dsh-exfat-workspace"/);
  assert.match(source, /__DSH_DESKTOP_VALIDATE_DIRECTORY__/);
});
