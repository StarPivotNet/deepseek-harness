import { isBuiltin } from "node:module";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const hostPackage = process.env.DSH_HOST_PACKAGE;
if (hostPackage === undefined || hostPackage.length === 0) throw new Error("DSH_HOST_PACKAGE must point at the installed DSH Desktop package.json");
const require = createRequire(hostPackage);

export async function resolve(specifier, context, nextResolve) {
  if (!isBuiltin(specifier) && (specifier.startsWith("@deepseek-ai/") || specifier === "koffi")) return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
