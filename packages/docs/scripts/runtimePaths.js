/**
 * Keep this file in sync with:
 * - /Users/squash/Code/bb/stagehand/packages/core/lib/v3/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/server/scripts/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/evals/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/docs/scripts/runtimePaths.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SEGMENT = "/packages/docs/";
const EVAL_FRAMES = new Set(["[eval]", "[eval]-wrapper"]);
const RUNTIME_PATHS_FILES = new Set([
  "runtimePaths.ts",
  "runtimePaths.js",
]);

const normalizePath = (value) => {
  const input = value.startsWith("file://") ? fileURLToPath(value) : value;
  return path.resolve(input).replaceAll("\\", "/");
};

const readCallsites = () => {
  const previousPrepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, stack) => stack;
    return new Error().stack ?? [];
  } finally {
    Error.prepareStackTrace = previousPrepare;
  }
};

const readCallsitePath = (callsite) => {
  const rawPath =
    callsite.getFileName?.() ?? callsite.getScriptNameOrSourceURL?.();
  if (!rawPath) return null;
  if (rawPath.startsWith("node:")) return null;
  if (EVAL_FRAMES.has(rawPath)) return null;
  return normalizePath(rawPath);
};

const isRuntimePathsFile = (value) => RUNTIME_PATHS_FILES.has(path.basename(value));

const helperFilePath = (() => {
  for (const callsite of readCallsites()) {
    const filePath = readCallsitePath(callsite);
    if (!filePath) continue;
    if (isRuntimePathsFile(filePath)) return filePath;
  }
  for (const callsite of readCallsites()) {
    const filePath = readCallsitePath(callsite);
    if (!filePath) continue;
    return filePath;
  }
  throw new Error("Unable to resolve runtime-paths helper location.");
})();

const resolveCallerFilePath = () => {
  const packageCandidates = [];
  const fallbackCandidates = [];

  for (const callsite of readCallsites()) {
    const filePath = readCallsitePath(callsite);
    if (!filePath) continue;
    if (filePath === helperFilePath) continue;
    if (filePath.includes(PACKAGE_SEGMENT)) {
      packageCandidates.push(filePath);
      continue;
    }
    fallbackCandidates.push(filePath);
  }

  return packageCandidates[0] ?? fallbackCandidates[0] ?? helperFilePath;
};

export const getCurrentFilePath = () => resolveCallerFilePath();

export const getCurrentDirPath = () => path.dirname(getCurrentFilePath());

export const getRepoRootDir = () => {
  const currentFilePath = getCurrentFilePath();
  const index = currentFilePath.lastIndexOf(PACKAGE_SEGMENT);
  if (index === -1) {
    throw new Error(
      `Unable to determine repo root from ${currentFilePath} (missing ${PACKAGE_SEGMENT}).`,
    );
  }
  return currentFilePath.slice(0, index);
};

export const isMainModule = () => {
  const entryScript = process.argv.at(1);
  if (!entryScript) return false;
  return normalizePath(entryScript) === getCurrentFilePath();
};
