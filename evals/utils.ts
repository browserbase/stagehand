/**
 * This file provides utility functions and classes to assist with evaluation tasks.
 *
 * Key functionalities:
 * - String normalization and fuzzy comparison utility functions to compare output strings
 *   against expected results in a flexible and robust way.
 * - Generation of unique experiment names based on the current timestamp, environment,
 *   and eval name or category.
 */

import { LogLine } from "@browserbasehq/stagehand";
import stringComparison from "string-comparison";
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
