import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagehandPackage = "@browserbasehq/stagehand";
const coreRoot = path.join(repoRoot, "packages", "core");
const coreLibRoot = path.join(coreRoot, "lib");
const distEsmRoot = path.join(coreRoot, "dist", "esm");

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
    if (ext === ".generated") {
      const generatedCandidate = `${candidate}.js`;
      if (isFile(generatedCandidate)) return generatedCandidate;
    }
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

const shouldSkipLibPath = (resolvedPath) =>
  resolvedPath.includes(
    `${path.sep}lib${path.sep}v3${path.sep}tests${path.sep}`,
  );

const mapLibPathToDist = (resolvedPath) => {
  if (!resolvedPath.startsWith(coreLibRoot + path.sep)) return null;
  if (shouldSkipLibPath(resolvedPath)) return null;
  const rel = path.relative(coreRoot, resolvedPath);
  const candidate = path.join(distEsmRoot, rel);
  return resolveDistFile(candidate);
};

const resolveStagehandSpecifier = (specifier) => {
  if (specifier === stagehandPackage) {
    return resolveDistFile(path.join(distEsmRoot, "index.js"));
  }
  if (!specifier.startsWith(`${stagehandPackage}/`)) return null;
  const subpath = specifier.slice(stagehandPackage.length + 1);
  const candidate = path.join(distEsmRoot, subpath);
  return resolveDistFile(candidate);
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:")) {
    return nextResolve(specifier, context);
  }

  const stagehandResolved = resolveStagehandSpecifier(specifier);
  if (stagehandResolved) {
    return {
      url: pathToFileURL(stagehandResolved).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const resolved = fileURLToPath(new URL(specifier, context.parentURL));
    const mapped = mapLibPathToDist(resolved);
    if (mapped) {
      return {
        url: pathToFileURL(mapped).href,
        shortCircuit: true,
      };
    }
    const resolvedExt = path.extname(resolved);
    if (!resolvedExt || resolvedExt === ".generated") {
      const withExtension = resolveDistFile(resolved);
      if (withExtension) {
        return {
          url: pathToFileURL(withExtension).href,
          shortCircuit: true,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}
