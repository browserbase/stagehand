export function getEnv(): "BROWSERBASE" | "LOCAL" {
  return process.env.EVAL_ENV?.toLowerCase() === "browserbase" ? "BROWSERBASE" : "LOCAL";
}
