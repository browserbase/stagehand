import { spawn } from "node:child_process";
import net, { type AddressInfo, type Socket } from "node:net";
import type { ProbeEvidence } from "stagehand-v3";
import { SESSION_INFO_TOOL_NAME } from "@browserbasehq/stagehand-integrations/facade";
import type { BrowserSessionLoss } from "../contracts/tool.js";
import { browserSessionLostCause, parseSessionLossTelemetry } from "./browserSessionLoss.js";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { EvalLogger } from "../../logger.js";

export const STAGEHAND_FACADE_BRIDGE_PORT_ENV = "STAGEHAND_EVALS_FACADE_BRIDGE_PORT";

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_INFO_TIMEOUT_MS = 60_000;
const HOST_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
] as const;

export interface StagehandFacadeBridgeInput {
  /** How to spawn the facade MCP stdio server (process.execPath + [stdio-server.mjs] in production). */
  server: { command: string; args: string[]; env: Record<string, string> };
  logger?: EvalLogger;
  /** Per JSON-RPC request timeout for runner-issued calls (ms). Default 20_000; env EVAL_FACADE_BRIDGE_REQUEST_TIMEOUT_MS overrides. */
  requestTimeoutMs?: number;
}

export interface FacadeBrowserSessionInfo {
  provider: "browserbase" | "local";
  sessionId?: string;
}

export interface StagehandFacadeBridge {
  /** Loopback port the relay connects to. */
  port: number;
  /** MCP stdio server spec for the agent. Contains no host secrets; the facade process env stays runner-side. */
  mcpServerSpec: { command: string; args: string[]; env: Record<string, string> };
  /** Number of agent relay connections currently open. */
  agentConnections(): number;
  /** Whether any agent tools/call request has passed through. */
  sawAgentToolCall(): boolean;
  /**
   * Set once the facade reported its browser session gone. Every tool call
   * after that returns the same terminal error, so failures past this point
   * are consequences of the loss, not agent mistakes.
   */
  browserSessionLoss(): BrowserSessionLoss | undefined;
  /** Raw JSON-RPC request from the runner side. */
  call(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  /** Best-effort terminal/step evidence from the shared browser. */
  captureEvidence(): Promise<ProbeEvidence>;
  /**
   * Launches the facade browser if it has not started yet and reports where it
   * lives. Runner-side only; the agent never sees this tool.
   */
  sessionInfo(): Promise<FacadeBrowserSessionInfo>;
  /** Idempotently closes the relay and facade process. */
  close(): Promise<void>;
}

/**
 * Dependency-free CommonJS relay used with `node -e`. The agent receives only
 * the loopback port; browser and model credentials remain in the runner-owned
 * facade process.
 */
export const FACADE_RELAY_SCRIPT = `const net=require("node:net");const port=Number(process.env.${STAGEHAND_FACADE_BRIDGE_PORT_ENV});const socket=net.createConnection({host:"127.0.0.1",port});let connected=false;socket.once("connect",()=>{connected=true;process.stdin.pipe(socket);socket.pipe(process.stdout);});socket.once("error",(error)=>{process.stderr.write("stagehand facade relay: "+error.message+"\\n");if(!connected)process.exit(1);});socket.once("close",()=>process.exit(0));process.stdin.once("end",()=>socket.end());`;

type JsonRpcMessage = {
  id?: unknown;
  method?: unknown;
  result?: unknown;
  error?: unknown;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function pickHostEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of HOST_ENV_KEYS) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function idKey(id: unknown): string {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function hasOwnId(message: JsonRpcMessage): boolean {
  return Object.prototype.hasOwnProperty.call(message, "id");
}

function rpcError(error: unknown): Error {
  if (error && typeof error === "object" && "message" in error) {
    return new Error(sanitizeErrorMessage(String((error as { message: unknown }).message)));
  }
  try {
    return new Error(sanitizeErrorMessage(JSON.stringify(error) ?? String(error)));
  } catch {
    return new Error(sanitizeErrorMessage(String(error)));
  }
}

function contentBlocks(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.filter(
        (block): block is Record<string, unknown> => block !== null && typeof block === "object",
      )
    : [];
}

function isToolError(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { isError?: unknown }).isError);
}

function sessionLostCauseFromToolResult(result: unknown): string | undefined {
  if (!isToolError(result)) return undefined;
  const text = contentBlocks(result).find((block) => typeof block.text === "string")?.text;
  return typeof text === "string" ? browserSessionLostCause(text) : undefined;
}

export async function startStagehandFacadeBridge(
  input: StagehandFacadeBridgeInput,
): Promise<StagehandFacadeBridge> {
  const logger = input.logger;
  const log = (message: string) => {
    if (typeof logger?.log === "function") {
      logger.log({ category: "stagehand_facade", level: 2, message });
    }
  };
  const requestTimeoutMs =
    positiveInt(process.env.EVAL_FACADE_BRIDGE_REQUEST_TIMEOUT_MS) ??
    (input.requestTimeoutMs !== undefined && input.requestTimeoutMs > 0
      ? input.requestTimeoutMs
      : undefined) ??
    DEFAULT_REQUEST_TIMEOUT_MS;
  const child = spawn(input.server.command, input.server.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...pickHostEnv(process.env), ...input.server.env },
  });
  const sockets = new Set<Socket>();
  const agentRequests = new Map<string, Socket>();
  const pending = new Map<string, PendingCall>();
  const stderrLines: string[] = [];
  let stderrCarry = "";
  let stdoutCarry = "";
  let counter = 0;
  let toolCallSeen = false;
  let closed = false;
  let exited = false;
  let exitDescription = "";
  let initializeResult: unknown;
  let closePromise: Promise<void> | undefined;
  let sessionLoss: BrowserSessionLoss | undefined;

  const noteSessionLoss = (loss: BrowserSessionLoss) => {
    if (sessionLoss) return;
    sessionLoss = loss;
    log(`Facade browser session lost: ${loss.cause}`);
  };

  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const rememberStderr = (line: string) => {
    if (!line) return;
    stderrLines.push(line);
    if (stderrLines.length > 20) stderrLines.shift();
    log(line);
    const loss = parseSessionLossTelemetry(line);
    if (loss) noteSessionLoss(loss);
  };

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrCarry += chunk.toString();
    const lines = stderrCarry.split("\n");
    stderrCarry = lines.pop() ?? "";
    for (const line of lines) rememberStderr(line.replace(/\r$/u, ""));
  });
  child.stderr.on("end", () => rememberStderr(stderrCarry.replace(/\r$/u, "")));

  const writeChild = (line: string): boolean => {
    if (closed || exited || child.stdin.destroyed) return false;
    try {
      child.stdin.write(line);
      return true;
    } catch {
      return false;
    }
  };
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
      log(`Facade stdin error: ${error.message}`);
    }
  });

  const routeServerLine = (rawLine: string) => {
    if (!rawLine.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(rawLine) as JsonRpcMessage;
    } catch {
      log(`Dropped non-JSON facade stdout line: ${rawLine}`);
      return;
    }

    if (!hasOwnId(message)) {
      for (const socket of sockets) {
        if (socket.writable) socket.write(`${rawLine}\n`);
      }
      return;
    }

    if (typeof message.id === "string" && message.id.startsWith("evals-facade-")) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (Object.prototype.hasOwnProperty.call(message, "error")) {
        entry.reject(rpcError(message.error));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    // The stderr telemetry line is the primary signal; the terminal tool error
    // covers a facade build that predates it.
    const lostCause = sessionLostCauseFromToolResult(message.result);
    if (lostCause) noteSessionLoss({ cause: lostCause });
    const socket = agentRequests.get(idKey(message.id));
    agentRequests.delete(idKey(message.id));
    if (socket?.writable) socket.write(`${rawLine}\n`);
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutCarry += chunk.toString();
    const lines = stdoutCarry.split("\n");
    stdoutCarry = lines.pop() ?? "";
    for (const line of lines) routeServerLine(line.replace(/\r$/u, ""));
  });
  child.stdout.on("end", () => {
    if (stdoutCarry) routeServerLine(stdoutCarry.replace(/\r$/u, ""));
  });

  const exitPromise = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      exited = true;
      exitDescription = sanitizeErrorMessage(`spawn error: ${error.message}`);
      rejectPending(new Error(`Stagehand facade ${exitDescription}`));
      resolve();
    });
    child.once("exit", (code, signal) => {
      exited = true;
      exitDescription = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
      const detail = stderrLines.length > 0 ? `: ${stderrLines.join("\n")}` : "";
      rejectPending(
        new Error(sanitizeErrorMessage(`Stagehand facade exited with ${exitDescription}${detail}`)),
      );
      resolve();
    });
  });
  const waitForChildExit = (timeoutMs: number): Promise<boolean> => {
    if (exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let carry = "";
    socket.on("data", (chunk: Buffer | string) => {
      carry += chunk.toString();
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.replace(/\r$/u, "");
        if (!line.trim()) continue;
        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          log(`Dropped non-JSON agent relay line: ${line}`);
          continue;
        }
        if (message.method === "initialize" && hasOwnId(message)) {
          if (socket.writable) {
            socket.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: initializeResult })}\n`,
            );
          }
          continue;
        }
        if (message.method === "notifications/initialized") continue;
        if (hasOwnId(message) && typeof message.method === "string") {
          agentRequests.set(idKey(message.id), socket);
          if (message.method === "tools/call") toolCallSeen = true;
        }
        if (!writeChild(`${line}\n`) && (closed || exited || child.stdin.destroyed)) {
          socket.destroy(new Error("Stagehand facade bridge is closed"));
        }
      }
    });
    socket.on("error", () => undefined);
    socket.once("close", () => {
      sockets.delete(socket);
      for (const [key, requestSocket] of agentRequests) {
        if (requestSocket === socket) agentRequests.delete(key);
      }
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });
  } catch (error) {
    closed = true;
    if (!child.stdin.destroyed) child.stdin.end();
    if (!exited) child.kill("SIGTERM");
    await waitForChildExit(1_000);
    if (!exited) child.kill("SIGKILL");
    throw error;
  }
  const port = (server.address() as AddressInfo).port;

  const call = (
    method: string,
    params?: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> => {
    const timeoutMs = options.timeoutMs ?? requestTimeoutMs;
    if (closed) return Promise.reject(new Error("Stagehand facade bridge is closed"));
    if (exited) {
      return Promise.reject(
        new Error(sanitizeErrorMessage(`Stagehand facade exited with ${exitDescription}`)),
      );
    }
    const id = `evals-facade-${counter++}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Stagehand facade request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      const request = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      };
      if (!writeChild(`${JSON.stringify(request)}\n`)) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error("Stagehand facade bridge is closed"));
      }
    });
  };

  const captureEvidence = async (): Promise<ProbeEvidence> => {
    if (!toolCallSeen) return {};
    const evidence: ProbeEvidence = {};
    try {
      const result = await call("tools/call", { name: "screenshot", arguments: {} });
      if (!isToolError(result)) {
        const image = contentBlocks(result).find(
          (block) => block.type === "image" && typeof block.data === "string",
        );
        if (image) evidence.screenshot = Buffer.from(image.data as string, "base64");
      }
    } catch {
      // Best effort: preserve other evidence modalities.
    }
    try {
      const result = await call("tools/call", {
        name: "run",
        arguments: { code: "return page.url();" },
      });
      if (!isToolError(result)) {
        const text = contentBlocks(result).find(
          (block) => block.type === "text" && typeof block.text === "string",
        )?.text;
        if (typeof text === "string" && /^[a-z][a-z0-9+.-]*:/iu.test(text)) {
          evidence.url = text;
        }
      }
    } catch {
      // Best effort: preserve other evidence modalities.
    }
    if (sockets.size === 0) {
      try {
        // snapshot re-hydrates the active page's element-ID map ("Every call
        // replaces the active page's ID map"). Capturing it mid-run would make
        // the agent's bracketed IDs stale, so only terminal evidence includes it.
        const result = await call("tools/call", {
          name: "snapshot",
          arguments: { includeIframes: true },
        });
        if (!isToolError(result)) {
          const text = contentBlocks(result).find(
            (block) => block.type === "text" && typeof block.text === "string",
          )?.text;
          if (typeof text === "string") evidence.ariaTree = text;
        }
      } catch {
        // Best effort: preserve other evidence modalities.
      }
    }
    return evidence;
  };

  const sessionInfo = async (): Promise<FacadeBrowserSessionInfo> => {
    // A cold Browserbase launch can outlast the per-request default.
    const result = await call(
      "tools/call",
      { name: SESSION_INFO_TOOL_NAME, arguments: {} },
      { timeoutMs: Math.max(requestTimeoutMs, SESSION_INFO_TIMEOUT_MS) },
    );
    if (isToolError(result)) {
      const text = contentBlocks(result).find((block) => typeof block.text === "string")?.text;
      throw new Error(sanitizeErrorMessage(`Stagehand facade session_info failed: ${text ?? ""}`));
    }
    const text = contentBlocks(result).find(
      (block) => block.type === "text" && typeof block.text === "string",
    )?.text;
    const parsed = JSON.parse(String(text ?? "{}")) as Record<string, unknown>;
    return {
      provider: parsed.provider === "browserbase" ? "browserbase" : "local",
      ...(typeof parsed.sessionId === "string" &&
        parsed.sessionId && { sessionId: parsed.sessionId }),
    };
  };

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      closed = true;
      rejectPending(new Error("Stagehand facade bridge is closed"));
      for (const socket of sockets) socket.destroy();
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      if (!exited && !child.stdin.destroyed) child.stdin.end();
      await serverClosed;

      const shutdownTimeoutMs =
        positiveInt(process.env.EVAL_FACADE_BRIDGE_SHUTDOWN_TIMEOUT_MS) ??
        DEFAULT_SHUTDOWN_TIMEOUT_MS;
      if (await waitForChildExit(shutdownTimeoutMs)) return;
      child.kill("SIGTERM");
      if (await waitForChildExit(2_000)) return;
      child.kill("SIGKILL");
      await waitForChildExit(2_000);
    })();
    return closePromise;
  };

  const bridge: StagehandFacadeBridge = {
    port,
    mcpServerSpec: {
      command: process.execPath,
      args: ["-e", FACADE_RELAY_SCRIPT],
      env: { [STAGEHAND_FACADE_BRIDGE_PORT_ENV]: String(port) },
    },
    agentConnections: () => sockets.size,
    sawAgentToolCall: () => toolCallSeen,
    browserSessionLoss: () => sessionLoss,
    call,
    captureEvidence,
    sessionInfo,
    close,
  };

  try {
    initializeResult = await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stagehand-evals-facade-bridge", version: "1.0.0" },
    });
    writeChild(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return bridge;
  } catch (error) {
    await close();
    throw error;
  }
}
