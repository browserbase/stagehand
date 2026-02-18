import { launch, LaunchedChrome } from "chrome-launcher";
import WebSocket from "ws";
import { ConnectionTimeoutError } from "../types/public/sdkErrors.js";

interface LaunchLocalOptions {
  chromePath?: string;
  chromeFlags?: string[];
  headless?: boolean;
  userDataDir?: string;
  port?: number;
  connectTimeoutMs?: number;
  handleSIGINT?: boolean;
}

export async function launchLocalChrome(
  opts: LaunchLocalOptions,
): Promise<{ ws: string; chrome: LaunchedChrome }> {
  const connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
  const deadlineMs = Date.now() + connectTimeoutMs;
  const connectionPollInterval = 250;
  const maxConnectionRetries = Math.max(
    1,
    Math.ceil(connectTimeoutMs / connectionPollInterval),
  );
  const headless = opts.headless ?? false;
  const chromeFlags = [
    headless ? "--headless=new" : undefined,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--site-per-process",
    ...(opts.chromeFlags ?? []),
  ].filter((f): f is string => typeof f === "string");

  const chrome = await launch({
    chromePath: opts.chromePath,
    chromeFlags,
    port: opts.port,
    userDataDir: opts.userDataDir,
    handleSIGINT: opts.handleSIGINT,
    connectionPollInterval,
    maxConnectionRetries,
  });

  const ws = await waitForWebSocketDebuggerUrl(chrome.port, deadlineMs);
  await waitForWebSocketReady(ws, deadlineMs);

  return { ws, chrome };
}

async function waitForWebSocketDebuggerUrl(
  port: number,
  deadlineMs: number,
): Promise<string> {
  let lastErrMsg = "";

  while (Date.now() < deadlineMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) {
        const json = (await resp.json()) as unknown;
        const url = (json as { webSocketDebuggerUrl?: string })
          .webSocketDebuggerUrl;
        if (typeof url === "string") return url;
      } else {
        lastErrMsg = `${resp.status} ${resp.statusText}`;
      }
    } catch (err) {
      lastErrMsg = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new ConnectionTimeoutError(
    `Timed out waiting for /json/version on port ${port} ${
      lastErrMsg ? ` (last error: ${lastErrMsg})` : ""
    }`,
  );
}

async function waitForWebSocketReady(
  wsUrl: string,
  deadlineMs: number,
): Promise<void> {
  let lastErrMsg = "";
  while (Date.now() < deadlineMs) {
    const remainingMs = Math.max(200, deadlineMs - Date.now());
    try {
      await probeWebSocket(wsUrl, Math.min(2_000, remainingMs));
      return;
    } catch (error) {
      lastErrMsg = error instanceof Error ? error.message : String(error);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new ConnectionTimeoutError(
    `Timed out waiting for CDP websocket to accept connections at ${wsUrl}${
      lastErrMsg ? ` (last error: ${lastErrMsg})` : ""
    }`,
  );
}

function probeWebSocket(wsUrl: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // best-effort cleanup
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(`websocket probe timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once("open", () => finish());
    ws.once("error", (error) => finish(error));
  });
}
