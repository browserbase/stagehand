import { EvalArgs, EvalInput, EvalResult } from "./types/evals.js";

function scorePass(args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>): number {
  const expected = args.expected ?? true;
  if (expected === true) {
    return typeof args.output === "boolean" ? (args.output ? 1 : 0) : args.output._success ? 1 : 0;
  }

  return args.output === expected ? 1 : 0;
}

export function exactMatch(
  args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>,
): EvalResult {
  return {
    name: "Exact match",
    score: scorePass(args),
  };
}

export function passRate(
  args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>,
): EvalResult {
  return {
    name: "Pass",
    score: scorePass(args),
  };
}

export function errorMatch(
  args: EvalArgs<EvalInput, boolean | { _success: boolean; error?: unknown }, unknown>,
): EvalResult {
  return {
    name: "Error rate",
    score: typeof args.output === "object" && args.output.error !== undefined ? 1 : 0,
  };
}
