import { readFile, writeFile } from "node:fs/promises";

// Keep Eve's native tool exports and their shared session instance intact.
for (const extension of ["mjs", "d.ts"]) {
  const entry = new URL(`../dist/tools/index.${extension}`, import.meta.url);
  const nativeTools = await readFile(entry, "utf8");
  const exports =
    extension === "d.ts"
      ? 'export { browserbaseWebFetch, browserbaseWebSearch, type BrowserbaseWebToolConfig } from "./web.js";'
      : 'export { browserbaseWebFetch, browserbaseWebSearch } from "./web.mjs";';
  await writeFile(entry, `${nativeTools}\n${exports}\n`);
}
