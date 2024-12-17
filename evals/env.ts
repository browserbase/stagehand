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

/**
 * Enable or disable caching based on the EVAL_ENABLE_CACHING environment variable.
 * Caching may improve performance by not re-fetching or re-computing certain results.
 * By default, caching is disabled unless explicitly enabled.
 */
export const enableCaching =
  process.env.EVAL_ENABLE_CACHING?.toLowerCase() === "true";
