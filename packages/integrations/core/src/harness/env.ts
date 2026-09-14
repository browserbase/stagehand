/** Only STAGEHAND_* and BROWSERBASE_* host env vars cross into harness processes. */
export function buildAllowlistedEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/u.test(key) && value) {
      env[key] = value;
    }
  }
  return env;
}
