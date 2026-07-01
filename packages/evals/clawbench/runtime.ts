import type { LocalBrowserLaunchOptions } from "@browserbasehq/stagehand";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getClawBenchRuntimeRoot } from "./paths.js";
import type { ClawBenchEvalSchema, ClawBenchRunParams } from "./types.js";

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  sessionId?: string;
  error?: unknown;
};

export interface ClawBenchRuntime {
  runDir: string;
  dataDir: string;
  serverPort: number;
  cdpPort: number;
  extensionDir: string;
  launchOptions: Partial<LocalBrowserLaunchOptions>;
  startCdpInterceptor: () => Promise<void>;
  recordAction: (action: unknown) => Promise<void>;
  recordAgentMessage: (message: unknown) => Promise<void>;
  readInterception: () => Promise<Record<string, unknown> | null>;
  stop: () => Promise<void>;
}

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Unable to allocate port"));
      });
    });
    server.on("error", reject);
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function submitHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Submit Final Answer</title></head>
<body>
  <main style="max-width:820px;margin:40px auto;font-family:sans-serif">
    <h1>Submit Final Answer</h1>
    <form id="answer-form">
      <textarea id="answer" style="width:100%;min-height:340px"></textarea>
      <button type="submit">Submit</button>
      <div id="status"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById("answer-form");
    const answer = document.getElementById("answer");
    const status = document.getElementById("status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Submitting...";
      try {
        await fetch("/api/task-submit", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({answer: answer.value})
        });
      } catch (_) {}
      status.textContent = "Submitted.";
    });
  </script>
</body>
</html>`;
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`);
}

function sanitizeArtifactValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return "[IMAGE_REDACTED]";
    if (value.length > 20000) return `${value.slice(0, 20000)}...[TRUNCATED]`;
    return value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) => sanitizeArtifactValue(item, seen, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes("api_key") ||
      lowered.includes("apikey") ||
      lowered.includes("authorization") ||
      lowered.includes("cookie") ||
      lowered.includes("token") ||
      lowered.includes("secret")
    ) {
      output[key] = "[REDACTED]";
      continue;
    }
    if (lowered.includes("screenshot") || lowered === "image") {
      output[key] = "[IMAGE_REDACTED]";
      continue;
    }
    output[key] = sanitizeArtifactValue(nested, seen, depth + 1);
  }
  return output;
}

function withTimestamp(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeArtifactValue(value);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return {
      timestamp: Date.now() / 1000,
      ...(sanitized as Record<string, unknown>),
    };
  }
  return { timestamp: Date.now() / 1000, value: sanitized };
}

function parseBody(raw?: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const params = new URLSearchParams(raw);
    if ([...params.keys()].length > 0) {
      const obj: Record<string, string | string[]> = {};
      for (const [key, value] of params.entries()) {
        const existing = obj[key];
        if (existing === undefined) obj[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else obj[key] = [existing, value];
      }
      return obj;
    }
    return raw;
  }
}

function constFieldsMatch(expected: unknown, actual: unknown): boolean {
  if (!expected || typeof expected !== "object") return true;
  if (Array.isArray(actual)) {
    return actual.some((item) => constFieldsMatch(expected, item));
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualObj = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(
    ([key, value]) => actualObj[key] === value,
  );
}

export function matchesClawBenchEvalSchema(
  schema: ClawBenchEvalSchema,
  request: {
    url: string;
    method: string;
    body?: unknown;
    params?: Record<string, string | string[]>;
  },
): boolean {
  return (
    new RegExp(schema.url_pattern).test(request.url) &&
    request.method === schema.method &&
    constFieldsMatch(schema.body, request.body) &&
    constFieldsMatch(schema.params, request.params ?? queryParams(request.url))
  );
}

function queryParams(url: string): Record<string, string | string[]> {
  const parsed = new URL(url);
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

function shouldFilterUrl(url: string): boolean {
  return (
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("chrome://") ||
    /127\.0\.0\.1:\d+/.test(url) ||
    /localhost:\d+/.test(url)
  );
}

async function copyExtension(sourceDir: string, destDir: string, port: number) {
  await fs.cp(sourceDir, destDir, { recursive: true });
  const backgroundPath = path.join(destDir, "background.js");
  const background = await fs.readFile(backgroundPath, "utf-8");
  await fs.writeFile(
    backgroundPath,
    background.replace(
      'const SERVER = "http://localhost:7878";',
      `const SERVER = "http://localhost:${port}";`,
    ),
  );
}

class CdpInterceptor {
  private ws: WebSocket | null = null;
  private msgId = 1;
  private fetchSessions = new Set<string>();
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly cdpPort: number,
    private readonly dataDir: string,
    private readonly schema: ClawBenchEvalSchema,
  ) {}

  async start(): Promise<void> {
    const version = (await this.waitForJsonVersion()) as {
      webSocketDebuggerUrl?: string;
    };
    if (!version.webSocketDebuggerUrl) {
      throw new Error("Chrome CDP did not expose webSocketDebuggerUrl");
    }
    if (typeof WebSocket === "undefined") {
      throw new Error("Global WebSocket is not available in this Node runtime");
    }

    this.ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(version.webSocketDebuggerUrl!);
      socket.addEventListener("open", () => resolve(socket), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("CDP websocket failed to open")),
        { once: true },
      );
    });

    this.ws.addEventListener("message", (event) => {
      void this.handleMessage(String(event.data)).catch(() => {});
    });
    await this.request("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    const targets = (await this.request("Target.getTargets")) as {
      targetInfos?: Array<Record<string, unknown>>;
    };
    for (const target of targets.targetInfos ?? []) {
      if (target.type !== "page" || !target.targetId) continue;
      const attached = (await this.request("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      }).catch((): null => null)) as {
        sessionId?: string;
      } | null;
      if (attached?.sessionId) {
        this.enableFetch(attached.sessionId);
        this.send("Runtime.runIfWaitingForDebugger", {}, attached.sessionId);
      }
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private async waitForJsonVersion(): Promise<unknown> {
    const deadline = Date.now() + 20_000;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${this.cdpPort}/json/version`,
        );
        if (response.ok) return await response.json();
        lastError = `${response.status} ${response.statusText}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for Chrome CDP: ${lastError}`);
  }

  private send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): void {
    this.ws?.send(
      JSON.stringify({
        id: this.msgId++,
        method,
        params,
        ...(sessionId && { sessionId }),
      }),
    );
  }

  private request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> {
    const id = this.msgId++;
    const payload = { id, method, params, ...(sessionId && { sessionId }) };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws?.send(JSON.stringify(payload));
    });
  }

  private enableFetch(sessionId: string): void {
    if (this.fetchSessions.has(sessionId)) return;
    this.send(
      "Fetch.enable",
      { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
      sessionId,
    );
    this.fetchSessions.add(sessionId);
  }

  private async handleMessage(raw: string): Promise<void> {
    const msg = JSON.parse(raw) as CdpMessage;
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(pending.timeout);
      if (msg.error) {
        pending.reject(new Error(JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }

    if (msg.method === "Target.attachedToTarget") {
      const params = msg.params ?? {};
      const childSession = String(params.sessionId ?? "");
      const targetInfo = params.targetInfo as
        | Record<string, unknown>
        | undefined;
      if (
        targetInfo?.type === "page" &&
        !this.fetchSessions.has(childSession)
      ) {
        this.enableFetch(childSession);
      }
      this.send("Runtime.runIfWaitingForDebugger", {}, childSession);
      return;
    }

    if (msg.method !== "Fetch.requestPaused") return;
    const params = msg.params ?? {};
    const request = params.request as Record<string, unknown> | undefined;
    const requestId = String(params.requestId ?? "");
    const sessionId = msg.sessionId;
    const url = String(request?.url ?? "");
    const method = String(request?.method ?? "");
    const body = parseBody(
      typeof request?.postData === "string" ? request.postData : undefined,
    );
    const paramsObj = queryParams(url);

    if (!shouldFilterUrl(url)) {
      await appendJsonl(path.join(this.dataDir, "requests.jsonl"), {
        timestamp: Date.now() / 1000,
        url,
        method,
        headers: request?.headers ?? {},
        body,
        query_params: paramsObj,
        resource_type: params.resourceType ?? "Other",
      });
    }

    if (!this.matches(url, method, body, paramsObj)) {
      this.send("Fetch.continueRequest", { requestId }, sessionId);
      return;
    }

    this.send(
      "Fetch.failRequest",
      { requestId, errorReason: "BlockedByClient" },
      sessionId,
    );
    const interceptionPath = path.join(this.dataDir, "interception.json");
    if (!fsSync.existsSync(interceptionPath)) {
      await fs.writeFile(
        interceptionPath,
        JSON.stringify(
          {
            intercepted: true,
            request: { url, method, params: paramsObj, body },
            schema: this.schema,
          },
          null,
          2,
        ),
      );
    }
    await fs.writeFile(path.join(this.dataDir, ".stop-requested"), "");
  }

  private matches(
    url: string,
    method: string,
    body: unknown,
    params: Record<string, string | string[]>,
  ): boolean {
    return matchesClawBenchEvalSchema(this.schema, {
      url,
      method,
      body,
      params,
    });
  }
}

export async function prepareClawBenchRuntime(
  params: ClawBenchRunParams,
): Promise<ClawBenchRuntime> {
  const serverPort = await pickFreePort();
  const cdpPort = await pickFreePort();
  const runRoot =
    process.env.EVAL_CLAWBENCH_OUTPUT_DIR ??
    path.join(process.cwd(), "tmp", "evals", "clawbench");
  await fs.mkdir(runRoot, { recursive: true });
  const runDir = await fs.mkdtemp(
    path.join(runRoot, `${params.caseName.replace(/[^A-Za-z0-9_.-]/g, "_")}-`),
  );
  const dataDir = path.join(runDir, "data");
  await fs.mkdir(path.join(dataDir, "screenshots"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "actions.jsonl"), "");
  await fs.writeFile(path.join(dataDir, "agent-messages.jsonl"), "");
  await fs.writeFile(path.join(dataDir, "requests.jsonl"), "");

  const extensionDir = path.join(runDir, "chrome-extension");
  await copyExtension(
    path.join(getClawBenchRuntimeRoot(), "chrome-extension"),
    extensionDir,
    serverPort,
  );

  const server = http.createServer((req, res) => {
    void handleRuntimeRequest(req, res, dataDir).catch((error) => {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(serverPort, "127.0.0.1", resolve);
    server.once("error", reject);
  });

  const interceptor = new CdpInterceptor(cdpPort, dataDir, params.evalSchema);

  return {
    runDir,
    dataDir,
    serverPort,
    cdpPort,
    extensionDir,
    launchOptions: {
      port: cdpPort,
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: [
        `--load-extension=${extensionDir}`,
        `--disable-extensions-except=${extensionDir}`,
        "--disable-blink-features=AutomationControlled",
      ],
    },
    startCdpInterceptor: async () => {
      await interceptor.start();
    },
    recordAction: async (action: unknown) => {
      await appendJsonl(path.join(dataDir, "actions.jsonl"), {
        timestamp: Date.now() / 1000,
        source: "stagehand_agent",
        action,
      });
    },
    recordAgentMessage: async (message: unknown) => {
      await appendJsonl(
        path.join(dataDir, "agent-messages.jsonl"),
        withTimestamp(message),
      );
    },
    readInterception: async () => {
      const filePath = path.join(dataDir, "interception.json");
      if (!fsSync.existsSync(filePath)) return null;
      return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<
        string,
        unknown
      >;
    },
    stop: async () => {
      interceptor.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleRuntimeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, { status: "ok", eval_interceptor_ready: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/submit") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(submitHtml());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    await appendJsonl(path.join(dataDir, "actions.jsonl"), body);
    sendJson(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/screenshot") {
    const body = JSON.parse(
      (await readBody(req)).toString("utf-8") || "{}",
    ) as {
      timestamp?: number;
      data?: string;
    };
    if (body.data) {
      await fs.writeFile(
        path.join(
          dataDir,
          "screenshots",
          `${body.timestamp ?? Date.now()}.png`,
        ),
        Buffer.from(body.data, "base64"),
      );
    }
    sendJson(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/task-submit") {
    const body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    const submission = { timestamp: Date.now() / 1000, body };
    await fs.writeFile(
      path.join(dataDir, "submission.json"),
      JSON.stringify(submission, null, 2),
    );
    await appendJsonl(path.join(dataDir, "actions.jsonl"), {
      type: "task_submit",
      ...submission,
    });
    sendJson(res, 200, { status: "received" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/stop") {
    await fs.writeFile(path.join(dataDir, ".stop-requested"), "");
    sendJson(res, 200, { status: "stopped" });
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

export function runtimeFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
