import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distEsmRoot = path.resolve(rootDir, "dist", "esm");

const fileExtensions = [".js", ".mjs", ".cjs"];

const isFile = (candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const resolveDistFile = (candidate) => {
  const ext = path.extname(candidate);
  if (ext) {
    const jsCandidate = candidate.replace(ext, ".js");
    if (isFile(jsCandidate)) return jsCandidate;
  }
  for (const extName of fileExtensions) {
    const withExt = `${candidate}${extName}`;
    if (isFile(withExt)) return withExt;
  }
  const indexCandidate = path.join(candidate, "index.js");
  if (isFile(indexCandidate)) return indexCandidate;
  return null;
};

const resolveStagehandSpecifier = (source) => {
  if (source === "@browserbasehq/stagehand") {
    return resolveDistFile(path.join(distEsmRoot, "index.js"));
  }
  if (!source.startsWith("@browserbasehq/stagehand/")) return null;
  const subpath = source.slice("@browserbasehq/stagehand/".length);
  return resolveDistFile(path.join(distEsmRoot, subpath));
};

export default defineConfig({
  plugins: [
    {
      name: "stagehand-dist-resolver",
      enforce: "pre",
      resolveId(source) {
        const stagehandMatch = resolveStagehandSpecifier(source);
        if (stagehandMatch) return stagehandMatch;
        return null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["dist/esm/tests/**/*.test.js"],
  },
});
