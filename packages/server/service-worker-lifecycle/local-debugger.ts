const DEFAULT_LOCAL_DEBUGGER_VERSION_URL = "http://127.0.0.1:9222/json/version";
const DEFAULT_LOCAL_DEBUGGER_TIMEOUT_MS = 1_000;
const DEFAULT_LOCAL_DEBUGGER_RETRY_INTERVAL_MS = 100;

export type LocalDebuggerResolverOptions = {
  versionUrl?: string;
  timeoutMs?: number;
  retryIntervalMs?: number;
  fetchFn?: typeof fetch;
};

/** Resolves the browser-level CDP websocket exposed by Chromium in this pod. */
export async function resolveLocalDebuggerUrl(
  options: LocalDebuggerResolverOptions = {},
): Promise<string> {
  const versionUrl = options.versionUrl ?? DEFAULT_LOCAL_DEBUGGER_VERSION_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_DEBUGGER_TIMEOUT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_LOCAL_DEBUGGER_RETRY_INTERVAL_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      resolveVersionResponseWithRetry(versionUrl, fetchFn, controller.signal, retryIntervalMs),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(
            `Timed out resolving the local Chromium debugger after ${timeoutMs}ms`,
          );
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function resolveVersionResponseWithRetry(
  versionUrl: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
  retryIntervalMs: number,
): Promise<string> {
  while (true) {
    try {
      return await resolveVersionResponse(versionUrl, fetchFn, signal);
    } catch (error) {
      if (signal.aborted || !isRetryableNetworkError(error)) throw error;
      await abortableDelay(retryIntervalMs, signal);
    }
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "NetworkError")
  );
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveVersionResponse(
  versionUrl: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchFn(versionUrl, { signal });
  if (!response.ok) {
    throw new Error(`Local Chromium debugger returned HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  const webSocketDebuggerUrl = debuggerUrlFromVersionResponse(body);
  assertLoopbackWebSocketUrl(webSocketDebuggerUrl);
  return webSocketDebuggerUrl;
}

function debuggerUrlFromVersionResponse(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("webSocketDebuggerUrl" in body) ||
    typeof body.webSocketDebuggerUrl !== "string"
  ) {
    throw new Error("Local Chromium debugger response is missing webSocketDebuggerUrl");
  }
  return body.webSocketDebuggerUrl;
}

function assertLoopbackWebSocketUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("Local Chromium debugger returned an invalid WebSocket URL", { cause: error });
  }

  if (url.protocol !== "ws:" || !isLoopbackHostname(url.hostname)) {
    throw new Error("Local Chromium debugger WebSocket URL must use ws: on a loopback host");
  }
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const values = octets.map(Number);
  return values[0] === 127 && values.every((octet) => octet >= 0 && octet <= 255);
}
