import { EvalsError } from "../../errors.js";

/**
 * Browserbase's project default session timeout (15 min) is shorter than many
 * benchmark tasks; every eval session gets an explicit one. Seconds, mirroring
 * the Browserbase API.
 */
export const DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 3600;
const MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 21_600;

export function evalBrowserbaseSessionTimeoutSeconds(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS;
  const parsed = Number(value);
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS
  ) {
    throw new EvalsError(
      `EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS must be a positive integer of at most ${MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS} seconds (got "${value}").`,
    );
  }
  return parsed;
}

export function evalBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  throw new EvalsError(`Expected a boolean env value, got "${raw}".`);
}

/**
 * Session settings shared by every Browserbase path the evals own — the
 * Stagehand facade (via STAGEHAND_* env) and the runner-provided CDP target
 * (playwright_mcp, chrome_devtools_mcp, playwright_code). Parity with the
 * native Stagehand agent path: proxied + verified sessions, explicit timeout.
 * EVAL_BROWSERBASE_PROXIES / _VERIFIED=0 to disable.
 */
export function evalBrowserbaseSessionOptions(env: NodeJS.ProcessEnv = process.env): {
  timeoutSeconds: number;
  proxies: boolean;
  verified: boolean;
} {
  return {
    timeoutSeconds: evalBrowserbaseSessionTimeoutSeconds(
      env.EVAL_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
    ),
    proxies: evalBooleanEnv(env.EVAL_BROWSERBASE_PROXIES, true),
    verified: evalBooleanEnv(env.EVAL_BROWSERBASE_VERIFIED, true),
  };
}
