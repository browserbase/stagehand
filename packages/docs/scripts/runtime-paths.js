/**
 * Keep this file in sync with:
 * - /Users/squash/Code/bb/stagehand/packages/core/lib/v3/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/server/scripts/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/evals/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/docs/scripts/runtime-paths.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SEGMENT = "/packages/docs/";

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

const helperFilePath = (() => {
  for (const callsite of readCallsites()) {
    const fileName = callsite.getFileName?.();
    if (!fileName || fileName.startsWith("node:")) continue;
    return normalizePath(fileName);
  }
  throw new Error("Unable to resolve runtime-paths helper location.");
})();

const resolveCallerFilePath = () => {
  for (const callsite of readCallsites()) {
    const fileName = callsite.getFileName?.();
    if (!fileName || fileName.startsWith("node:")) continue;
    const normalized = normalizePath(fileName);
    if (normalized === helperFilePath) continue;
    return normalized;
  }
  throw new Error("Unable to resolve caller file path.");
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
