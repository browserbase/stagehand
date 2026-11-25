import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net, { type AddressInfo, type Server, type Socket } from "node:net";
import type { ProbeEvidence } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import { EvalsError } from "../../errors.js";
import type { EvalLogger } from "../../logger.js";
import { parseSessionLossTelemetry } from "./browserSessionLoss.js";
import type { BrowserSessionLoss, RunnerToolCallResult } from "../contracts/tool.js";

export const STAGEHAND_FACADE_BRIDGE_PORT_ENV = "STAGEHAND_EVALS_FACADE_BRIDGE_PORT";

export class StagehandFacadeBridgeError extends EvalsError {
  constructor(message: string) {
    super(sanitizeErrorMessage(message));
    this.name = "StagehandFacadeBridgeError";
  }
}

export class StagehandFacadeTimeoutError extends StagehandFacadeBridgeError {
  constructor(readonly timeoutMs: number) {
    super(`Stagehand facade request timed out after ${timeoutMs}ms`);
    this.name = "StagehandFacadeTimeoutError";
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
  // A local Chrome launched headful on Linux needs the display; CHROME_PATH picks the binary.
  "DISPLAY",
  "XAUTHORITY",
  "CHROME_PATH",
] as const;

export interface StagehandFacadeBridgeInput {
  server: { command: string; args: string[]; env: Record<string, string> };
  logger?: EvalLogger;
  requestTimeoutMs?: number;
}

export interface StagehandFacadeBridge {
  port: number;
  mcpServerSpec: { command: string; args: string[]; env: Record<string, string> };
  agentConnections(): number;
  sawAgentToolCall(): boolean;
  call(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<RunnerToolCallResult>;
  sessionInfo(): Promise<{ provider: "local" | "browserbase"; sessionId?: string }>;
  browserSessionLoss(): BrowserSessionLoss | undefined;
  captureEvidence(): Promise<ProbeEvidence>;
  close(): Promise<void>;
}

export const FACADE_RELAY_SCRIPT = `const net=require("node:net");const port=Number(process.env.${STAGEHAND_FACADE_BRIDGE_PORT_ENV});const socket=net.createConnection({host:"127.0.0.1",port});let connected=false;socket.once("connect",()=>{connected=true;process.stdin.pipe(socket);socket.pipe(process.stdout);});socket.once("error",(error)=>{process.stderr.write("stagehand facade relay: "+error.message+"\\n");if(!connected)process.exit(1);});socket.once("close",()=>process.exit(0));process.stdin.once("end",()=>socket.end());`;

type JsonRpcMessage = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type Log = (message: string) => void;

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
    private readonly onExit: (error: StagehandFacadeBridgeError) => void,
    private readonly onStderr: (line: string) => void,
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

  get exitDescription(): string {
    return this._exitDescription;
  }

  get writable(): boolean {
    return !this._exited && !this.child.stdin.destroyed;
  }

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
    this.onStderr(line);
    this.stderrTail.push(sanitizeErrorMessage(line));
    if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
    this.log(sanitizeErrorMessage(line));
  }
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

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

  call(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      return Promise.reject(
        new StagehandFacadeBridgeError("timeoutMs must be an integer between 1 and 2147483647"),
      );
    }
    const id = `${RUNNER_REQUEST_ID_PREFIX}${this.counter++}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new StagehandFacadeTimeoutError(timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const request = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
      if (!this.send(JSON.stringify(request))) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
      }
    });
  }

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

interface AgentRelayHandlers {
  initializeResult(): unknown;
  forward(line: string): boolean;
}

type AgentRequest = {
  socket: Socket;
  originalId: unknown;
};

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

  deliver(message: JsonRpcMessage): void {
    const key = idKey(message.id);
    const request = this.requests.get(key);
    this.requests.delete(key);
    if (request?.socket.writable) {
      request.socket.write(`${JSON.stringify({ ...message, id: request.originalId })}\n`);
    }
  }

  broadcast(rawLine: string): void {
    for (const socket of this.sockets) {
      if (socket.writable) socket.write(`${rawLine}\n`);
    }
  }

  disconnectAll(): void {
    for (const socket of this.sockets) socket.destroy();
    this.requests.clear();
  }

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

    if (message.method === "initialize" && hasOwn(message, "id")) {
      if (socket.writable) {
        const reply = { jsonrpc: "2.0", id: message.id, result: this.handlers.initializeResult() };
        socket.write(`${JSON.stringify(reply)}\n`);
      }
      return;
    }
    if (message.method === "notifications/initialized") return;

    if (
      message.method === "tools/call" &&
      message.params !== null &&
      typeof message.params === "object" &&
      "name" in message.params &&
      message.params.name === "session_info"
    ) {
      if (hasOwn(message, "id") && socket.writable) {
        socket.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unknown tool: session_info" },
          })}\n`,
        );
      }
      return;
    }

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

class StagehandFacadeBridgeImpl implements StagehandFacadeBridge {
  port = 0;
  mcpServerSpec: StagehandFacadeBridge["mcpServerSpec"] = { command: "", args: [], env: {} };

  private readonly facade: FacadeProcess;
  private readonly rpc: RunnerRpcClient;
  private readonly relay: AgentRelayServer;
  private initializeResult: unknown;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private runnerToolCallSeen = false;
  private sessionLoss: BrowserSessionLoss | undefined;

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
      (line) => {
        this.sessionLoss ??= parseSessionLossTelemetry(line);
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
    return this.relay.sawToolCall || this.runnerToolCallSeen;
  }

  call(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
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
    return this.rpc.call(method, params, options);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<RunnerToolCallResult> {
    this.runnerToolCallSeen = true;
    const result = await this.call("tools/call", { name, arguments: args }, options);
    return {
      content: contentBlocks(result),
      ...(result &&
      typeof result === "object" &&
      typeof (result as { isError?: unknown }).isError === "boolean"
        ? { isError: (result as { isError: boolean }).isError }
        : {}),
    };
  }

  async sessionInfo(): Promise<{ provider: "local" | "browserbase"; sessionId?: string }> {
    const result = await this.call(
      "tools/call",
      { name: "session_info", arguments: {} },
      { timeoutMs: 120_000 },
    );
    if (isToolError(result))
      throw new StagehandFacadeBridgeError(firstTextBlock(result) ?? "Facade session_info failed");
    const parsed = JSON.parse(firstTextBlock(result) ?? "{}") as Record<string, unknown>;
    return {
      provider: parsed.provider === "browserbase" ? "browserbase" : "local",
      ...(typeof parsed.sessionId === "string" && parsed.sessionId
        ? { sessionId: parsed.sessionId }
        : {}),
    };
  }

  browserSessionLoss(): BrowserSessionLoss | undefined {
    return this.sessionLoss;
  }

  async captureEvidence(): Promise<ProbeEvidence> {
    if (!this.sawAgentToolCall()) return {};
    const evidence: ProbeEvidence = {};

    const screenshot = firstImageBlock(await this.evidenceTool("screenshot", {}));
    if (screenshot) evidence.screenshot = screenshot;

    const url = firstTextBlock(await this.evidenceTool("run", { code: "return page.url();" }));
    if (url !== undefined && /^[a-z][a-z0-9+.-]*:/iu.test(url)) evidence.url = url;

    if (this.relay.connections === 0 && !this.runnerToolCallSeen) {
      const ariaTree = firstTextBlock(
        await this.evidenceTool("snapshot", { includeIframes: true }),
      );
      if (ariaTree !== undefined) evidence.ariaTree = ariaTree;
    }
    return evidence;
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closed = true;
      this.rpc.rejectAll(new StagehandFacadeBridgeError("Stagehand facade bridge is closed"));
      this.facade.endStdin();
      await this.relay.close();
      const shutdownTimeoutMs =
        positiveInt(process.env.EVAL_FACADE_BRIDGE_SHUTDOWN_TIMEOUT_MS) ??
        DEFAULT_SHUTDOWN_TIMEOUT_MS;
      await this.facade.terminate(shutdownTimeoutMs, 2_000, 2_000);
    })();
    return this.closePromise;
  }

  private async evidenceTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await this.call("tools/call", { name, arguments: args });
      return isToolError(result) ? undefined : result;
    } catch {
      return undefined;
    }
  }

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
