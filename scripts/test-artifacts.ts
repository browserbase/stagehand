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
) => (coverageDir ? { ...env, NODE_V8_COVERAGE: coverageDir } : env);

export const withCtrfEnv = (
  env: Record<string, string | undefined>,
  junitPath: string | null,
) => (junitPath ? { ...env, CTRF_JUNIT_PATH: junitPath } : env);

export const maybeWriteCtrf = (
  junitPath: string | null,
  writer: (path: string, tool: string) => void,
  tool: string,
) => {
  if (junitPath) writer(junitPath, tool);
};
