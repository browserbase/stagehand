/**
 * Build canonical dist/ (CJS) output for the core package (including tests).
 *
 * Prereqs: pnpm install; run gen-version + build-dom-scripts first (turbo handles).
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cjs
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { getRepoRootDir } from "../lib/v3/runtimePaths.js";

const repoRoot = getRepoRootDir();

const runNodeScript = (scriptPath: string, args: string[]) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (result.error) {
    console.error(`Failed to run node ${scriptPath} ${args.join(" ")}`);
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(`${repoRoot}/packages/core/dist/cjs`, {
  recursive: true,
  force: true,
});
fs.mkdirSync(`${repoRoot}/packages/core/dist/cjs`, { recursive: true });

runNodeScript(`${repoRoot}/node_modules/typescript/bin/tsc`, [
  "-p",
  "packages/core/tsconfig.json",
  "--module",
  "commonjs",
  "--declaration",
  "--outDir",
  "packages/core/dist/cjs",
]);

fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/index.js`,
  `"use strict";
module.exports = require("./lib/v3/index.js");
`,
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/cli.js`,
  `#!/usr/bin/env node
"use strict";
require("./lib/v3/cli.js");
`,
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/index.d.ts`,
  `export * from "./lib/v3/index";
export { default } from "./lib/v3/index";
`,
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/package.json`,
  '{\n  "type": "commonjs"\n}\n',
);

fs.mkdirSync(`${repoRoot}/packages/core/dist/cjs/lib/v3/dom/build`, {
  recursive: true,
});
if (fs.existsSync(`${repoRoot}/packages/core/lib/v3/dom/build`)) {
  for (const file of fs.readdirSync(
    `${repoRoot}/packages/core/lib/v3/dom/build`,
  )) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(
        `${repoRoot}/packages/core/lib/v3/dom/build/${file}`,
        `${repoRoot}/packages/core/dist/cjs/lib/v3/dom/build/${file}`,
      );
    }
  }
}
