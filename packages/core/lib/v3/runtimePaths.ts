/**
 * Keep this file in sync with:
 * - /Users/squash/Code/bb/stagehand/packages/core/lib/v3/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/server/scripts/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/evals/runtimePaths.ts
 * - /Users/squash/Code/bb/stagehand/packages/docs/scripts/runtime-paths.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const PACKAGE_SEGMENT = "/packages/core/";

const normalizePath = (value: string): string => {
  const input = value.startsWith("file://") ? fileURLToPath(value) : value;
  return path.resolve(input).replaceAll("\\", "/");
};

const readCallsites = (): NodeJS.CallSite[] => {
  const previousPrepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, stack) => stack;
    return (
      (new Error().stack as unknown as NodeJS.CallSite[] | undefined) ?? []
    );
  } finally {
    Error.prepareStackTrace = previousPrepare;
  }
};

const helperFilePath = (() => {
  for (const callsite of readCallsites()) {
    const fileName = callsite.getFileName();
    if (!fileName || fileName.startsWith("node:")) continue;
    return normalizePath(fileName);
  }
  throw new Error("Unable to resolve runtimePaths helper location.");
})();

const resolveCallerFilePath = (): string => {
  for (const callsite of readCallsites()) {
    const fileName = callsite.getFileName();
    if (!fileName || fileName.startsWith("node:")) continue;
    const normalized = normalizePath(fileName);
    if (normalized === helperFilePath) continue;
    return normalized;
  }
  throw new Error("Unable to resolve caller file path.");
};

export const getCurrentFilePath = (): string => resolveCallerFilePath();

export const getCurrentDirPath = (): string =>
  path.dirname(getCurrentFilePath());

export const getRepoRootDir = (): string => {
  const currentFilePath = getCurrentFilePath();
  const index = currentFilePath.lastIndexOf(PACKAGE_SEGMENT);
  if (index === -1) {
    throw new Error(
      `Unable to determine repo root from ${currentFilePath} (missing ${PACKAGE_SEGMENT}).`,
    );
  }
  return currentFilePath.slice(0, index);
};

export const getPackageRootDir = (): string =>
  `${getRepoRootDir()}${PACKAGE_SEGMENT.slice(0, -1)}`;

export const createRequireFromCaller = () =>
  createRequire(getCurrentFilePath());

export const isMainModule = (): boolean => {
  const entryScript = process.argv.at(1);
  if (!entryScript) return false;
  return normalizePath(entryScript) === getCurrentFilePath();
};
