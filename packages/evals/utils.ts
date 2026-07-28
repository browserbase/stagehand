/**
 * This file provides utility functions and classes to assist with evaluation tasks.
 *
 * Key functionalities:
 * - String normalization and fuzzy comparison utility functions to compare output strings
 *   against expected results in a flexible and robust way.
 * - Generation of unique experiment names based on the current timestamp, environment,
 *   and eval name or category.
 */
import fs from "fs";
import { LogLine } from "stagehand-v3";
import type { AgentModelEntry } from "./types/evals.js";
import { inferDefaultStagehandAgentMode } from "./framework/agentModelModes.js";
export { compareStrings, normalizeString } from "./scoring.js";

/**
 * generateTimestamp:
 * Generates a timestamp string formatted as "YYYYMMDDHHMMSS".
 * Used to create unique experiment names, ensuring that results can be
 * distinguished by the time they were generated.
 */
export function generateTimestamp(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:TZ]/g, "")
    .slice(0, 14);
}

/**
 * generateExperimentName:
 * Returns just the target label. Braintrust handles uniqueness via IDs.
 * All context (env, tool, startup) goes into experiment metadata instead.
 */
export function generateExperimentName({
  evalName,
  category,
}: {
  evalName?: string;
  category?: string;
  environment?: string;
  toolSurface?: string;
  startupProfile?: string;
}): string {
  if (evalName) return evalName;
  if (category) return category;
  return "all";
}

function clipLogLine(line: string): string {
  const terminalWidth = process.stdout.columns;
  const maxWidth = typeof terminalWidth === "number" && terminalWidth > 8 ? terminalWidth - 1 : 119;

  if (line.length <= maxWidth) {
    return line;
  }

  return `${line.slice(0, maxWidth - 1)}…`;
}

function clipLogOutput(output: string): string {
  return output
    .split("\n")
    .map((line) => clipLogLine(line))
    .join("\n");
}

export function logLineToString(logLine: LogLine): string {
  try {
    const timestamp = logLine.timestamp || new Date().toISOString();
    if (logLine.auxiliary?.error) {
      const errorValue = logLine.auxiliary.error?.value ?? "";
      const traceValue = logLine.auxiliary.trace?.value ?? "";
      const traceSuffix = traceValue ? `\n ${traceValue}` : "";
      return clipLogOutput(
        `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${errorValue}${traceSuffix}`,
      );
    }
    return clipLogOutput(
      `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
        logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
      }`,
    );
  } catch (error) {
    console.error(`Error logging line:`, error);
    return "error logging line";
  }
}

export function dedent(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Interleave raw strings with substitution values
  const raw = strings.raw;
  let result = "";

  for (let i = 0; i < raw.length; i++) {
    result += raw[i]
      // replace newline + any mix of spaces/tabs with “\n”
      .replace(/\n[ \t]+/g, "\n")
      .replace(/^\n/, ""); // remove leading newline
    if (i < values.length) result += values[i];
  }

  // trim trailing/leading blank lines
  return result.trimEnd();
}

// Dataset helpers shared by suites

export function sampleUniform<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  if (k >= n) return arr.slice();
  const copy = arr.slice();
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, k);
}

export function readJsonlFile(filePath: string): string[] {
  let lines: string[];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  } catch (e) {
    console.warn(
      `Could not read file at ${filePath}. Error: ${e instanceof Error ? e.message : String(e)}`,
    );
    lines = [];
  }
  return lines;
}

export function parseJsonlRows<T>(
  lines: string[],
  validator: (parsed: unknown) => parsed is T,
): T[] {
  const candidates: T[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (validator(parsed)) {
        candidates.push(parsed);
      }
    } catch {
      // skip invalid lines
    }
  }
  return candidates;
}

export function applySampling<T>(
  candidates: T[],
  sampleCount?: number,
  maxCases: number = 25,
): T[] {
  if (sampleCount && sampleCount > 0) {
    return sampleUniform(candidates, sampleCount);
  } else {
    const result: T[] = [];
    for (const candidate of candidates) {
      result.push(candidate);
      if (result.length >= maxCases) break;
    }
    return result;
  }
}

export function normalizeAgentModelEntries(
  models: string[] | AgentModelEntry[],
): AgentModelEntry[] {
  if (models.length === 0) return [];
  if (typeof models[0] !== "string") return models as AgentModelEntry[];

  return (models as string[]).map((modelName) => {
    const mode = inferDefaultStagehandAgentMode(modelName);
    return { modelName, mode, cua: mode === "cua" };
  });
}
