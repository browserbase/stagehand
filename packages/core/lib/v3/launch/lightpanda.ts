import type { ChildProcessWithoutNullStreams } from "child_process";
import WebSocket from "ws";
import { ConnectionTimeoutError } from "../types/public/sdkErrors.js";

interface ConnectLightpandaOptions {
  cdpUrl: string;
  connectTimeoutMs?: number;
}

/**
 * Connects to an already-running Lightpanda browser instance via CDP.
 *
 * Lightpanda exposes a CDP-compatible WebSocket endpoint.
 * This function waits for the endpoint to become ready and returns the
 * WebSocket URL for use with CdpConnection.
 */
export async function connectLightpanda(
  opts: ConnectLightpandaOptions,
): Promise<{ ws: string }> {
  const connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
  const deadlineMs = Date.now() + connectTimeoutMs;

  await waitForWebSocketReady(opts.cdpUrl, deadlineMs);

  return { ws: opts.cdpUrl };
}

interface LaunchLightpandaOptions {
  host?: string;
  port?: number;
  executablePath?: string;
  connectTimeoutMs?: number;
  proxy?: string;
}

/**
 * Auto-launches Lightpanda via the `@lightpanda/browser` npm package and
 * waits for the CDP WebSocket endpoint to become ready.
 *
 * Requires `@lightpanda/browser` to be installed as an optional dependency.
 */
export async function launchLightpanda(
  opts: LaunchLightpandaOptions,
): Promise<{ ws: string; process: ChildProcessWithoutNullStreams }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 9222;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;

  // If a custom executable path is provided, set the env var that
  // @lightpanda/browser reads to locate the binary.
  if (opts.executablePath) {
    process.env.LIGHTPANDA_EXECUTABLE_PATH = opts.executablePath;
  }

  // Dynamic import so @lightpanda/browser is only loaded when needed.
  let lightpanda: {
    serve: (
      opts: Record<string, unknown>,
    ) => Promise<ChildProcessWithoutNullStreams>;
  };
  try {
    const mod = await import("@lightpanda/browser");
    lightpanda = mod.lightpanda;
  } catch (err) {
    const isModuleNotFound =
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND";
    if (isModuleNotFound) {
      throw new Error(
        "@lightpanda/browser is required to auto-launch Lightpanda. " +
          'Install it with: npm install @lightpanda/browser\n\n' +
          "Alternatively, start Lightpanda manually and pass " +
          "lightpandaLaunchOptions.cdpUrl to connect to it.",
      );
    }
    throw err;
  }

  const childProcess = await lightpanda.serve({
    host,
    port,
    ...(opts.proxy ? { httpProxy: opts.proxy } : {}),
  });

  const wsUrl = `ws://${host}:${port}`;
  const deadlineMs = Date.now() + connectTimeoutMs;

  await waitForWebSocketReady(wsUrl, deadlineMs);

  return { ws: wsUrl, process: childProcess };
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
    `Timed out waiting for Lightpanda CDP websocket endpoint${
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
