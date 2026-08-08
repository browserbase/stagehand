import { access, chmod, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const executable = new URL("../dist/codemode/stdio-server.mjs", import.meta.url);
const contents = await readFile(executable, "utf8");
if (!contents.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("The compiled stagehand-codemode executable is missing its Node shebang");
}

await chmod(executable, 0o755);
await access(executable, constants.X_OK);
