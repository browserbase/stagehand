import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import WebSocket from "ws";
import { ConnectionTimeoutError } from "../types/public/sdkErrors.js";

interface LaunchLightpandaOptions {
  executablePath: string;
  port?: number;
  args?: string[];
  connectTimeoutMs?: number;
}

/**
 * Launches a Lightpanda browser process and waits for the CDP WebSocket
 * endpoint to become ready.
 */
export async function launchLightpanda(
  opts: LaunchLightpandaOptions,
): Promise<{ ws: string; process: ChildProcessWithoutNullStreams }> {
  const port = opts.port ?? 9222;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;

  const spawnArgs = [
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--timeout",
    "180", // 3 min before CDP inactivity timeout.
    ...(opts.args ?? []),
  ];

  const childProcess = spawn(opts.executablePath, spawnArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const wsUrl = `ws://127.0.0.1:${port}`;
  const deadlineMs = Date.now() + connectTimeoutMs;

  try {
    await waitForWebSocketReady(wsUrl, deadlineMs);
    return { ws: wsUrl, process: childProcess };
  } catch (error) {
    try {
      childProcess.kill();
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
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
