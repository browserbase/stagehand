import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import WebSocket from "ws";
import { ConnectionTimeoutError } from "../types/public/sdkErrors.js";

interface ConnectLightpandaOptions {
  cdpUrl: string;
  connectTimeoutMs?: number;
}

/**
 * Connects to an already-running Lightpanda browser instance via CDP.
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

  // Race the WebSocket readiness check against early process exit so we
  // fail fast with a useful error instead of waiting the full timeout.
  const earlyExit = new Promise<never>((_, reject) => {
    let stderr = "";
    childProcess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    childProcess.on("error", (err) => {
      reject(new Error(`Lightpanda process failed to start: ${err.message}`));
    });
    childProcess.on("exit", (code, signal) => {
      const detail = stderr.trim();
      reject(
        new Error(
          `Lightpanda process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})` +
            (detail ? `\n${detail}` : ""),
        ),
      );
    });
  });

  const wsUrl = `ws://127.0.0.1:${port}`;
  const deadlineMs = Date.now() + connectTimeoutMs;

  try {
    await Promise.race([waitForWebSocketReady(wsUrl, deadlineMs), earlyExit]);
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
