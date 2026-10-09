import { z } from "zod/v4";

const BrowserVersionSchema = z.object({
  webSocketDebuggerUrl: z.string().min(1),
});

const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;

export type ResidentBrowserProxyErrorCode =
  | "RESIDENT_PROXY_UNAVAILABLE"
  | "RESIDENT_PROXY_NOT_READY"
  | "RESIDENT_PROXY_FORBIDDEN";

export class ResidentBrowserProxyError extends Error {
  readonly status?: number;

  constructor(
    readonly code: ResidentBrowserProxyErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message.includes(code) ? message : `${code}: ${message}`, { cause: options?.cause });
    this.name = "ResidentBrowserProxyError";
    this.status = options?.status;
  }
}

export type ResidentBrowserProxyResolverOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export async function resolveResidentBrowserWebSocketUrl(
  browserProxyUrl: string,
  options: ResidentBrowserProxyResolverOptions = {},
): Promise<string> {
  const proxyUrl = parseBrowserProxyUrl(browserProxyUrl);
  const abortController = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  const timeout = setTimeout(
    () =>
      abortController.abort(
        new Error(`Resident browser proxy version request timed out after ${timeoutMs}ms`),
      ),
    timeoutMs,
  );

  try {
    const versionUrl = new URL("/json/version", proxyUrl);
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(versionUrl, {
        redirect: "error",
        signal: abortController.signal,
      });
    } catch (error) {
      const underlying = error instanceof Error ? error.message : String(error);
      throw new ResidentBrowserProxyError(
        "RESIDENT_PROXY_UNAVAILABLE",
        `RESIDENT_PROXY_UNAVAILABLE: Resident browser proxy at ${proxyUrl.origin} is unavailable; the Browserbase session may not have enabled the Stagehand runtime or the proxy is not listening. Ensure browserSettings.extensions includes "stagehand". (${underlying})`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const proxyError =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : undefined;
      if (response.status === 403) {
        throw new ResidentBrowserProxyError(
          "RESIDENT_PROXY_FORBIDDEN",
          "RESIDENT_PROXY_FORBIDDEN: Resident browser proxy rejected the extension origin; extension ID mismatch",
          { status: response.status },
        );
      }
      if (
        response.status === 503 ||
        proxyError === "stagehand_not_enabled" ||
        proxyError === "browser_unavailable"
      ) {
        const detail = proxyError ? ` (${proxyError})` : "";
        throw new ResidentBrowserProxyError(
          "RESIDENT_PROXY_NOT_READY",
          `RESIDENT_PROXY_NOT_READY: Resident browser proxy is not ready${detail}`,
          { status: response.status },
        );
      }
      throw new Error(`Browser proxy version request failed with HTTP ${response.status}`);
    }

    const { webSocketDebuggerUrl } = BrowserVersionSchema.parse(await response.json());
    return rewriteDebuggerUrl(webSocketDebuggerUrl, proxyUrl);
  } finally {
    clearTimeout(timeout);
  }
}

function parseBrowserProxyUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Resident browser proxy URL must use http: or https:");
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error("Resident browser proxy URL must point to loopback");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Resident browser proxy URL must not include credentials, query, or fragment");
  }
  if (url.pathname !== "/") {
    throw new Error("Resident browser proxy URL must contain only an origin");
  }
  return url;
}

function rewriteDebuggerUrl(rawUrl: string, proxyUrl: URL): string {
  const debuggerUrl = new URL(rawUrl);
  if (
    debuggerUrl.protocol !== "ws:" &&
    !(debuggerUrl.protocol === "wss:" && proxyUrl.protocol === "https:")
  ) {
    throw new Error("Chromium webSocketDebuggerUrl must use ws: (or wss: for an https proxy)");
  }
  if (!isLoopbackHostname(debuggerUrl.hostname)) {
    throw new Error("Chromium webSocketDebuggerUrl must point to loopback");
  }
  if (debuggerUrl.username || debuggerUrl.password || debuggerUrl.hash) {
    throw new Error("Chromium webSocketDebuggerUrl must not include credentials or a fragment");
  }
  if (
    !debuggerUrl.pathname.startsWith("/devtools/browser/") ||
    debuggerUrl.pathname.endsWith("/")
  ) {
    throw new Error("Chromium webSocketDebuggerUrl must identify a browser target");
  }

  const websocketProtocol = proxyUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${websocketProtocol}//${proxyUrl.host}${debuggerUrl.pathname}${debuggerUrl.search}`;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}
