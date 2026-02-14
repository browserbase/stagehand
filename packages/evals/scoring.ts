/**
 * This file implements scoring functions needed by braintrust.
 */

import { EvalArgs, EvalInput, EvalResult } from "./types/evals";

function formatTaskOutput(output: unknown): string {
  let value: string | undefined;
  if (typeof output === "string") {
    value = output;
  } else if (output instanceof Error) {
    value = output.stack ?? `${output.name}: ${output.message}`;
  } else {
    try {
      value = JSON.stringify(output, (_key, current) => {
        if (current instanceof Error) {
          return {
            name: current.name,
            message: current.message,
            stack: current.stack,
          };
        }
        return current;
      });
    } catch {
      value = undefined;
    }
    if (value === undefined) {
      value = String(output);
    }
  }

  if (value.length > 160) {
    return `${value.slice(0, 157)}...`;
  }
  return value;
}

/**
 * Scoring function: exactMatch
 * Given the arguments (including input, output, and expected result),
 * this returns a score of 1 if the result matches the expectation, and 0 otherwise.
 *
 * If "expected" is true, it checks if the output indicates success.
 * If "expected" is a boolean or an object with _success flag,
 * it checks if output is exactly that success condition.
 */
export function exactMatch(
  args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>,
): EvalResult {
  console.log(
    `Task "${args.input.name}" returned: ${formatTaskOutput(args.output)}`,
  );

  const expected = args.expected ?? true;
  if (expected === true) {
    // If we expect a success (true), then we check the output's _success flag.
    return {
      name: "Exact match",
      score:
        typeof args.output === "boolean"
          ? args.output
            ? 1
            : 0
          : args.output._success
            ? 1
            : 0,
    };
  }

  // If expected is not true, just directly compare the output to expected.
  return {
    name: "Exact match",
    score: args.output === expected ? 1 : 0,
  };
}

/**
 * Scoring function: errorMatch
 * Determines if an error occurred in the task.
 * Scores 1 if an error is found, otherwise 0.
 */
export function errorMatch(
  args: EvalArgs<
    EvalInput,
    boolean | { _success: boolean; error?: unknown },
    unknown
  >,
): EvalResult {
  console.log(
    `Task "${args.input.name}" returned: ${formatTaskOutput(args.output)}`,
  );

  return {
    name: "Error rate",
    score:
      typeof args.output === "object" && args.output.error !== undefined
        ? 1
        : 0,
  };
}
