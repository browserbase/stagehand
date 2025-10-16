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
import { LogLine } from "@browserbasehq/stagehand";
import stringComparison from "string-comparison";
import sharp from "sharp";
const { jaroWinkler } = stringComparison;

/**
 * normalizeString:
 * Prepares a string for comparison by:
 * - Converting to lowercase
 * - Collapsing multiple spaces to a single space
 * - Removing punctuation and special characters that are not alphabetic or numeric
 * - Normalizing spacing around commas
 * - Trimming leading and trailing whitespace
 *
 * This helps create a stable string representation to compare against expected outputs,
 * even if the actual output contains minor formatting differences.
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

/**
 * compareStrings:
 * Compares two strings (actual vs. expected) using a similarity metric (Jaro-Winkler).
 *
 * Arguments:
 * - actual: The actual output string to be checked.
 * - expected: The expected string we want to match against.
 * - similarityThreshold: A number between 0 and 1. Default is 0.85.
 *   If the computed similarity is greater than or equal to this threshold,
 *   we consider the strings sufficiently similar.
 *
 * Returns:
 * - similarity: A number indicating how similar the two strings are.
 * - meetsThreshold: A boolean indicating if the similarity meets or exceeds the threshold.
 *
 * This function is useful for tasks where exact string matching is too strict,
 * allowing for fuzzy matching that tolerates minor differences in formatting or spelling.
 */
export function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinkler.similarity(
    normalizeString(actual),
    normalizeString(expected),
  );
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}

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
 * Creates a unique name for the experiment based on optional evalName or category,
 * the environment (e.g., dev or CI), and the current timestamp.
 * This is used to label the output files and directories.
 */
export function generateExperimentName({
  evalName,
  category,
  environment,
}: {
  evalName?: string;
  category?: string;
  environment: string;
}): string {
  const timestamp = generateTimestamp();
  if (evalName) {
    return `${evalName}_${environment.toLowerCase()}_${timestamp}`;
  }
  if (category) {
    return `${category}_${environment.toLowerCase()}_${timestamp}`;
  }
  return `all_${environment.toLowerCase()}_${timestamp}`;
}

export function logLineToString(logLine: LogLine): string {
  try {
    const timestamp = logLine.timestamp || new Date().toISOString();
    if (logLine.auxiliary?.error) {
      return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
    }
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
      logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
    }`;
  } catch (error) {
    console.error(`Error logging line:`, error);
    return "error logging line";
  }
}

export function dedent(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
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
  let lines: string[] = [];
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

export async function optimizedScreenshot(
  img: Buffer,
  scaleFactor: number,
): Promise<Buffer> {
  return await sharp(img).resize(scaleFactor).toBuffer();
}
