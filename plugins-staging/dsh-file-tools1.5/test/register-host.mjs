import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./host-resolver.mjs", import.meta.url);
