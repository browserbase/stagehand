/**
 * Determine the current environment in which the evaluations are running:
 * - BROWSERBASE or LOCAL
 *
 * The environment is read from the EVAL_ENV environment variable.
 */
export const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";
