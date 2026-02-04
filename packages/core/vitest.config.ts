import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = rootDir;
const coreLibRoot = path.resolve(coreRoot, "lib");
const distEsmRoot = path.resolve(rootDir, "dist", "esm");

const fileExtensions = [".js", ".mjs", ".cjs"];

const isFile = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const resolveDistFile = (candidate: string): string | null => {
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

const shouldSkipLibPath = (resolvedPath: string): boolean =>
  resolvedPath.includes(
    `${path.sep}lib${path.sep}v3${path.sep}tests${path.sep}`,
  );

const mapLibPathToDist = (resolvedPath: string): string | null => {
  if (!resolvedPath.startsWith(coreLibRoot + path.sep)) return null;
  if (shouldSkipLibPath(resolvedPath)) return null;
  const rel = path.relative(coreRoot, resolvedPath);
  const candidate = path.join(distEsmRoot, rel);
  return resolveDistFile(candidate);
};

const resolveStagehandSpecifier = (source: string): string | null => {
  if (source === "@browserbasehq/stagehand") {
    return resolveDistFile(path.join(distEsmRoot, "index.js"));
  }
  if (!source.startsWith("@browserbasehq/stagehand/")) return null;
  const subpath = source.slice("@browserbasehq/stagehand/".length);
  const candidate = path.join(distEsmRoot, subpath);
  return resolveDistFile(candidate);
};

export default defineConfig({
  plugins: [
    {
      name: "stagehand-dist-resolver",
      enforce: "pre",
      resolveId(source, importer) {
        const stagehandMatch = resolveStagehandSpecifier(source);
        if (stagehandMatch) return stagehandMatch;

        if (
          !importer ||
          (!source.startsWith(".") && !path.isAbsolute(source))
        ) {
          return null;
        }

        const importerPath = importer.startsWith("file:")
          ? fileURLToPath(importer)
          : importer.split("?")[0];
        const resolved = path.resolve(path.dirname(importerPath), source);
        const mapped = mapLibPathToDist(resolved);
        return mapped ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
