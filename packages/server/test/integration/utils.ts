import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// =============================================================================
// HTTP Status Codes
// =============================================================================

export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;
export const HTTP_GONE = 410;
export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_INTERNAL_SERVER_ERROR = 500;

// =============================================================================
// Timing Constants
// =============================================================================

export const SESSION_CLOSE_WAIT_MS = 2000;

// =============================================================================
// Environment Variables
// =============================================================================

export const {
  STAGEHAND_API_URL,
  OPENAI_API_KEY,
  GEMINI_API_KEY,
  ANTHROPIC_API_KEY,
} = process.env;

// =============================================================================
// Utility Functions
// =============================================================================

export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getBaseUrl(): string {
  return STAGEHAND_API_URL ?? "http://127.0.0.1:3107";
}

// =============================================================================
// Header Generators
// =============================================================================

export function getHeaders(
  sdkVersion: string,
  language: string = "typescript",
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-model-api-key": requireEnv("OPENAI_API_KEY", OPENAI_API_KEY),
    "x-language": language,
    "x-sdk-version": sdkVersion,
  };
}

// =============================================================================
// Session Management
// =============================================================================

export interface StartSessionResponse {
  success: boolean;
  message?: string;
  data?: {
    sessionId: string;
    cdpUrl: string;
    available: boolean;
  };
}

const SESSION_READY_DELAY_MS = 250;
const LOCAL_CONNECT_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.STAGEHAND_TEST_LOCAL_CONNECT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
})();

export interface SessionInfo {
  sessionId: string;
  cdpUrl: string;
}

function createLocalBrowserBody() {
  const resolveChromePath = (): string => {
    const explicit = process.env.CHROME_PATH;
    if (explicit && fs.existsSync(explicit)) {
      return explicit;
    }
    if (explicit) {
      throw new Error(`CHROME_PATH does not exist: ${explicit}`);
    }

    const playwrightPath = chromium.executablePath();
    if (playwrightPath && fs.existsSync(playwrightPath)) {
      return playwrightPath;
    }

    throw new Error(
      "Unable to locate a Chrome executable. Set CHROME_PATH in the test environment.",
    );
  };

  return {
    browser: {
      type: "local",
      launchOptions: {
        headless: true,
        executablePath: resolveChromePath(),
        args: process.env.CI ? ["--no-sandbox"] : undefined,
        userDataDir: undefined,
        connectTimeoutMs: LOCAL_CONNECT_TIMEOUT_MS,
      },
    },
  };
}

export const LOCAL_BROWSER_BODY = createLocalBrowserBody();

function readChromeLogs(userDataDir?: string): string {
  if (!userDataDir) return "";
  const entries: string[] = [];
  const outPath = path.join(userDataDir, "chrome-out.log");
  const errPath = path.join(userDataDir, "chrome-err.log");
  if (fs.existsSync(outPath)) {
    entries.push(`--- chrome stdout ---\n${fs.readFileSync(outPath, "utf8")}`);
  }
  if (fs.existsSync(errPath)) {
    entries.push(`--- chrome stderr ---\n${fs.readFileSync(errPath, "utf8")}`);
  }
  return entries.join("\n");
}

function readLaunchDiagnostics(
  userDataDir: string | undefined,
  launchOptions?: {
    executablePath?: string;
    args?: string[];
    headless?: boolean;
    userDataDir?: string;
    port?: number;
    connectTimeoutMs?: number;
  },
): string {
  const diagnostics: string[] = [];
  diagnostics.push("--- launch diagnostics ---");
  diagnostics.push(`CHROME_PATH env: ${process.env.CHROME_PATH ?? "<unset>"}`);
  diagnostics.push(`CI env: ${process.env.CI ?? "<unset>"}`);
  diagnostics.push(`userDataDir: ${userDataDir ?? "<auto>"}`);
  if (!userDataDir) {
    diagnostics.push("userDataDir exists: <unknown>");
  } else {
    diagnostics.push(`userDataDir exists: ${fs.existsSync(userDataDir)}`);
  }
  if (userDataDir && fs.existsSync(userDataDir)) {
    const files = fs.readdirSync(userDataDir).sort();
    diagnostics.push(
      `userDataDir files: ${files.length > 0 ? files.join(", ") : "<empty>"}`,
    );
  }
  if (launchOptions) {
    diagnostics.push(
      `launch.executablePath: ${launchOptions.executablePath ?? "<unset>"}`,
    );
    diagnostics.push(
      `launch.executablePath exists: ${
        launchOptions.executablePath
          ? fs.existsSync(launchOptions.executablePath)
          : false
      }`,
    );
    diagnostics.push(`launch.headless: ${String(launchOptions.headless)}`);
    diagnostics.push(
      `launch.args: ${JSON.stringify(launchOptions.args ?? [])}`,
    );
    diagnostics.push(`launch.port: ${launchOptions.port ?? "<auto>"}`);
    diagnostics.push(
      `launch.connectTimeoutMs: ${launchOptions.connectTimeoutMs ?? "<default>"}`,
    );
  }
  return diagnostics.join("\n");
}

export async function createSession(
  headers: Record<string, string>,
): Promise<string> {
  const info = await createSessionWithCdp(headers);
  return info.sessionId;
}

export async function createSessionWithCdp(
  headers: Record<string, string>,
): Promise<SessionInfo> {
  const url = getBaseUrl();
  const startPayload = {
    modelName: "gpt-4.1-nano",
    ...createLocalBrowserBody(),
  };
  const userDataDir = startPayload.browser?.launchOptions?.userDataDir;

  const response = await fetch(`${url}/v1/sessions/start`, {
    method: "POST",
    headers,
    body: JSON.stringify(startPayload),
  });

  const responseText = await response.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsedBody = responseText;
  }
  const body = parsedBody as StartSessionResponse;

  if (!response.ok || !body?.success) {
    const chromeLogs = readChromeLogs(userDataDir);
    const launchDiagnostics = readLaunchDiagnostics(
      userDataDir,
      startPayload.browser?.launchOptions,
    );
    throw new Error(
      `Failed to create session (status=${response.status}): ${JSON.stringify(
        parsedBody,
      )}\n${launchDiagnostics}${chromeLogs ? `\n${chromeLogs}` : ""}`,
    );
  }
  if (!body.data?.available) {
    const chromeLogs = readChromeLogs(userDataDir);
    throw new Error(
      `Session not available${chromeLogs ? `\n${chromeLogs}` : ""}`,
    );
  }
  if (!body.data.sessionId) {
    throw new Error("No sessionId returned");
  }
  if (!body.data.cdpUrl) {
    throw new Error("No cdpUrl returned");
  }

  // Wait for session to be fully ready before returning
  await new Promise((resolve) => setTimeout(resolve, SESSION_READY_DELAY_MS));

  return {
    sessionId: body.data.sessionId,
    cdpUrl: body.data.cdpUrl,
  };
}

export async function endSession(
  sessionId: string,
  headers: Record<string, string>,
): Promise<void> {
  const url = getBaseUrl();

  await fetch(`${url}/v1/sessions/${sessionId}/end`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

// =============================================================================
// Navigation Helper
// =============================================================================

export async function navigateSession(
  sessionId: string,
  targetUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  const url = getBaseUrl();

  return fetch(`${url}/v1/sessions/${sessionId}/navigate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: targetUrl, frameId: "" }),
  });
}

/**
 * Gets the main frame ID from a CDP session
 */
export async function getMainFrameId(cdpUrl: string): Promise<string> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error("No browser contexts found");
    }
    const pages = contexts[0]!.pages();
    if (pages.length === 0) {
      throw new Error("No pages found");
    }
    const page = pages[0]!;

    // Use CDP to get the frame tree and extract the main frame ID
    const cdpSession = await page.context().newCDPSession(page);
    const { frameTree } = await cdpSession.send("Page.getFrameTree");
    await cdpSession.detach();

    return frameTree.frame.id;
  } finally {
    await browser.close();
  }
}

// =============================================================================
// SSE Stream Reader
// =============================================================================

// Legacy SSE event interface (generic)
export interface SSEEvent {
  event?: string;
  data?: string;
  parsed?: unknown;
}

export async function readSSEStream(response: Response): Promise<SSEEvent[]> {
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) {
    throw new Error("No response body reader available");
  }

  const decoder = new TextDecoder();
  let fullResponse = "";

  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    fullResponse += decoder.decode(result.value, { stream: true });
  }

  // Parse SSE events
  const events: SSEEvent[] = [];
  const rawEvents = fullResponse.split("\n\n").filter((e) => e.trim());

  for (const rawEvent of rawEvents) {
    const event: SSEEvent = {};
    const lines = rawEvent.split("\n");

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        event.data = line.slice(5).trim();
        try {
          event.parsed = JSON.parse(event.data);
        } catch {
          // Keep as string if not valid JSON
        }
      }
    }

    if (event.data || event.event) {
      events.push(event);
    }
  }

  return events;
}

// =============================================================================
// Typed SSE Event Helpers (for stagehand-api backend format)
// =============================================================================

// Actual SSE event format from backend (see stream.ts):
// { data: { status: "starting" | "connected" | "finished", result?: ... }, type: "system" | "log", id: "<uuid>" }
export interface TypedSSEEvent<TResult = unknown> {
  data: {
    status: string;
    result?: TResult;
    message?: string;
    error?: string;
  };
  type: string;
  id: string;
}

/**
 * Read SSE stream from response and return raw string
 */
export async function readSSEStreamRaw(response: Response): Promise<string> {
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) throw new Error("No response body reader");

  const decoder = new TextDecoder();
  let fullResponse = "";

  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    fullResponse += decoder.decode(result.value, { stream: true });
  }

  return fullResponse;
}

/**
 * Parse raw SSE response string into typed events
 */
export function parseTypedSSEEvents<TResult = unknown>(
  rawResponse: string,
): TypedSSEEvent<TResult>[] {
  const events = rawResponse.split("\n\n").filter((e) => e.trim());
  return events
    .map((event) => {
      const dataMatch = event.match(/data: (.+)/);
      if (dataMatch?.[1]) {
        return JSON.parse(dataMatch[1]) as TypedSSEEvent<TResult>;
      }
      return null;
    })
    .filter((e): e is TypedSSEEvent<TResult> => e !== null);
}

/**
 * Result of reading an SSE stream with full context for debugging
 */
export interface SSEStreamResult<TResult = unknown> {
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Raw response body */
  raw: string;
  /** Parsed SSE events */
  events: TypedSSEEvent<TResult>[];
  /** Get debug summary for error messages */
  debugSummary(): string;
}

/**
 * Read SSE stream and parse into typed events (legacy - no debug context)
 */
export async function readTypedSSEStream<TResult = unknown>(
  response: Response,
): Promise<TypedSSEEvent<TResult>[]> {
  const raw = await readSSEStreamRaw(response);
  return parseTypedSSEEvents<TResult>(raw);
}

/**
 * Read SSE stream with full context for debugging test failures.
 * Use this instead of readTypedSSEStream when you need better error messages.
 */
export async function readTypedSSEStreamWithContext<TResult = unknown>(
  response: Response,
): Promise<SSEStreamResult<TResult>> {
  const status = response.status;
  const statusText = response.statusText;
  const raw = await readSSEStreamRaw(response);
  const events = parseTypedSSEEvents<TResult>(raw);

  return {
    status,
    statusText,
    raw,
    events,
    debugSummary() {
      const eventStatuses = events.map((e) => e.data.status).join(" → ");
      const errorEvents = events.filter((e) => e.data.status === "error");
      const errorMessages = errorEvents
        .map((e) => e.data.error ?? "unknown error")
        .join(", ");

      let summary = `HTTP ${status} ${statusText}`;
      if (events.length === 0) {
        summary += `\n  No SSE events received`;
        summary += `\n  Raw response: ${raw.slice(0, 500)}${raw.length > 500 ? "..." : ""}`;
      } else {
        summary += `\n  Events (${events.length}): ${eventStatuses}`;
        if (errorMessages) {
          summary += `\n  Errors: ${errorMessages}`;
        }
      }
      return summary;
    },
  };
}

/**
 * Assert with debug context - includes SSE stream info on failure
 */
export function assertWithContext(
  condition: boolean,
  message: string,
  context: SSEStreamResult<unknown>,
): asserts condition {
  if (!condition) {
    throw new Error(`${message}\n\nDebug context:\n${context.debugSummary()}`);
  }
}

/**
 * Assert SSE event exists with debug context on failure, returns the found event
 */
export function assertEventExists<TResult>(
  events: TypedSSEEvent<TResult>[],
  status: string,
  context: SSEStreamResult<TResult>,
): TypedSSEEvent<TResult> {
  const found = events.find((e) => e.data.status === status);
  assertWithContext(
    found !== undefined,
    `Should have a "${status}" event`,
    context,
  );
  return found;
}

/**
 * Assert HTTP status with debug context on failure
 */
export function assertHttpStatus(
  context: SSEStreamResult<unknown>,
  expectedStatus: number,
  message?: string,
): void {
  assertWithContext(
    context.status === expectedStatus,
    message ?? `Expected HTTP ${expectedStatus}, got ${context.status}`,
    context,
  );
}

// =============================================================================
// JSON Response Debug Utilities (for non-SSE tests)
// =============================================================================

/**
 * Result of a fetch request with full context for debugging
 */
export interface FetchResult<T = unknown> {
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Parsed JSON body (if parseable) */
  body: T | null;
  /** Raw response text */
  raw: string;
  /** Request duration in ms */
  durationMs: number;
  /** Response headers */
  headers: Headers;
  /** Get debug summary for error messages */
  debugSummary(): string;
}

/**
 * Fetch with full context for debugging test failures.
 * Captures timing, status, and response body.
 */
export async function fetchWithContext<T = unknown>(
  url: string,
  options: RequestInit,
): Promise<FetchResult<T>> {
  const startTime = Date.now();
  let response: Response;

  try {
    response = await fetch(url, options);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      statusText: "FETCH_ERROR",
      body: null,
      raw: errorMsg,
      durationMs,
      headers: new Headers(),
      debugSummary() {
        return `Fetch failed after ${durationMs}ms: ${errorMsg}`;
      },
    };
  }

  const durationMs = Date.now() - startTime;
  const status = response.status;
  const statusText = response.statusText;
  const headers = response.headers;
  const raw = await response.text();

  let body: T | null = null;
  try {
    body = JSON.parse(raw) as T;
  } catch {
    // Keep body as null if not valid JSON
  }

  return {
    status,
    statusText,
    body,
    raw,
    durationMs,
    headers,
    debugSummary() {
      const seconds = (durationMs / 1000).toFixed(1);
      let summary = `HTTP ${status} ${statusText} (${seconds}s)`;

      if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (b.success === false && typeof b.message === "string") {
          summary += `\n  Error: ${b.message}`;
        }
        if (typeof b.error === "string") {
          summary += `\n  Error: ${b.error}`;
        }
      }

      // Show raw response if it's an error or unexpected
      if (status >= 400 || !body) {
        const truncated = raw.slice(0, 500);
        summary += `\n  Response: ${truncated}${raw.length > 500 ? "..." : ""}`;
      }

      return summary;
    },
  };
}

/**
 * Assert with fetch context - includes response info on failure
 */
export function assertFetchOk<T>(
  condition: boolean,
  message: string,
  context: FetchResult<T>,
): asserts condition {
  if (!condition) {
    throw new Error(`${message}\n\nDebug context:\n${context.debugSummary()}`);
  }
}

/**
 * Assert fetch succeeded with expected status
 */
export function assertFetchStatus<T>(
  context: FetchResult<T>,
  expectedStatus: number,
  message?: string,
): void {
  assertFetchOk(
    context.status === expectedStatus,
    message ?? `Expected HTTP ${expectedStatus}, got ${context.status}`,
    context,
  );
}

// =============================================================================
// Test Context Manager
// =============================================================================

export class TestSession {
  public sessionId: string | null = null;
  private headers: Record<string, string>;

  constructor(headers: Record<string, string>) {
    this.headers = headers;
  }

  async start(): Promise<string> {
    this.sessionId = await createSession(this.headers);
    return this.sessionId;
  }

  async navigate(targetUrl: string): Promise<Response> {
    if (!this.sessionId) {
      throw new Error("Session not started");
    }
    return navigateSession(this.sessionId, targetUrl, this.headers);
  }

  async end(): Promise<void> {
    if (this.sessionId) {
      try {
        await endSession(this.sessionId, this.headers);
      } catch {
        // Ignore errors when ending session
      }
      this.sessionId = null;
    }
  }

  getSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Session not started");
    }
    return this.sessionId;
  }
}
