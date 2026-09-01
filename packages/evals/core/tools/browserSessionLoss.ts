import type { BrowserSessionLoss } from "../contracts/tool.js";

/**
 * Wire strings the facade stdio server emits when its browser session is gone.
 * Source of truth: packages/integrations/core/src/facade/contract.ts
 * (BROWSER_SESSION_LOST_ERROR_PREFIX, SESSION_LOST_TELEMETRY_PREFIX). Mirrored
 * here because evals consumes the integrations package through its built dist,
 * and a facade build is allowed to lag behind the runner.
 */
export const BROWSER_SESSION_LOST_ERROR_PREFIX = "Browser session lost (";
export const SESSION_LOST_TELEMETRY_PREFIX = "stagehand_facade_session_lost ";

export function isBrowserSessionLostError(message: string): boolean {
  return message.startsWith(BROWSER_SESSION_LOST_ERROR_PREFIX);
}

/** Extracts the cause from "Browser session lost (<cause>). ..." */
export function browserSessionLostCause(message: string): string | undefined {
  if (!isBrowserSessionLostError(message)) return undefined;
  return /^Browser session lost \((.*?)\)\./u.exec(message)?.[1] ?? message;
}

export function parseSessionLossTelemetry(line: string): BrowserSessionLoss | undefined {
  if (!line.startsWith(SESSION_LOST_TELEMETRY_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(line.slice(SESSION_LOST_TELEMETRY_PREFIX.length)) as Record<
      string,
      unknown
    >;
    if (typeof parsed.cause !== "string") return undefined;
    return {
      cause: parsed.cause,
      ...(typeof parsed.tool === "string" && { tool: parsed.tool }),
      ...(typeof parsed.at === "string" && { at: parsed.at }),
    };
  } catch {
    return undefined;
  }
}
