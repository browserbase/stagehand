import { launch, Launcher, LaunchedChrome } from "chrome-launcher";
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
  /**
   * When provided, selectively removes flags from chrome-launcher's built-in
   * defaults (e.g. `--disable-extensions`).
   *
   * - `true`  — drop **all** chrome-launcher defaults (only Stagehand's own
   *   flags and user-supplied `chromeFlags` will be used).
   * - `string[]` — drop only the listed flags from chrome-launcher defaults.
   *   Matching is exact (e.g. `["--disable-extensions"]` removes only that
   *   flag, not `--disable-extensions-file-access-from-files`).
   */
  ignoreDefaultArgs?: boolean | string[];
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

  // Handle ignoreDefaultArgs: selectively remove chrome-launcher's built-in
  // defaults while keeping Stagehand's own flags (already in chromeFlags).
  let ignoreDefaultFlags = false;
  if (opts.ignoreDefaultArgs === true) {
    ignoreDefaultFlags = true;
  } else if (
    Array.isArray(opts.ignoreDefaultArgs) &&
    opts.ignoreDefaultArgs.length > 0
  ) {
    // Tell chrome-launcher to skip ALL its defaults, then re-add the ones
    // the user did NOT ask to exclude.
    ignoreDefaultFlags = true;
    const excludeArgs = opts.ignoreDefaultArgs;
    const clDefaults = Launcher.defaultFlags?.() ?? [];
    const kept = clDefaults.filter((f) => !excludeArgs.includes(f));
    chromeFlags.unshift(...kept);
  }

  const chrome = await launch({
    chromePath: opts.chromePath,
    chromeFlags,
    port: opts.port,
    userDataDir: opts.userDataDir,
    handleSIGINT: opts.handleSIGINT,
    ignoreDefaultFlags,
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
