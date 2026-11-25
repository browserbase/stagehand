import fs from "fs";
import { LogLine } from "stagehand-v3";
import stringComparison from "string-comparison";
import type { AgentModelEntry } from "./types/evals.js";
import { inferDefaultStagehandAgentMode } from "./framework/agentModelModes.js";
const { jaroWinkler } = stringComparison;

export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

export function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinkler.similarity(normalizeString(actual), normalizeString(expected));
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}

export function generateTimestamp(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:TZ]/g, "")
    .slice(0, 14);
}

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
  const raw = strings.raw;
  let result = "";

  for (let i = 0; i < raw.length; i++) {
    result += raw[i].replace(/\n[ \t]+/g, "\n").replace(/^\n/, "");
    if (i < values.length) result += values[i];
  }

  return result.trimEnd();
}

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
    } catch {}
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
