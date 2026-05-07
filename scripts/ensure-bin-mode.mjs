import { chmod, readFile } from "node:fs/promises";

const path = "dist/cli.js";
const text = await readFile(path, "utf8");
if (!text.startsWith("#!/usr/bin/env node")) {
  throw new Error("dist/cli.js is missing node shebang");
}
await chmod(path, 0o755);
