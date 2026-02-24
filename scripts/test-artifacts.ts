/**
 * Shared helpers for test artifacts (coverage + CTRF/JUnit).
 */
import fs from "node:fs";
import path from "node:path";

export const isTestCoverageEnabled = () =>
  process.env.TEST_COVERAGE === "1" || process.env.TEST_COVERAGE === "true";

export const initCoverageDir = (
  dir: string,
  enabled = isTestCoverageEnabled(),
) => {
  if (!enabled) return null;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const initJunitPath = (
  filePath: string,
  enabled = isTestCoverageEnabled(),
) => {
  if (!enabled) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
};

export const withCoverageEnv = (
  env: Record<string, string | undefined>,
  coverageDir: string | null,
) => {
  if (coverageDir) return { ...env, NODE_V8_COVERAGE: coverageDir };
  const cleaned = { ...env };
  delete cleaned.NODE_V8_COVERAGE;
  return cleaned;
};

export const withCtrfEnv = (
  env: Record<string, string | undefined>,
  junitPath: string | null,
) => {
  if (junitPath) return { ...env, CTRF_JUNIT_PATH: junitPath };
  const cleaned = { ...env };
  delete cleaned.CTRF_JUNIT_PATH;
  return cleaned;
};

export const maybeWriteCtrf = (
  junitPath: string | null,
  writer: (path: string, tool: string) => void,
  tool: string,
) => {
  if (junitPath) writer(junitPath, tool);
};
