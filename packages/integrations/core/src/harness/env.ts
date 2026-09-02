/** Only STAGEHAND_* and BROWSERBASE_* host env vars cross into harness processes. */
export function buildAllowlistedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/.test(key) && value) {
      env[key] = value;
    }
  }
  return env;
}
