/**
 * Determine the current environment in which the evaluations are running:
 * - BROWSERBASE or LOCAL
 *
 * Read lazily from `EVAL_ENV`. A module-level frozen constant would cache
 * the wrong value when the CLI applies per-run env overrides after this
 * module was already imported by the static graph.
 */

export function getEnv(): "BROWSERBASE" | "LOCAL" {
  return process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";
}
