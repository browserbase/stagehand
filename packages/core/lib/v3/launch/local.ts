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
  onDiagnostic?: (diagnostic: {
    message: string;
    auxiliary?: Record<string, string>;
  }) => void;
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

  let chrome: LaunchedChrome | undefined;
  let chromeDiagnostics:
    | ReturnType<typeof attachChromeProcessDiagnostics>
    | undefined;

  try {
    chrome = await launch({
      chromePath: opts.chromePath,
      chromeFlags,
      port: opts.port,
      userDataDir: opts.userDataDir,
      handleSIGINT: opts.handleSIGINT,
      connectionPollInterval,
      maxConnectionRetries,
    });

    chromeDiagnostics = attachChromeProcessDiagnostics(
      chrome,
      opts.onDiagnostic,
    );

    const ws = await waitForWebSocketDebuggerUrl(chrome.port, deadlineMs);
    await waitForWebSocketReady(ws, deadlineMs);
    chromeDiagnostics.dispose();

    return { ws, chrome };
  } catch (error) {
    if (chrome) {
      await emitLaunchFailureDiagnostics({
        chrome,
        diagnostics: chromeDiagnostics,
        error,
        onDiagnostic: opts.onDiagnostic,
      });
    } else {
      opts.onDiagnostic?.({
        message: "Local Chromium failed before devtools startup",
        auxiliary: {
          error: error instanceof Error ? error.message : String(error),
          chromePath: opts.chromePath ?? "<default>",
          headless: String(headless),
        },
      });
    }
    throw error;
  }
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

function attachChromeProcessDiagnostics(
  chrome: LaunchedChrome,
  onDiagnostic?: (diagnostic: {
    message: string;
    auxiliary?: Record<string, string>;
  }) => void,
) {
  const maxBufferedChars = 8_000;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let processError = "";
  let disposed = false;

  const append = (current: string, chunk: unknown) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    const combined = current ? `${current}${text}` : text;
    return combined.length <= maxBufferedChars
      ? combined
      : combined.slice(-maxBufferedChars);
  };

  const child = chrome.process;
  const onStdout = (chunk: unknown) => {
    stdoutBuffer = append(stdoutBuffer, chunk);
  };
  const onStderr = (chunk: unknown) => {
    stderrBuffer = append(stderrBuffer, chunk);
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitCode = code;
    exitSignal = signal;
    if (!disposed) {
      onDiagnostic?.({
        message: "Local Chromium exited during startup",
        auxiliary: {
          pid: String(chrome.process?.pid ?? chrome.pid ?? ""),
          exitCode: code === null ? "null" : String(code),
          exitSignal: signal ?? "null",
        },
      });
    }
  };
  const onError = (error: Error) => {
    processError = error.message;
    if (!disposed) {
      onDiagnostic?.({
        message: "Local Chromium process emitted an error during startup",
        auxiliary: {
          pid: String(chrome.process?.pid ?? chrome.pid ?? ""),
          error: error.message,
        },
      });
    }
  };

  child?.stdout?.on("data", onStdout);
  child?.stderr?.on("data", onStderr);
  child?.on("exit", onExit);
  child?.on("error", onError);

  return {
    snapshot() {
      return {
        stdout: stdoutBuffer.trim(),
        stderr: stderrBuffer.trim(),
        exitCode,
        exitSignal,
        processError: processError.trim(),
      };
    },
    dispose() {
      disposed = true;
      child?.stdout?.off("data", onStdout);
      child?.stderr?.off("data", onStderr);
      child?.off("exit", onExit);
      child?.off("error", onError);
    },
  };
}

async function emitLaunchFailureDiagnostics(params: {
  chrome: LaunchedChrome;
  diagnostics?: ReturnType<typeof attachChromeProcessDiagnostics>;
  error: unknown;
  onDiagnostic?: (diagnostic: {
    message: string;
    auxiliary?: Record<string, string>;
  }) => void;
}) {
  const { chrome, diagnostics, error, onDiagnostic } = params;
  const devtoolsSnapshots = await captureDevtoolsSnapshots(chrome.port);
  const snapshot = diagnostics?.snapshot();

  onDiagnostic?.({
    message: "Local Chromium startup failed",
    auxiliary: {
      error: error instanceof Error ? error.message : String(error),
      pid: String(chrome.process?.pid ?? chrome.pid ?? ""),
      port: String(chrome.port),
      exitCode:
        snapshot?.exitCode === null || snapshot?.exitCode === undefined
          ? "null"
          : String(snapshot.exitCode),
      exitSignal: snapshot?.exitSignal ?? "null",
      processError: snapshot?.processError || "<none>",
      jsonVersion: devtoolsSnapshots.version,
      jsonList: devtoolsSnapshots.list,
      chromeStdout: sanitizeChromeProcessOutput(snapshot?.stdout || "<empty>"),
      chromeStderr: sanitizeChromeProcessOutput(snapshot?.stderr || "<empty>"),
    },
  });
}

async function captureDevtoolsSnapshots(port: number): Promise<{
  version: string;
  list: string;
}> {
  const capture = async (path: string) => {
    const url = `http://127.0.0.1:${port}${path}`;
    try {
      const response = await fetch(url);
      const body = await response.text();
      return truncateDiagnostic(
        `${response.status} ${response.statusText} ${sanitizeDevtoolsBody(body)}`,
      );
    } catch (error) {
      return truncateDiagnostic(
        `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const [version, list] = await Promise.all([
    capture("/json/version"),
    capture("/json/list"),
  ]);

  return { version, list };
}

function truncateDiagnostic(value: string, maxChars = 1_000): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function sanitizeDevtoolsBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    return JSON.stringify(redactWebSocketDebuggerUrl(parsed));
  } catch {
    return body;
  }
}

function redactWebSocketDebuggerUrl(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactWebSocketDebuggerUrl);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        key === "webSocketDebuggerUrl"
          ? "<redacted>"
          : redactWebSocketDebuggerUrl(entryValue),
      ]),
    );
  }

  return value;
}

function sanitizeChromeProcessOutput(output: string): string {
  return output.replace(
    /\bws:\/\/[^\s]+\/devtools\/[^\s]+/g,
    "<redacted-cdp-websocket-url>",
  );
}
