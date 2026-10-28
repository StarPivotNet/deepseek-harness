import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const localAppData = process.env.LOCALAPPDATA;
const installed = localAppData === undefined ? undefined : `${localAppData}\\Programs\\DSH Desktop\\resources\\app\\package.json`;
const hostPackage = process.env.DSH_HOST_PACKAGE ?? (installed !== undefined && existsSync(installed) ? installed : undefined);
if (hostPackage === undefined) {
  process.stderr.write("DSH_HOST_PACKAGE must point at the installed DSH Desktop package.json\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "./test/register-host.mjs", "--test", "test/file-tools.test.mjs", "test/create-without-link.test.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, DSH_HOST_PACKAGE: hostPackage },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
