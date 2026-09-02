import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net, { type AddressInfo, type Server, type Socket } from "node:net";
import type { ProbeEvidence } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import { EvalsError } from "../../errors.js";
import type { EvalLogger } from "../../logger.js";

export const STAGEHAND_FACADE_BRIDGE_PORT_ENV = "STAGEHAND_EVALS_FACADE_BRIDGE_PORT";

export class StagehandFacadeBridgeError extends EvalsError {
  constructor(message: string) {
    super(sanitizeErrorMessage(message));
    this.name = "StagehandFacadeBridgeError";
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const RUNNER_REQUEST_ID_PREFIX = "evals-facade-";
const AGENT_REQUEST_ID_PREFIX = "agent-facade-";
const STDERR_TAIL_LINES = 20;
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

export interface StagehandFacadeBridge {
  /** Loopback port the relay connects to. */
  port: number;
  /** MCP stdio server spec for the agent. Contains no host secrets; the facade process env stays runner-side. */
  mcpServerSpec: { command: string; args: string[]; env: Record<string, string> };
  /** Number of agent relay connections currently open. */
  agentConnections(): number;
  /** Whether any agent tools/call request has passed through. */
  sawAgentToolCall(): boolean;
  /** Raw JSON-RPC request from the runner side. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Best-effort terminal/step evidence from the shared browser. */
  captureEvidence(): Promise<ProbeEvidence>;
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

type Log = (message: string) => void;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

function hasOwn(message: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(message, key);
}

function parseJsonRpc(line: string): JsonRpcMessage | undefined {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

function rpcError(error: unknown): StagehandFacadeBridgeError {
  if (error && typeof error === "object" && "message" in error) {
    return new StagehandFacadeBridgeError(String((error as { message: unknown }).message));
  }
  try {
    return new StagehandFacadeBridgeError(JSON.stringify(error) ?? String(error));
  } catch {
    return new StagehandFacadeBridgeError(String(error));
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

function firstTextBlock(result: unknown): string | undefined {
  const text = contentBlocks(result).find(
    (block) => block.type === "text" && typeof block.text === "string",
  )?.text;
  return typeof text === "string" ? text : undefined;
}

function firstImageBlock(result: unknown): Buffer | undefined {
  const image = contentBlocks(result).find(
    (block) => block.type === "image" && typeof block.data === "string",
  );
  return image ? Buffer.from(image.data as string, "base64") : undefined;
}

/** Splits a byte stream into newline-delimited lines, holding a partial trailing line. */
class LineDecoder {
  private carry = "";

  feed(chunk: Buffer | string): string[] {
    this.carry += chunk.toString();
    const lines = this.carry.split("\n");
    this.carry = lines.pop() ?? "";
    return lines.map((line) => line.replace(/\r$/u, ""));
  }

  flush(): string | undefined {
    const rest = this.carry.replace(/\r$/u, "");
    this.carry = "";
    return rest || undefined;
  }
}

// ---------------------------------------------------------------------------
// FacadeProcess: the spawned MCP stdio server
// ---------------------------------------------------------------------------

/**
 * Owns the facade child process: stdin writes, newline-framed stdout lines,
 * a tail of stderr for diagnostics, and exit tracking / escalating shutdown.
 */
class FacadeProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stderrTail: string[] = [];
  private readonly exitPromise: Promise<void>;
  private _exited = false;
  private _exitDescription = "";
  private stdinEnded = false;

  constructor(
    server: StagehandFacadeBridgeInput["server"],
    private readonly log: Log,
    private readonly onLine: (line: string) => void,
    /** Invoked once when the process exits or fails to spawn, with the error pending callers should see. */
    private readonly onExit: (error: StagehandFacadeBridgeError) => void,
  ) {
    this.child = spawn(server.command, server.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...pickHostEnv(process.env), ...server.env },
    });

    const stdout = new LineDecoder();
    this.child.stdout.on("data", (chunk: Buffer | string) => {
      for (const line of stdout.feed(chunk)) this.onLine(line);
    });
    this.child.stdout.on("end", () => {
      const rest = stdout.flush();
      if (rest) this.onLine(rest);
    });

    const stderr = new LineDecoder();
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      for (const line of stderr.feed(chunk)) this.rememberStderr(line);
    });
    this.child.stderr.on("end", () => this.rememberStderr(stderr.flush()));

    this.child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
        this.log(`Facade stdin error: ${error.message}`);
      }
    });

    this.exitPromise = new Promise<void>((resolve) => {
      this.child.once("error", (error) => {
        this.markExited(sanitizeErrorMessage(`spawn error: ${error.message}`));
        this.onExit(new StagehandFacadeBridgeError(`Stagehand facade ${this._exitDescription}`));
        resolve();
      });
      this.child.once("exit", (code, signal) => {
        this.markExited(code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`);
        const detail = this.stderrTail.length > 0 ? `: ${this.stderrTail.join("\n")}` : "";
        this.onExit(
          new StagehandFacadeBridgeError(
            `Stagehand facade exited with ${this._exitDescription}${detail}`,
          ),
        );
        resolve();
      });
    });
  }

  get exited(): boolean {
    return this._exited;
  }

  /** Human-readable exit reason, e.g. "exit code 1" or "signal SIGTERM". Empty until exit. */
  get exitDescription(): string {
    return this._exitDescription;
  }

  get writable(): boolean {
    return !this._exited && !this.child.stdin.destroyed;
  }

  /** Writes one newline-terminated JSON-RPC line. Returns false if the process cannot accept it. */
  writeLine(line: string): boolean {
    if (!this.writable) return false;
    try {
      this.child.stdin.write(`${line}\n`);
      return true;
    } catch {
      return false;
    }
  }

  endStdin(): void {
    if (this.stdinEnded) return;
    this.stdinEnded = true;
    if (this.writable) this.child.stdin.end();
  }

  /** Resolves true once the process has exited, or false after `timeoutMs`. */
  waitForExit(timeoutMs: number): Promise<boolean> {
    if (this._exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /**
   * Closes stdin and gives the process `graceMs` to exit on its own, then
   * escalates SIGTERM → SIGKILL, waiting `termMs` / `killMs` between steps.
   */
  async terminate(graceMs: number, termMs: number, killMs: number): Promise<void> {
    this.endStdin();
    if (graceMs > 0 && (await this.waitForExit(graceMs))) return;
    if (!this._exited) this.child.kill("SIGTERM");
    if (termMs > 0 && (await this.waitForExit(termMs))) return;
    if (!this._exited) this.child.kill("SIGKILL");
    if (killMs > 0) await this.waitForExit(killMs);
  }

  private markExited(description: string): void {
    this._exited = true;
    this._exitDescription = description;
  }

  private rememberStderr(line: string | undefined): void {
    if (!line) return;
    this.stderrTail.push(line);
    if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
    this.log(line);
  }
}

// ---------------------------------------------------------------------------
// RunnerRpcClient: runner-issued JSON-RPC requests with timeouts
// ---------------------------------------------------------------------------

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Tracks the runner's own requests to the facade (initialize, evidence
 * capture, ad-hoc `call`). Runner ids carry a prefix so responses can be
 * separated from agent traffic sharing the same stdout.
 */
class RunnerRpcClient {
  private readonly pending = new Map<string, PendingCall>();
  private counter = 0;

  constructor(
    private readonly send: (line: string) => boolean,
    private readonly timeoutMs: number,
  ) {}

  static ownsId(id: unknown): id is string {
    return typeof id === "string" && id.startsWith(RUNNER_REQUEST_ID_PREFIX);
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = `${RUNNER_REQUEST_ID_PREFIX}${this.counter++}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new StagehandFacadeBridgeError(
            `Stagehand facade request "${method}" timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const request = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
      if (!this.send(JSON.stringify(request))) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
      }
    });
  }

  /** Settles the pending call matching this response, if any. */
  handleResponse(message: JsonRpcMessage & { id: string }): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (hasOwn(message, "error")) {
      entry.reject(rpcError(message.error));
    } else {
      entry.resolve(message.result);
    }
  }

  rejectAll(error: StagehandFacadeBridgeError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// AgentRelayServer: loopback TCP server the agent's relay connects to
// ---------------------------------------------------------------------------

interface AgentRelayHandlers {
  /** Replays the cached `initialize` result so each relay sees a fresh handshake. */
  initializeResult(): unknown;
  /** Forwards an agent request line to the facade. Returns false if the facade is gone. */
  forward(line: string): boolean;
}

type AgentRequest = {
  socket: Socket;
  /** The id the agent used; restored on the way back so concurrent relays can reuse ids. */
  originalId: unknown;
};

/**
 * Accepts relay connections and forwards agent requests to the facade.
 * Request ids are rewritten to a bridge-unique id on the way in and restored
 * on the way out, so two relays that both send `id: 1` never collide.
 * Notifications from the facade fan out to every connected relay.
 */
class AgentRelayServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly requests = new Map<string, AgentRequest>();
  private counter = 0;
  private _sawToolCall = false;

  constructor(
    private readonly handlers: AgentRelayHandlers,
    private readonly log: Log,
  ) {
    this.server = net.createServer((socket) => this.accept(socket));
  }

  get connections(): number {
    return this.sockets.size;
  }

  get sawToolCall(): boolean {
    return this._sawToolCall;
  }

  listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", onError);
        resolve((this.server.address() as AddressInfo).port);
      });
    });
  }

  /** Delivers a facade response to the relay that issued it, restoring the agent's own id. */
  deliver(message: JsonRpcMessage): void {
    const key = idKey(message.id);
    const request = this.requests.get(key);
    this.requests.delete(key);
    if (request?.socket.writable) {
      request.socket.write(`${JSON.stringify({ ...message, id: request.originalId })}\n`);
    }
  }

  /** Fans a facade notification out to every connected relay. */
  broadcast(rawLine: string): void {
    for (const socket of this.sockets) {
      if (socket.writable) socket.write(`${rawLine}\n`);
    }
  }

  /** Drops every relay connection; in-flight agent requests will never be answered. */
  disconnectAll(): void {
    for (const socket of this.sockets) socket.destroy();
    this.requests.clear();
  }

  /** Drops every relay connection and stops listening. */
  async close(): Promise<void> {
    this.disconnectAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    const decoder = new LineDecoder();
    socket.on("data", (chunk: Buffer | string) => {
      for (const line of decoder.feed(chunk)) this.handleAgentLine(socket, line);
    });
    socket.on("error", () => undefined);
    socket.once("close", () => {
      this.sockets.delete(socket);
      for (const [key, request] of this.requests) {
        if (request.socket === socket) this.requests.delete(key);
      }
    });
  }

  private handleAgentLine(socket: Socket, line: string): void {
    if (!line.trim()) return;
    const message = parseJsonRpc(line);
    if (!message) {
      this.log(`Dropped non-JSON agent relay line: ${line}`);
      return;
    }
    const isRequest = hasOwn(message, "id") && typeof message.method === "string";

    // The facade was initialized once by the runner; answer each relay's
    // handshake locally instead of re-initializing the shared server.
    if (message.method === "initialize" && hasOwn(message, "id")) {
      if (socket.writable) {
        const reply = { jsonrpc: "2.0", id: message.id, result: this.handlers.initializeResult() };
        socket.write(`${JSON.stringify(reply)}\n`);
      }
      return;
    }
    if (message.method === "notifications/initialized") return;

    let outbound = line;
    if (isRequest) {
      const bridgeId = `${AGENT_REQUEST_ID_PREFIX}${this.counter++}`;
      this.requests.set(idKey(bridgeId), { socket, originalId: message.id });
      outbound = JSON.stringify({ ...message, id: bridgeId });
      if (message.method === "tools/call") this._sawToolCall = true;
    }
    if (!this.handlers.forward(outbound)) {
      socket.destroy(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge: composes the three pieces
// ---------------------------------------------------------------------------

class StagehandFacadeBridgeImpl implements StagehandFacadeBridge {
  port = 0;
  mcpServerSpec: StagehandFacadeBridge["mcpServerSpec"] = { command: "", args: [], env: {} };

  private readonly facade: FacadeProcess;
  private readonly rpc: RunnerRpcClient;
  private readonly relay: AgentRelayServer;
  private initializeResult: unknown;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  private constructor(
    input: StagehandFacadeBridgeInput,
    private readonly log: Log,
    requestTimeoutMs: number,
  ) {
    this.facade = new FacadeProcess(
      input.server,
      log,
      (line) => this.routeFacadeLine(line),
      (error) => {
        this.rpc.rejectAll(error);
        this.relay.disconnectAll();
      },
    );
    this.rpc = new RunnerRpcClient((line) => this.facade.writeLine(line), requestTimeoutMs);
    this.relay = new AgentRelayServer(
      {
        initializeResult: () => this.initializeResult,
        forward: (line) => !this.closed && this.facade.writeLine(line),
      },
      log,
    );
  }

  /**
   * Spawns the facade, binds the relay server, and performs the MCP
   * `initialize` handshake on the runner's behalf. Cleans up on any failure.
   */
  static async start(input: StagehandFacadeBridgeInput): Promise<StagehandFacadeBridge> {
    const log: Log = (message) => {
      if (typeof input.logger?.log === "function") {
        input.logger.log({ category: "stagehand_facade", level: 2, message });
      }
    };
    const requestTimeoutMs =
      positiveInt(process.env.EVAL_FACADE_BRIDGE_REQUEST_TIMEOUT_MS) ??
      (input.requestTimeoutMs !== undefined && input.requestTimeoutMs > 0
        ? input.requestTimeoutMs
        : undefined) ??
      DEFAULT_REQUEST_TIMEOUT_MS;

    const bridge = new StagehandFacadeBridgeImpl(input, log, requestTimeoutMs);
    try {
      bridge.port = await bridge.relay.listen();
    } catch (error) {
      bridge.closed = true;
      await bridge.facade.terminate(0, 1_000, 0);
      throw new StagehandFacadeBridgeError(
        `Failed to start Stagehand facade bridge: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    bridge.mcpServerSpec = {
      command: process.execPath,
      args: ["-e", FACADE_RELAY_SCRIPT],
      env: { [STAGEHAND_FACADE_BRIDGE_PORT_ENV]: String(bridge.port) },
    };

    try {
      bridge.initializeResult = await bridge.call("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "stagehand-evals-facade-bridge", version: "1.0.0" },
      });
      bridge.facade.writeLine(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      );
      return bridge;
    } catch (error) {
      await bridge.close();
      throw error;
    }
  }

  agentConnections(): number {
    return this.relay.connections;
  }

  sawAgentToolCall(): boolean {
    return this.relay.sawToolCall;
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
    }
    if (this.facade.exited) {
      return Promise.reject(
        new StagehandFacadeBridgeError(
          `Stagehand facade exited with ${this.facade.exitDescription}`,
        ),
      );
    }
    return this.rpc.call(method, params);
  }

  async captureEvidence(): Promise<ProbeEvidence> {
    if (!this.relay.sawToolCall) return {};
    const evidence: ProbeEvidence = {};

    const screenshot = firstImageBlock(await this.callTool("screenshot", {}));
    if (screenshot) evidence.screenshot = screenshot;

    const url = firstTextBlock(await this.callTool("run", { code: "return page.url();" }));
    if (url !== undefined && /^[a-z][a-z0-9+.-]*:/iu.test(url)) evidence.url = url;

    // snapshot re-hydrates the active page's element-ID map ("Every call
    // replaces the active page's ID map"). Capturing it mid-run would make
    // the agent's bracketed IDs stale, so only terminal evidence includes it.
    if (this.relay.connections === 0) {
      const ariaTree = firstTextBlock(await this.callTool("snapshot", { includeIframes: true }));
      if (ariaTree !== undefined) evidence.ariaTree = ariaTree;
    }
    return evidence;
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closed = true;
      this.rpc.rejectAll(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
      // End stdin before awaiting relay teardown so the facade starts exiting immediately.
      this.facade.endStdin();
      await this.relay.close();
      const shutdownTimeoutMs =
        positiveInt(process.env.EVAL_FACADE_BRIDGE_SHUTDOWN_TIMEOUT_MS) ??
        DEFAULT_SHUTDOWN_TIMEOUT_MS;
      await this.facade.terminate(shutdownTimeoutMs, 2_000, 2_000);
    })();
    return this.closePromise;
  }

  /** Best-effort tools/call; resolves undefined on transport error or tool error. */
  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await this.call("tools/call", { name, arguments: args });
      return isToolError(result) ? undefined : result;
    } catch {
      return undefined;
    }
  }

  /** Demultiplexes one facade stdout line to the runner client or the agent relay. */
  private routeFacadeLine(rawLine: string): void {
    if (!rawLine.trim()) return;
    const message = parseJsonRpc(rawLine);
    if (!message) {
      this.log(`Dropped non-JSON facade stdout line: ${rawLine}`);
      return;
    }
    if (!hasOwn(message, "id")) {
      this.relay.broadcast(rawLine);
    } else if (RunnerRpcClient.ownsId(message.id)) {
      this.rpc.handleResponse(message as JsonRpcMessage & { id: string });
    } else {
      this.relay.deliver(message);
    }
  }
}

export async function startStagehandFacadeBridge(
  input: StagehandFacadeBridgeInput,
): Promise<StagehandFacadeBridge> {
  return StagehandFacadeBridgeImpl.start(input);
}
