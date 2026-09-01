import type { LogLine } from "stagehand-v3";
import type { TaskResult } from "./types.js";

export const BROWSER_SESSION_LOG_CATEGORY = "session";

/** Where the browser behind a run lives, resolved before the agent starts. */
export interface BrowserSessionInfo {
  provider: "browserbase" | "local";
  sessionId?: string;
  sessionUrl?: string;
  debugUrl?: string;
}

export function browserbaseSessionUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${sessionId}`;
}

/**
 * Read the session fields core tools and runner-provided targets publish on
 * their `metadata` (`browserbaseSessionId` / `browserbaseSessionUrl` /
 * `browserbaseDebugUrl`). Falls back to the bare provider when a Browserbase
 * surface does not report its session id (browse_cli).
 */
export function browserSessionFromMetadata(
  metadata: Record<string, unknown> | undefined,
  environment: "LOCAL" | "BROWSERBASE",
): BrowserSessionInfo {
  if (environment !== "BROWSERBASE") return { provider: "local" };
  const rawUrl = readString(metadata?.browserbaseSessionUrl);
  const sessionId =
    readString(metadata?.browserbaseSessionId) ?? rawUrl?.match(/\/sessions\/([^/?#]+)/u)?.[1];
  const sessionUrl = rawUrl ?? (sessionId ? browserbaseSessionUrl(sessionId) : undefined);
  const debugUrl = readString(metadata?.browserbaseDebugUrl);
  return {
    provider: "browserbase",
    ...(sessionId && { sessionId }),
    ...(sessionUrl && { sessionUrl }),
    ...(debugUrl && { debugUrl }),
  };
}

export function formatBrowserSessionMessage(info: BrowserSessionInfo): string {
  if (info.provider === "local") return "Browser: local";
  if (!info.sessionUrl) return "Browser: browserbase (session id not reported by this surface)";
  return `Browserbase session: ${info.sessionUrl}`;
}

/** Level-0 lines so the session pointer survives every log filter. */
export function buildBrowserSessionLogLines(info: BrowserSessionInfo): LogLine[] {
  const lines: LogLine[] = [
    {
      category: BROWSER_SESSION_LOG_CATEGORY,
      level: 0,
      message: formatBrowserSessionMessage(info),
      auxiliary: {
        provider: { value: info.provider, type: "string" },
        ...(info.sessionId && { sessionId: { value: info.sessionId, type: "string" } }),
        ...(info.sessionUrl && { sessionUrl: { value: info.sessionUrl, type: "string" } }),
      },
    },
  ];
  if (info.debugUrl) {
    lines.push({
      category: BROWSER_SESSION_LOG_CATEGORY,
      level: 0,
      message: `Browserbase debugger: ${info.debugUrl}`,
    });
  }
  return lines;
}

export function logBrowserSession(sink: { log(line: LogLine): void }, info: BrowserSessionInfo) {
  for (const line of buildBrowserSessionLogLines(info)) sink.log(line);
}

/** Surface the session on the TaskResult row so Braintrust output is filterable. */
export function withBrowserSession(result: TaskResult, info: BrowserSessionInfo): TaskResult {
  return {
    ...result,
    browserProvider: info.provider,
    ...(info.sessionId && { browserbaseSessionId: info.sessionId }),
    ...(info.sessionUrl && { sessionUrl: result.sessionUrl || info.sessionUrl }),
    ...(info.debugUrl && { debugUrl: result.debugUrl || info.debugUrl }),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
