import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { fail } from "../errors.js";
import {
  functionsRequest,
  resolveEntrypoint,
  resolveFunctionsApiConfig,
  type FunctionsApiConfig,
} from "./shared.js";

const DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS = 10_000;

export interface StartFunctionsDevServerOptions {
  apiKey?: string;
  baseUrl?: string;
  entrypoint: string;
  host: string;
  port: number;
  verbose: boolean;
}

interface InvocationContext {
  session: {
    id: string;
    connectUrl: string;
  };
}

interface PendingConnection {
  corsHeaders: Record<string, string>;
  response: ServerResponse;
}

interface FunctionManifest {
  name: string;
  config?: {
    sessionConfig?: Record<string, unknown>;
  };
}

class InvocationBridge {
  private cleanupSessionCallback:
    | ((sessionId: string) => Promise<void>)
    | null = null;
  private currentRequestId: string | null = null;
  private currentSessionId: string | null = null;
  private invokeConnection: PendingConnection | null = null;
  private nextConnection: PendingConnection | null = null;
  private runtimeConnected = false;

  setCleanupSessionCallback(callback: (sessionId: string) => Promise<void>) {
    this.cleanupSessionCallback = callback;
  }

  holdNextConnection(
    response: ServerResponse,
    corsHeaders: Record<string, string>,
  ) {
    this.runtimeConnected = true;
    if (this.nextConnection) {
      this.nextConnection.response.writeHead(503, {
        ...this.nextConnection.corsHeaders,
        "content-type": "application/json",
      });
      this.nextConnection.response.end(
        JSON.stringify({ error: "Another runtime process connected." }),
      );
    }
    this.nextConnection = { corsHeaders, response };
  }

  isRuntimeConnected() {
    return this.runtimeConnected && this.nextConnection !== null;
  }

  hasActiveInvocation() {
    return this.invokeConnection !== null;
  }

  async completeWithSuccess(requestId: string, payload: unknown) {
    if (requestId !== this.currentRequestId || !this.invokeConnection) {
      return false;
    }

    sendJson(
      this.invokeConnection.response,
      200,
      payload ?? {},
      this.invokeConnection.corsHeaders,
    );
    try {
      await this.cleanupSession();
    } catch (error) {
      this.reportCleanupError(error);
    } finally {
      this.reset();
    }
    return true;
  }

  async completeWithError(
    requestId: string,
    payload: { errorMessage: string; errorType: string; stackTrace: string[] },
  ) {
    if (requestId !== this.currentRequestId || !this.invokeConnection) {
      return false;
    }

    sendJson(
      this.invokeConnection.response,
      500,
      { error: payload },
      this.invokeConnection.corsHeaders,
    );
    try {
      await this.cleanupSession();
    } catch (error) {
      this.reportCleanupError(error);
    } finally {
      this.reset();
    }
    return true;
  }

  triggerInvocation(
    functionName: string,
    params: Record<string, unknown>,
    context: InvocationContext,
    corsHeaders: Record<string, string>,
    response: ServerResponse,
  ): boolean {
    if (!this.nextConnection || this.invokeConnection) {
      return false;
    }

    const requestId = randomUUID();
    this.currentRequestId = requestId;
    this.currentSessionId = context.session.id;
    this.invokeConnection = { corsHeaders, response };

    this.nextConnection.response.writeHead(200, {
      ...this.nextConnection.corsHeaders,
      "content-type": "application/json",
      "Lambda-Runtime-Aws-Request-Id": requestId,
      "Lambda-Runtime-Deadline-Ms": String(Date.now() + 300_000),
      "Lambda-Runtime-Invoked-Function-Arn": `arn:aws:lambda:local:function:${functionName}`,
    });
    this.nextConnection.response.end(
      JSON.stringify({
        context,
        functionName,
        params,
      }),
    );
    this.nextConnection = null;
    return true;
  }

  private async cleanupSession() {
    if (this.cleanupSessionCallback && this.currentSessionId) {
      await this.cleanupSessionCallback(this.currentSessionId);
    }
  }

  private reportCleanupError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Functions dev session cleanup failed: ${message}\n`);
  }

  private reset() {
    this.currentRequestId = null;
    this.currentSessionId = null;
    this.invokeConnection = null;
  }
}

class BrowserSessionManager {
  constructor(private readonly config: FunctionsApiConfig) {}

  async createSession(
    sessionConfig: Record<string, unknown> = {},
  ): Promise<InvocationContext["session"]> {
    const response = await functionsRequest(this.config, "/v1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
    });
    const session = (await response.json()) as {
      id?: string;
      connectUrl?: string;
    };
    if (!session.id || !session.connectUrl) {
      fail(
        "Browserbase session create completed without returning id and connectUrl.",
      );
    }
    return {
      connectUrl: session.connectUrl,
      id: session.id,
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    await functionsRequest(this.config, `/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    });
  }
}

class ManifestStore {
  private readonly manifestsPath = join(
    process.cwd(),
    ".browserbase",
    "functions",
    "manifests",
  );

  private readonly manifests = new Map<string, FunctionManifest>();

  async load(): Promise<void> {
    this.manifests.clear();
    if (!existsSync(this.manifestsPath)) {
      return;
    }

    const entries = await readdir(this.manifestsPath);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const manifest = JSON.parse(
        await readFile(join(this.manifestsPath, entry), "utf8"),
      ) as FunctionManifest;
      this.manifests.set(manifest.name, manifest);
    }
  }

  get(name: string): FunctionManifest | undefined {
    return this.manifests.get(name);
  }
}

class RuntimeProcess {
  private process: ReturnType<typeof spawn> | null = null;

  constructor(
    private readonly entrypoint: string,
    private readonly runtimeApi: string,
    private readonly verbose: boolean,
  ) {}

  async start() {
    const require = createRequire(import.meta.url);
    const tsxCli = require.resolve("tsx/cli");
    const nodeExecutable =
      "bun" in process.versions ? "node" : process.execPath;
    const child = spawn(
      nodeExecutable,
      [tsxCli, "watch", "--clear-screen=false", this.entrypoint],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AWS_LAMBDA_RUNTIME_API: this.runtimeApi,
          BB_FUNCTIONS_PHASE: "runtime",
          NODE_ENV: "local",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.process = child;

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        process.stderr.write(`${this.verbose ? "[runtime] " : ""}${text}\n`);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        process.stderr.write(
          `${this.verbose ? "[runtime:error] " : ""}${text}\n`,
        );
      }
    });

    child.once("exit", () => {
      if (this.process === child) {
        this.process = null;
      }
    });

    try {
      await waitForChildSpawn(child);
    } catch (error) {
      this.process = null;
      fail(`Failed to start functions runtime: ${formatErrorMessage(error)}`);
    }
  }

  async stop() {
    const child = this.process;
    if (!child) {
      return;
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      this.process = null;
      return;
    }

    await new Promise<void>((resolvePromise) => {
      const forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      const finish = () => {
        clearTimeout(forceKillTimer);
        resolvePromise();
      };

      child.once("exit", finish);
      if (!child.kill("SIGTERM")) {
        child.off("exit", finish);
        finish();
      }
    });
    this.process = null;
  }
}

export async function startFunctionsDevServer(
  options: StartFunctionsDevServerOptions,
): Promise<void> {
  const entrypoint = await resolveEntrypoint(options.entrypoint);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    fail("Port must be an integer between 1 and 65535.");
  }

  const config = resolveFunctionsApiConfig(options);
  const runtimeApi = `${options.host}:${options.port}`;
  const bridge = new InvocationBridge();
  const sessionManager = new BrowserSessionManager(config);
  const manifestStore = new ManifestStore();

  bridge.setCleanupSessionCallback(async (sessionId) => {
    await sessionManager.closeSession(sessionId);
  });

  await mkdir(join(process.cwd(), ".browserbase", "functions", "manifests"), {
    recursive: true,
  });

  const server = await startServer(
    options.host,
    options.port,
    bridge,
    manifestStore,
    sessionManager,
  );
  const runtime = new RuntimeProcess(entrypoint, runtimeApi, options.verbose);
  await runtime.start();

  const runtimeConnected = await waitForRuntime(
    bridge,
    manifestStore,
    getRuntimeStartupTimeoutMs(),
  );

  const output: {
    ok: boolean;
    runtimeConnected: boolean;
    url: string;
    warning?: string;
  } = {
    ok: runtimeConnected,
    runtimeConnected,
    url: `http://${options.host}:${options.port}`,
  };
  if (!runtimeConnected) {
    output.warning = [
      "Functions runtime has not connected yet.",
      "Check the runtime logs, then retry once the entrypoint is healthy.",
    ].join(" ");
  }
  console.log(JSON.stringify(output, null, 2));

  const shutdown = async () => {
    await runtime.stop();
    await new Promise<void>((resolvePromise) =>
      server.close(() => resolvePromise()),
    );
  };

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

async function startServer(
  host: string,
  port: number,
  bridge: InvocationBridge,
  manifestStore: ManifestStore,
  sessionManager: BrowserSessionManager,
): Promise<Server> {
  const server = createServer((request, response) => {
    routeRequest(
      request,
      response,
      bridge,
      manifestStore,
      sessionManager,
    ).catch((error) => {
      handleRouteError(response, error);
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.listen(port, host, () => resolvePromise());
    server.on("error", reject);
  });

  return server;
}

function handleRouteError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Functions dev request failed: ${message}\n`);

  if (!response.headersSent && !response.writableEnded) {
    sendJson(response, 500, { error: message }, baseCorsHeaders());
    return;
  }

  if (!response.writableEnded) {
    response.end();
  }
}

async function waitForRuntime(
  bridge: InvocationBridge,
  manifestStore: ManifestStore,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bridge.isRuntimeConnected()) {
      await manifestStore.load();
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }

  await manifestStore.load();
  return bridge.isRuntimeConnected();
}

function getRuntimeStartupTimeoutMs(): number {
  const rawValue = process.env.BROWSERBASE_FUNCTIONS_DEV_STARTUP_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(
      "BROWSERBASE_FUNCTIONS_DEV_STARTUP_TIMEOUT_MS must be a non-negative number.",
    );
  }

  return parsed;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: InvocationBridge,
  manifestStore: ManifestStore,
  sessionManager: BrowserSessionManager,
): Promise<void> {
  const method = request.method || "GET";
  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || "127.0.0.1"}`,
  );
  const path = url.pathname;
  const corsHeaders = corsHeadersForRequest(request);

  if (!corsHeaders) {
    sendForbiddenOrigin(response);
    return;
  }

  if (method === "OPTIONS") {
    sendNoContent(response, 204, corsHeaders);
    return;
  }

  if (method === "GET" && path === "/") {
    sendJson(response, 200, { ok: true }, corsHeaders);
    return;
  }

  if (method === "GET" && path === "/2018-06-01/runtime/invocation/next") {
    bridge.holdNextConnection(response, corsHeaders);
    return;
  }

  const invokeMatch = path.match(/^\/v1\/functions\/([^/]+)\/invoke$/);
  if (method === "POST" && invokeMatch?.[1]) {
    await manifestStore.load();
    const functionName = invokeMatch[1];
    const manifest = manifestStore.get(functionName);
    if (!manifest) {
      sendJson(
        response,
        404,
        {
          error: `Function "${functionName}" was not found in .browserbase/functions/manifests.`,
        },
        corsHeaders,
      );
      return;
    }

    if (bridge.hasActiveInvocation()) {
      sendJson(
        response,
        503,
        { error: "Another invocation is already in progress." },
        corsHeaders,
      );
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(
        response,
        400,
        {
          error: error instanceof Error ? error.message : "Invalid JSON body.",
        },
        corsHeaders,
      );
      return;
    }

    const params =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { params?: Record<string, unknown> }).params || {}
        : {};

    const session = await sessionManager.createSession(
      manifest.config?.sessionConfig,
    );
    const accepted = bridge.triggerInvocation(
      functionName,
      params,
      { session },
      corsHeaders,
      response,
    );

    if (!accepted) {
      await sessionManager.closeSession(session.id);
      sendJson(
        response,
        503,
        { error: "No runtime is connected yet." },
        corsHeaders,
      );
    }
    return;
  }

  const responseMatch = path.match(
    /^\/2018-06-01\/runtime\/invocation\/([^/]+)\/response$/,
  );
  if (method === "POST" && responseMatch?.[1]) {
    const requestId = responseMatch[1];
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch (error) {
      const message = `Invalid runtime response payload: ${formatErrorMessage(error)}`;
      const completed = await bridge.completeWithError(requestId, {
        errorMessage: message,
        errorType: "RuntimeResponseError",
        stackTrace: [],
      });
      sendJson(
        response,
        400,
        completed ? { error: message } : { error: "Request ID mismatch." },
        corsHeaders,
      );
      return;
    }
    const completed = await bridge.completeWithSuccess(requestId, payload);
    sendJson(
      response,
      completed ? 202 : 400,
      completed ? { ok: true } : { error: "Request ID mismatch." },
      corsHeaders,
    );
    return;
  }

  const errorMatch = path.match(
    /^\/2018-06-01\/runtime\/invocation\/([^/]+)\/error$/,
  );
  if (method === "POST" && errorMatch?.[1]) {
    const requestId = errorMatch[1];
    let payload;
    try {
      payload = (await readJsonBody(request)) as {
        errorMessage?: string;
        errorType?: string;
        stackTrace?: string[];
      };
    } catch (error) {
      const message = `Invalid runtime error payload: ${formatErrorMessage(error)}`;
      const completed = await bridge.completeWithError(requestId, {
        errorMessage: message,
        errorType: "RuntimeResponseError",
        stackTrace: [],
      });
      sendJson(
        response,
        400,
        completed ? { error: message } : { error: "Request ID mismatch." },
        corsHeaders,
      );
      return;
    }
    const completed = await bridge.completeWithError(requestId, {
      errorMessage: payload?.errorMessage || "Unknown runtime error",
      errorType: payload?.errorType || "RuntimeError",
      stackTrace: Array.isArray(payload?.stackTrace) ? payload.stackTrace : [],
    });
    sendJson(
      response,
      completed ? 202 : 400,
      completed ? { ok: true } : { error: "Request ID mismatch." },
      corsHeaders,
    );
    return;
  }

  sendJson(response, 404, { error: "Not found." }, corsHeaders);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForChildSpawn(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const cleanup = () => {
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onSpawn = () => {
      cleanup();
      resolvePromise();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  corsHeaders: Record<string, string>,
): void {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function sendNoContent(
  response: ServerResponse,
  statusCode: number,
  corsHeaders: Record<string, string>,
): void {
  response.writeHead(statusCode, corsHeaders);
  response.end();
}

function sendForbiddenOrigin(response: ServerResponse): void {
  response.writeHead(403, {
    "content-type": "application/json",
    vary: "Origin",
  });
  response.end(JSON.stringify({ error: "Origin is not allowed." }));
}

function corsHeadersForRequest(
  request: IncomingMessage,
): Record<string, string> | null {
  const origin = request.headers.origin;
  if (origin === undefined) return baseCorsHeaders();
  if (Array.isArray(origin)) return null;
  if (!isAllowedLoopbackOrigin(origin)) return null;

  return {
    ...baseCorsHeaders(),
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
}

function baseCorsHeaders(): Record<string, string> {
  return {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

function isAllowedLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
