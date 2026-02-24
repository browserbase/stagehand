/**
 * Keep this file in sync with:
 * - /packages/core/lib/v3/runtimePaths.ts
 * - /packages/server/scripts/runtimePaths.ts
 * - /packages/evals/runtimePaths.ts
 * - /packages/docs/scripts/runtimePaths.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const PACKAGE_SEGMENT = "/packages/evals/";
const EVAL_FRAMES = new Set(["[eval]", "[eval]-wrapper"]);
const RUNTIME_PATHS_FILES = new Set(["runtimePaths.ts", "runtimePaths.js"]);

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

type CallSiteWithScriptName = NodeJS.CallSite & {
  getScriptNameOrSourceURL?: () => string | null;
};

const readCallsitePath = (callsite: NodeJS.CallSite): string | null => {
  const callsiteWithScript = callsite as CallSiteWithScriptName;
  const rawPath =
    callsite.getFileName() ?? callsiteWithScript.getScriptNameOrSourceURL?.();
  if (!rawPath) return null;
  if (rawPath.startsWith("node:")) return null;
  if (EVAL_FRAMES.has(rawPath)) return null;
  return normalizePath(rawPath);
};

const isRuntimePathsFile = (value: string): boolean =>
  RUNTIME_PATHS_FILES.has(path.basename(value));

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
  throw new Error("Unable to resolve runtimePaths helper location.");
})();

const resolveCallerFilePath = (): string => {
  const packageCandidates: string[] = [];
  const fallbackCandidates: string[] = [];

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
