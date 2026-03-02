/**
 * Keep this file in sync with:
 * - /packages/core/lib/v3/runtimePaths.ts
 * - /packages/server/scripts/runtimePaths.ts
 * - /packages/evals/runtimePaths.ts
 * - /packages/docs/scripts/runtimePaths.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SEGMENT = "/packages/docs/";
const EVAL_FRAMES = new Set(["[eval]", "[eval]-wrapper"]);
const INTERNAL_FRAME_NAMES = new Set([
  "readCallsites",
  "readCallsitePath",
  "resolveCallerFilePath",
  "getCurrentFilePath",
  "getCurrentDirPath",
  "getRepoRootDir",
  "isMainModule",
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

const isInternalCallsite = (callsite) => {
  const functionName = callsite.getFunctionName?.();
  if (functionName && INTERNAL_FRAME_NAMES.has(functionName)) return true;

  const methodName = callsite.getMethodName?.();
  if (methodName && INTERNAL_FRAME_NAMES.has(methodName)) return true;

  const callsiteString = callsite.toString?.() ?? "";
  for (const frameName of INTERNAL_FRAME_NAMES) {
    if (callsiteString.includes(`${frameName} (`)) return true;
    if (callsiteString.includes(`.${frameName} (`)) return true;
  }
  return false;
};

const resolveCallerFilePath = () => {
  const packageCandidates = [];
  const fallbackCandidates = [];

  for (const callsite of readCallsites()) {
    const filePath = readCallsitePath(callsite);
    if (!filePath) continue;
    if (isInternalCallsite(callsite)) continue;
    if (filePath.includes(PACKAGE_SEGMENT)) {
      packageCandidates.push(filePath);
      continue;
    }
    fallbackCandidates.push(filePath);
  }

  const packageCandidate = packageCandidates[0];
  if (packageCandidate) return packageCandidate;

  const fallbackCandidate = fallbackCandidates[0];
  if (fallbackCandidate) return fallbackCandidate;

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

export const isMainModule = () => {
  const entryScript = process.argv.at(1);
  if (!entryScript) return false;
  return normalizePath(entryScript) === getCurrentFilePath();
};
