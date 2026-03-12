/**
 * Browse CLI - Browser automation for AI agents
 *
 * Usage:
 *   browse [options] <command> [args...]
 *
 * The CLI runs a daemon process that maintains browser state between commands.
 * Multiple sessions can run simultaneously using --session <name> or BROWSE_SESSION env var.
 */

import { Command } from "commander";
import { Stagehand } from "@browserbasehq/stagehand";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { spawn } from "child_process";
import * as readline from "readline";
import { createRequire } from "module";

// Load version from package.json
const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

const program = new Command();

// Type aliases - using any for flexibility with Stagehand internals
type BrowseContext = Stagehand["context"];
type BrowsePage = ReturnType<BrowseContext["pages"]>[number];

// ==================== DAEMON INFRASTRUCTURE ====================

const SOCKET_DIR = os.tmpdir();

function getSocketPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.sock`);
}

function getLockPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.lock`);
}

/**
 * Acquire an exclusive lock for daemon operations.
 * Uses O_EXCL for atomic file creation to prevent race conditions.
 */
async function acquireLock(session: string, timeoutMs: number = 10000): Promise<boolean> {
  const lockPath = getLockPath(session);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // O_EXCL ensures atomic creation - fails if file exists
      const handle = await fs.open(lockPath, "wx");
      await handle.write(String(process.pid));
      await handle.close();
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        // Lock exists - check if holder is still alive
        try {
          const holderPid = parseInt(await fs.readFile(lockPath, "utf-8"));
          process.kill(holderPid, 0); // Throws if process doesn't exist
          // Process exists, wait and retry
          await new Promise(r => setTimeout(r, 100));
        } catch {
          // Lock holder is dead, remove stale lock
          try { await fs.unlink(lockPath); } catch {}
        }
        continue;
      }
      throw err;
    }
  }
  return false;
}

async function releaseLock(session: string): Promise<void> {
  try { await fs.unlink(getLockPath(session)); } catch {}
}

/**
 * Check if a socket is actually connectable (not just exists on disk).
 */
async function isSocketConnectable(socketPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, timeoutMs);

    client.on("connect", () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(true);
    });

    client.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Wait for socket to become connectable with exponential backoff.
 */
async function waitForSocketReady(socketPath: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  let delay = 50;

  while (Date.now() - startTime < timeoutMs) {
    if (await isSocketConnectable(socketPath, 500)) return;
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 500);
  }
  throw new Error(`Socket not ready after ${timeoutMs}ms`);
}

function getPidPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.pid`);
}

function getWsPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.ws`);
}

function getChromePidPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.chrome.pid`);
}

function getNetworkDir(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}-network`);
}

function getModePath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.mode`);
}

function getModeOverridePath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.mode-override`);
}

function getContextPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.context`);
}

type BrowseMode = "browserbase" | "local";

function hasBrowserbaseCredentials(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY);
}

function assertModeSupported(mode: BrowseMode): void {
  if (mode === "browserbase" && !hasBrowserbaseCredentials()) {
    throw new Error(
      "Remote mode requires BROWSERBASE_API_KEY. Set the env var or run `browse env local`.",
    );
  }
}

function toModeTarget(mode: BrowseMode): "local" | "remote" {
  return mode === "browserbase" ? "remote" : "local";
}

async function readCurrentMode(session: string): Promise<BrowseMode | null> {
  try {
    const mode = (await fs.readFile(getModePath(session), "utf-8")).trim();
    if (mode === "browserbase" || mode === "local") {
      return mode;
    }
  } catch {
    // File may not exist yet.
  }
  return null;
}

/** Determine desired mode: explicit override > env var detection */
async function getDesiredMode(session: string): Promise<BrowseMode> {
  try {
    const override = (await fs.readFile(getModeOverridePath(session), "utf-8")).trim();
    if (override === "browserbase" || override === "local") return override;
  } catch {}
  return hasBrowserbaseCredentials() ? "browserbase" : "local";
}

async function isDaemonRunning(session: string): Promise<boolean> {
  try {
    const pidFile = getPidPath(session);
    const pid = parseInt(await fs.readFile(pidFile, "utf-8"));
    process.kill(pid, 0); // Check if process exists

    // Also verify socket exists and is actually connectable
    const socketPath = getSocketPath(session);
    await fs.access(socketPath);

    // Verify socket is actually connectable (not just exists on disk)
    return await isSocketConnectable(socketPath, 500);
  } catch {
    return false;
  }
}

/** Daemon state files — cleaned on both startup (stale) and shutdown. */
const DAEMON_STATE_FILES = (session: string) => [
  getSocketPath(session),
  getPidPath(session),
  getWsPath(session),
  getChromePidPath(session),
  getLockPath(session),
  getModePath(session),
];

async function cleanupStaleFiles(session: string): Promise<void> {
  const files = [
    ...DAEMON_STATE_FILES(session),
    // Context is client-written config, only cleaned on full shutdown
    getContextPath(session),
  ];

  for (const file of files) {
    try { await fs.unlink(file); } catch {}
  }
}

/** Like cleanupStaleFiles but preserves client-written config (context). */
async function cleanupDaemonStateFiles(session: string): Promise<void> {
  for (const file of DAEMON_STATE_FILES(session)) {
    try { await fs.unlink(file); } catch {}
  }
}

/** Find and kill Chrome processes for this session */
async function killChromeProcesses(session: string): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    if (process.platform === "darwin" || process.platform === "linux") {
      // Find Chrome processes with our user data dir pattern
      const { stdout } = await execAsync(
        `pgrep -f "browse-${session}" || true`,
      );
      const pids = stdout.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), "SIGTERM");
        } catch {}
      }
      return pids.length > 0;
    }
    return false;
  } catch {
    return false;
  }
}

interface DaemonRequest {
  command: string;
  args: unknown[];
}

interface DaemonResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ==================== DAEMON SERVER ====================

// Default viewport matching Stagehand core
const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

async function runDaemon(session: string, headless: boolean): Promise<void> {
  // Only clean daemon state files (socket, pid, etc.), not client-written config (context)
  await cleanupDaemonStateFiles(session);

  // Write daemon PID file and initial mode so status is immediately available
  await fs.writeFile(getPidPath(session), String(process.pid));
  await fs.writeFile(getModePath(session), await getDesiredMode(session));

  // Browser state (initialized lazily on first command)
  let stagehand: Stagehand | null = null;
  let context: BrowseContext | null = null;
  let isInitializing = false;

  /**
   * Lazy browser initialization - called on first command (like agent-browser)
   * This allows daemon to signal "started" immediately without waiting for browser
   */
  async function ensureBrowserInitialized(): Promise<{ stagehand: Stagehand; context: BrowseContext }> {
    if (stagehand && context) {
      return { stagehand, context };
    }

    // Prevent concurrent initialization
    if (isInitializing) {
      // Wait for initialization to complete
      while (isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (stagehand && context) {
        return { stagehand, context };
      }
      throw new Error("Browser initialization failed");
    }

    isInitializing = true;

    try {
      const desiredMode = await getDesiredMode(session);
      assertModeSupported(desiredMode);
      const useBrowserbase = desiredMode === "browserbase";

      // Read context config if present (written by `browse open --context-id`)
      let contextConfig: { id: string; persist?: boolean } | null = null;
      try {
        const raw = await fs.readFile(getContextPath(session), "utf-8");
        contextConfig = JSON.parse(raw);
      } catch {}

      stagehand = new Stagehand({
        env: useBrowserbase ? "BROWSERBASE" : "LOCAL",
        verbose: 0,
        disablePino: true,
        ...(useBrowserbase
          ? {
              disableAPI: true,
              ...(contextConfig
                ? {
                    browserbaseSessionCreateParams: {
                      browserSettings: {
                        context: contextConfig,
                      },
                    },
                  }
                : {}),
            }
          : { localBrowserLaunchOptions: { headless, viewport: DEFAULT_VIEWPORT } }
        ),
      });

      // Persist mode so status command can report it
      await fs.writeFile(getModePath(session), desiredMode);

      await stagehand.init();

      context = stagehand.context;

      // Try to save Chrome info for reference (best effort)
      try {
        const wsUrl = (context as any).conn?.wsUrl || "unknown";
        await fs.writeFile(getWsPath(session), wsUrl);
      } catch {}

      // Store session name for network capture
      networkSession = session;

      // Setup network capture helpers (called when network is enabled)
      const setupNetworkCapture = async (targetPage: BrowsePage) => {
    const cdpSession = targetPage.mainFrame().session;

    // Track request start times for duration calculation
    const requestStartTimes = new Map<string, number>();
    const requestDirs = new Map<string, string>();

    cdpSession.on("Network.requestWillBeSent", async (params: any) => {
      if (!networkEnabled || !networkDir) return;

      const request: PendingRequest = {
        id: params.requestId,
        timestamp: new Date().toISOString(),
        method: params.request.method,
        url: params.request.url,
        headers: params.request.headers || {},
        body: params.request.postData || null,
        resourceType: params.type || "Other",
      };

      pendingRequests.set(params.requestId, request);
      requestStartTimes.set(params.requestId, Date.now());

      // Write request immediately
      const requestDir = await writeRequestToFs(request);
      if (requestDir) {
        requestDirs.set(params.requestId, requestDir);
      }
    });

    cdpSession.on("Network.responseReceived", async (params: any) => {
      if (!networkEnabled) return;

      const requestDir = requestDirs.get(params.requestId);
      if (!requestDir) return;

      // Store response info for when we get the body
      const startTime = requestStartTimes.get(params.requestId) || Date.now();
      const duration = Date.now() - startTime;

      // Response info without body (body comes later)
      const responseInfo = {
        id: params.requestId,
        status: params.response.status,
        statusText: params.response.statusText || "",
        headers: params.response.headers || {},
        mimeType: params.response.mimeType || "",
        body: null as string | null,
        duration,
      };

      // Store for body retrieval
      (params as any)._responseInfo = responseInfo;
      (params as any)._requestDir = requestDir;
    });

    cdpSession.on("Network.loadingFinished", async (params: any) => {
      if (!networkEnabled) return;

      const requestDir = requestDirs.get(params.requestId);
      const pending = pendingRequests.get(params.requestId);
      if (!requestDir || !pending) return;

      const startTime = requestStartTimes.get(params.requestId) || Date.now();
      const duration = Date.now() - startTime;

      let body: string | null = null;
      try {
        const result = await cdpSession.send("Network.getResponseBody", {
          requestId: params.requestId,
        });
        body = (result as any).body || null;
        if ((result as any).base64Encoded && body) {
          body = `[base64] ${body.slice(0, 100)}...`;
        }
      } catch {
        // Body not available (e.g., for redirects)
      }

      const responseData = {
        id: params.requestId,
        status: 0,
        statusText: "",
        headers: {} as Record<string, string>,
        mimeType: "",
        body,
        duration,
      };

      await writeResponseToFs(requestDir, responseData);

      // Cleanup
      pendingRequests.delete(params.requestId);
      requestStartTimes.delete(params.requestId);
      requestDirs.delete(params.requestId);
    });

    cdpSession.on("Network.loadingFailed", async (params: any) => {
      if (!networkEnabled) return;

      const requestDir = requestDirs.get(params.requestId);
      if (!requestDir) return;

      const startTime = requestStartTimes.get(params.requestId) || Date.now();
      const duration = Date.now() - startTime;

      const responseData = {
        id: params.requestId,
        status: 0,
        statusText: "Failed",
        headers: {},
        mimeType: "",
        body: null,
        duration,
        error: params.errorText || "Unknown error",
      };

      await writeResponseToFs(requestDir, responseData);

      // Cleanup
      pendingRequests.delete(params.requestId);
      requestStartTimes.delete(params.requestId);
      requestDirs.delete(params.requestId);
    });
      }; // Close setupNetworkCapture function

      // Store the setup function for use when network is enabled
      (context as any)._setupNetworkCapture = setupNetworkCapture;

      return { stagehand, context };
    } finally {
      isInitializing = false;
    }
  }

  // Create Unix socket server
  const socketPath = getSocketPath(session);
  const server = net.createServer((conn) => {
    const rl = readline.createInterface({ input: conn });

    rl.on("line", async (line) => {
      let response: DaemonResponse;
      try {
        const request: DaemonRequest = JSON.parse(line);

        // Lazy browser initialization on first command (like agent-browser)
        const { stagehand: sh, context: ctx } = await ensureBrowserInitialized();

        const result = await executeCommand(
          ctx,
          request.command,
          request.args,
          sh,
        );
        response = { success: true, result };
      } catch (e) {
        response = {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      conn.write(JSON.stringify(response) + "\n");
    });

    rl.on("close", () => {
      conn.destroy();
    });
  });

  server.listen(socketPath);

  // Signal daemon started immediately (before browser initialization)
  console.log(JSON.stringify({ daemon: "started", session, pid: process.pid }));

  // Graceful shutdown handler
  let shuttingDown = false;
  const shutdown = async (_signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.close();

    try {
      if (stagehand) {
        await stagehand.close();
      }
    } catch {}

    await cleanupStaleFiles(session);
    process.exit(0);
  };

  // Handle all termination signals
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown("unhandledRejection");
  });

  // Keep daemon running (signal already sent above)
}

// ==================== REF MAP (cached from last snapshot) ====================

/** Cached ref maps from the last snapshot - allows @ref syntax in commands */
let refMap: {
  xpathMap: Record<string, string>;
  cssMap: Record<string, string>;
  urlMap: Record<string, string>;
} = {
  xpathMap: {},
  cssMap: {},
  urlMap: {},
};

// ==================== NETWORK CAPTURE STATE ====================

interface PendingRequest {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  resourceType: string;
}

let networkEnabled = false;
let networkDir: string | null = null;
let networkCounter = 0;
let networkSession: string | null = null;
const pendingRequests = new Map<string, PendingRequest>();

/** Sanitize a string for use in a filename */
function sanitizeForFilename(str: string, maxLen: number = 30): string {
  return str
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

/** Generate a directory name for a request */
function getRequestDirName(
  counter: number,
  method: string,
  url: string,
): string {
  try {
    const parsed = new URL(url);
    const domain = sanitizeForFilename(parsed.hostname, 30);
    const pathPart = parsed.pathname.split("/").filter(Boolean)[0] || "root";
    const pathSlug = sanitizeForFilename(pathPart, 20);
    return `${String(counter).padStart(3, "0")}-${method}-${domain}-${pathSlug}`;
  } catch {
    return `${String(counter).padStart(3, "0")}-${method}-unknown`;
  }
}

/** Write request data to filesystem */
async function writeRequestToFs(
  request: PendingRequest,
): Promise<string | null> {
  if (!networkDir) return null;

  const dirName = getRequestDirName(
    networkCounter++,
    request.method,
    request.url,
  );
  const requestDir = path.join(networkDir, dirName);

  try {
    await fs.mkdir(requestDir, { recursive: true });

    const requestData = {
      id: request.id,
      timestamp: request.timestamp,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      resourceType: request.resourceType,
    };
    await fs.writeFile(
      path.join(requestDir, "request.json"),
      JSON.stringify(requestData, null, 2),
    );

    return requestDir;
  } catch (err) {
    console.error("Failed to write request:", err);
    return null;
  }
}

/** Write response data to filesystem */
async function writeResponseToFs(
  requestDir: string,
  response: {
    id: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    body: string | null;
    duration: number;
    error?: string;
  },
): Promise<void> {
  try {
    await fs.writeFile(
      path.join(requestDir, "response.json"),
      JSON.stringify(response, null, 2),
    );
  } catch (err) {
    console.error("Failed to write response:", err);
  }
}


/**
 * Parse a ref from a selector argument.
 * Supports: @0-3, @[0-3], [0-3], 0-3, ref=0-3
 */
function parseRef(selector: string): string | null {
  if (selector.startsWith("@")) {
    const rest = selector.slice(1);
    if (rest.startsWith("[") && rest.endsWith("]")) {
      return rest.slice(1, -1);
    }
    return rest;
  }
  if (
    selector.startsWith("[") &&
    selector.endsWith("]") &&
    /^\[\d+-\d+\]$/.test(selector)
  ) {
    return selector.slice(1, -1);
  }
  if (selector.startsWith("ref=")) {
    return selector.slice(4);
  }
  if (/^\d+-\d+$/.test(selector)) {
    return selector;
  }
  return null;
}

/**
 * Resolve a selector - if it's a ref, look up from refMap.
 * Always uses XPath since CSS selectors cannot cross shadow DOM boundaries
 * and can cause issues with dynamically generated class names.
 */
function resolveSelector(selector: string): string {
  const ref = parseRef(selector);
  if (ref) {
    const xpath = refMap.xpathMap[ref];
    if (!xpath) {
      throw new Error(
        `Unknown ref "${ref}" - run snapshot first to populate refs (have ${Object.keys(refMap.xpathMap).length} refs)`,
      );
    }
    return xpath;
  }
  return selector;
}

// ==================== COMMAND EXECUTION ====================

async function executeCommand(
  context: BrowseContext,
  command: string,
  args: unknown[],
  stagehand?: Stagehand,
): Promise<unknown> {
  // Use awaitActivePage() like stagehand.act() does - handles popups and waits for page to be ready
  const page = command !== "pages" && command !== "newpage"
    ? await context.awaitActivePage()
    : context.activePage();
  if (!page && command !== "pages" && command !== "newpage") {
    throw new Error("No active page");
  }

  switch (command) {
    // Navigation
    case "open": {
      const [url, waitUntil, timeout] = args as [string, string?, number?];
      await page!.goto(url, {
        waitUntil: waitUntil as "load" | "domcontentloaded" | "networkidle",
        timeout: timeout ?? 30000,
      });
      return { url: page!.url() };
    }
    case "reload": {
      await page!.reload();
      return { url: page!.url() };
    }
    case "back": {
      await page!.goBack();
      return { url: page!.url() };
    }
    case "forward": {
      await page!.goForward();
      return { url: page!.url() };
    }

    // Click by ref - uses stagehand.act with Action type (skips LLM, uses deterministic path)
    case "click": {
      const [selector] = args as [string];
      if (!stagehand) {
        throw new Error("Stagehand instance not available");
      }
      const resolved = resolveSelector(selector);

      // Construct an Action object (like observe() returns) to use the deterministic path
      const action = {
        selector: resolved,
        description: "click element",
        method: "click",
        arguments: [],
      };

      await stagehand.act(action);
      return { clicked: true };
    }

    // Click by coordinates
    case "click_xy": {
      const [x, y, opts] = args as [
        number,
        number,
        { button?: string; clickCount?: number; returnXPath?: boolean },
      ];
      const result = await page!.click(x, y, {
        button: (opts?.button as "left" | "right" | "middle") ?? "left",
        clickCount: opts?.clickCount ?? 1,
      });
      if (opts?.returnXPath) {
        return { clicked: true, xpath: result?.xpath };
      }
      return { clicked: true };
    }
    case "hover": {
      const [x, y, opts] = args as [number, number, { returnXPath?: boolean }];
      const result = await page!.hover(x, y);
      if (opts?.returnXPath) {
        return { hovered: true, xpath: result?.xpath };
      }
      return { hovered: true };
    }
    case "scroll": {
      const [x, y, deltaX, deltaY, opts] = args as [
        number,
        number,
        number,
        number,
        { returnXPath?: boolean },
      ];
      const result = await page!.scroll(x, y, deltaX, deltaY);
      if (opts?.returnXPath) {
        return { scrolled: true, xpath: result?.xpath };
      }
      return { scrolled: true };
    }
    case "drag": {
      const [fromX, fromY, toX, toY, opts] = args as [
        number,
        number,
        number,
        number,
        {
          steps?: number;
          delay?: number;
          button?: string;
          returnXPath?: boolean;
        },
      ];

      const [fromXpath, toXpath] = await page!.dragAndDrop(
        fromX,
        fromY,
        toX,
        toY,
        {
          button: (opts?.button as "left" | "right" | "middle") ?? "left",
          steps: opts?.steps ?? 10,
          delay: opts?.delay ?? 0,
          returnXpath: opts?.returnXPath,
        },
      );

      if (opts?.returnXPath) {
        return {
          dragged: true,
          xpath: fromXpath,
          fromXpath,
          toXpath,
        };
      }
      return { dragged: true };
    }
    // Keyboard
    case "type": {
      const [text, opts] = args as [
        string,
        { delay?: number; mistakes?: boolean },
      ];
      await page!.type(text, { delay: opts?.delay, humanize: opts?.mistakes });
      return { typed: true };
    }
    case "press": {
      const [key] = args as [string];
      await page!.keyPress(key);
      return { pressed: key };
    }

    // Element actions - use stagehand.act with Action type for reliable interaction
    case "fill": {
      const [selector, value, opts] = args as [
        string,
        string,
        { pressEnter?: boolean }?,
      ];
      if (!stagehand) {
        throw new Error("Stagehand instance not available");
      }
      const resolved = resolveSelector(selector);
      const action = {
        selector: resolved,
        description: "fill element",
        method: "fill",
        arguments: [value],
      };
      await stagehand.act(action);
      if (opts?.pressEnter) {
        await page!.keyPress("Enter");
      }
      return { filled: true, pressedEnter: opts?.pressEnter ?? false };
    }
    case "select": {
      const [selector, values] = args as [string, string[]];
      if (!stagehand) {
        throw new Error("Stagehand instance not available");
      }
      const resolved = resolveSelector(selector);
      // selectOption takes the first value as argument
      const action = {
        selector: resolved,
        description: "select option",
        method: "selectOption",
        arguments: [values[0] || ""],
      };
      await stagehand.act(action);
      return { selected: values };
    }
    case "highlight": {
      const [selector, duration] = args as [string, number?];
      await page!
        .deepLocator(resolveSelector(selector))
        .highlight({ durationMs: duration ?? 2000 });
      return { highlighted: true };
    }
    // Page info
    case "get": {
      const [what, selector] = args as [string, string?];
      switch (what) {
        case "url":
          return { url: page!.url() };
        case "title":
          return { title: await page!.title() };
        case "text":
          return {
            text: await page!
              .deepLocator(resolveSelector(selector!))
              .textContent(),
          };
        case "html":
          return {
            html: await page!
              .deepLocator(resolveSelector(selector!))
              .innerHtml(),
          };
        case "value":
          return {
            value: await page!
              .deepLocator(resolveSelector(selector!))
              .inputValue(),
          };
        case "box": {
          const { x, y } = await page!
            .deepLocator(resolveSelector(selector!))
            .centroid();
          return { x: Math.round(x), y: Math.round(y) };
        }
        case "visible":
          return {
            visible: await page!
              .deepLocator(resolveSelector(selector!))
              .isVisible(),
          };
        case "checked":
          return {
            checked: await page!
              .deepLocator(resolveSelector(selector!))
              .isChecked(),
          };
        default:
          throw new Error(`Unknown get type: ${what}`);
      }
    }

    // Screenshot
    case "screenshot": {
      const [opts] = args as [
        {
          path?: string;
          fullPage?: boolean;
          type?: string;
          quality?: number;
          clip?: object;
          animations?: string;
          caret?: string;
        },
      ];
      const buffer = await page!.screenshot({
        fullPage: opts?.fullPage,
        type: opts?.type as "png" | "jpeg" | undefined,
        quality: opts?.quality,
        clip: opts?.clip as
          | { x: number; y: number; width: number; height: number }
          | undefined,
        animations: opts?.animations as "disabled" | "allow" | undefined,
        caret: opts?.caret as "hide" | "initial" | undefined,
        timeout: 10000,
      });
      if (opts?.path) {
        await fs.writeFile(opts.path, buffer);
        return { saved: opts.path };
      }
      return { base64: buffer.toString("base64") };
    }

    // Snapshot
    case "snapshot": {
      const [compact] = args as [boolean?];
      const snapshot = await page!.snapshot();

      refMap = {
        xpathMap: snapshot.xpathMap ?? {},
        cssMap: snapshot.cssMap ?? {},
        urlMap: snapshot.urlMap ?? {},
      };

      if (compact) {
        return { tree: snapshot.formattedTree };
      }
      return {
        tree: snapshot.formattedTree,
        xpathMap: snapshot.xpathMap,
        urlMap: snapshot.urlMap,
        cssMap: snapshot.cssMap,
      };
    }

    // Viewport
    case "viewport": {
      const [width, height, scale] = args as [number, number, number?];
      await page!.setViewportSize(width, height, {
        deviceScaleFactor: scale ?? 1,
      });
      return { viewport: { width, height } };
    }

    // Eval
    case "eval": {
      const [expr] = args as [string];
      const result = await page!.evaluate(expr);
      return { result };
    }
    // Element state
    case "is": {
      const [check, selector] = args as [string, string];
      const locator = page!.deepLocator(resolveSelector(selector));
      switch (check) {
        case "visible":
          return { visible: await locator.isVisible() };
        case "checked":
          return { checked: await locator.isChecked() };
        default:
          throw new Error(`Unknown check: ${check}`);
      }
    }
    // Wait
    case "wait": {
      const [type, arg, opts] = args as [
        string,
        string?,
        { timeout?: number; state?: string }?,
      ];
      switch (type) {
        case "load":
          await page!.waitForLoadState(
            (arg as "load" | "domcontentloaded" | "networkidle") ?? "load",
            opts?.timeout ?? 30000,
          );
          break;
        case "selector":
          await page!.waitForSelector(resolveSelector(arg!), {
            state:
              (opts?.state as "attached" | "detached" | "visible" | "hidden") ??
              "visible",
            timeout: opts?.timeout ?? 30000,
          });
          break;
        case "timeout":
          await page!.waitForTimeout(parseInt(arg!));
          break;
        default:
          throw new Error(`Unknown wait type: ${type}`);
      }
      return { waited: true };
    }

    // Cursor
    case "cursor": {
      await page!.enableCursorOverlay();
      return { cursor: "enabled" };
    }

    // Multi-page
    case "pages": {
      const pages = context.pages();
      return {
        pages: pages.map((p: BrowsePage, i: number) => ({
          index: i,
          url: p.url(),
          targetId: p.targetId(),
        })),
      };
    }
    case "newpage": {
      const [url] = args as [string?];
      const newPage = await context.newPage(url);
      return {
        created: true,
        url: newPage.url(),
        targetId: newPage.targetId(),
      };
    }
    case "tab_switch": {
      const [index] = args as [number];
      const pages = context.pages();
      if (index < 0 || index >= pages.length) {
        throw new Error(
          `Tab index ${index} out of range (0-${pages.length - 1})`,
        );
      }
      context.setActivePage(pages[index]);
      return { switched: true, index, url: pages[index].url() };
    }
    case "tab_close": {
      const [index] = args as [number?];
      const pages = context.pages();
      const targetIndex = index ?? pages.length - 1;
      if (targetIndex < 0 || targetIndex >= pages.length) {
        throw new Error(
          `Tab index ${targetIndex} out of range (0-${pages.length - 1})`,
        );
      }
      if (pages.length === 1) {
        throw new Error("Cannot close the last tab");
      }
      await pages[targetIndex].close();
      return { closed: true, index: targetIndex };
    }

    // Debug: show current ref map
    case "refs": {
      return {
        count: Object.keys(refMap.xpathMap).length,
        xpathMap: refMap.xpathMap,
        cssMap: refMap.cssMap,
        urlMap: refMap.urlMap,
      };
    }

    // Network capture commands
    case "network_enable": {
      if (networkEnabled && networkDir) {
        return { enabled: true, path: networkDir, alreadyEnabled: true };
      }

      const session = networkSession || "default";
      networkDir = getNetworkDir(session);
      await fs.mkdir(networkDir, { recursive: true });
      networkCounter = 0;
      pendingRequests.clear();

      const cdpSession = page!.mainFrame().session;
      await cdpSession.send("Network.enable", {
        maxTotalBufferSize: 10000000,
        maxResourceBufferSize: 5000000,
      });

      const setupFn = (context as any)._setupNetworkCapture;
      if (setupFn) {
        await setupFn(page!);
      }

      networkEnabled = true;
      return { enabled: true, path: networkDir };
    }

    case "network_disable": {
      if (!networkEnabled) {
        return { enabled: false, alreadyDisabled: true };
      }

      try {
        const cdpSession = page!.mainFrame().session;
        await cdpSession.send("Network.disable");
      } catch {}

      networkEnabled = false;
      return { enabled: false, path: networkDir };
    }

    case "network_path": {
      if (!networkDir) {
        const session = networkSession || "default";
        return { path: getNetworkDir(session), enabled: false };
      }
      return { path: networkDir, enabled: networkEnabled };
    }

    case "network_clear": {
      if (!networkDir) {
        return { cleared: false, error: "Network capture not enabled" };
      }

      try {
        const entries = await fs.readdir(networkDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            await fs.rm(path.join(networkDir, entry.name), { recursive: true });
          }
        }
        networkCounter = 0;
        pendingRequests.clear();
        return { cleared: true, path: networkDir };
      } catch (err) {
        return {
          cleared: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Daemon control
    case "stop": {
      process.nextTick(() => {
        process.emit("SIGTERM");
      });
      return { stopping: true };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ==================== CLIENT ====================

async function sendCommandOnce(
  session: string,
  command: string,
  args: unknown[],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath(session);
    const client = net.createConnection(socketPath);
    let done = false;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Command timeout"));
    }, 60000);

    const cleanup = () => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        rl.close();
        client.destroy();
      }
    };

    const rl = readline.createInterface({ input: client });

    rl.on("line", (line) => {
      const response: DaemonResponse = JSON.parse(line);
      cleanup();
      if (response.success) {
        resolve(response.result);
      } else {
        reject(new Error(response.error));
      }
    });

    rl.on("error", () => {});

    client.on("connect", () => {
      const request: DaemonRequest = { command, args };
      client.write(JSON.stringify(request) + "\n");
    });

    client.on("error", (err) => {
      cleanup();
      reject(new Error(`Connection failed: ${err.message}`));
    });
  });
}

/** Send command with automatic retry and daemon restart on connection failure */
async function sendCommand(
  session: string,
  command: string,
  args: unknown[],
  headless: boolean = false,
): Promise<unknown> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendCommandOnce(session, command, args);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (command === "stop") {
        throw err;
      }

      const isConnectionError =
        errMsg.includes("ENOENT") ||
        errMsg.includes("ECONNREFUSED") ||
        errMsg.includes("Connection failed");

      if (!isConnectionError) {
        throw err;
      }

      // Attempt 0: Brief wait and retry (socket might be temporarily unavailable)
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // Attempt 1: Try to restart daemon without cleanup
      if (attempt === 1) {
        await ensureDaemon(session, headless);
        continue;
      }

      // Final attempt: Full cleanup and restart
      await killChromeProcesses(session);
      await cleanupStaleFiles(session);
      await ensureDaemon(session, headless);
    }
  }

  throw new Error(`Max retries exceeded for command ${command} on session ${session}`);
}

async function stopDaemonAndCleanup(session: string): Promise<void> {
  try {
    await sendCommandOnce(session, "stop", []);
  } catch {
    // Daemon may already be down.
  }
  await new Promise((r) => setTimeout(r, 500));
  await cleanupStaleFiles(session);
}

async function ensureDaemon(session: string, headless: boolean): Promise<void> {
  const wantMode = await getDesiredMode(session);
  assertModeSupported(wantMode);

  if (await isDaemonRunning(session)) {
    // Missing mode file means daemon predates mode support, which was local-only.
    const currentMode = (await readCurrentMode(session)) ?? "local";
    if (currentMode === wantMode) {
      return;
    }
    await stopDaemonAndCleanup(session);
  }

  // Acquire lock before spawning to prevent race conditions
  const locked = await acquireLock(session);
  if (!locked) {
    throw new Error(`Timeout acquiring lock for session ${session}`);
  }

  try {
    // Re-check after acquiring lock (another process may have started daemon)
    if (await isDaemonRunning(session)) {
      const currentMode = (await readCurrentMode(session)) ?? "local";
      if (currentMode === wantMode) {
        return;
      }
      await stopDaemonAndCleanup(session);
    }

    const args = ["--session", session, "daemon"];
    if (headless) args.push("--headless");

    const child = spawn(process.argv[0], [process.argv[1], ...args], {
      detached: true,
      // Avoid piping stdout for detached daemon startup. Deep-locator internals
      // can log via console fallback, and writing to a broken pipe crashes daemon.
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.unref();

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("exit", onExit);
        if (err) reject(err);
        else resolve();
      };

      const onError = (err: Error) => {
        finish(err);
      };

      const onExit = (code: number | null, signal: string | null) => {
        finish(
          new Error(
            `Daemon exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        );
      };

      const timeout = setTimeout(() => {
        finish(new Error("Timeout waiting for daemon to start"));
      }, 30000);

      child.once("error", onError);
      child.once("exit", onExit);

      // Readiness is determined by socket connectivity, not daemon stdout.
      waitForSocketReady(getSocketPath(session), 28000)
        .then(() => finish())
        .catch((err) =>
          finish(err instanceof Error ? err : new Error(String(err))),
        );
    });
  } finally {
    await releaseLock(session);
  }
}

// ==================== CLI INTERFACE ====================

interface GlobalOpts {
  ws?: string;
  headless?: boolean;
  headed?: boolean;
  json?: boolean;
  session?: string;
}

function getSession(opts: GlobalOpts): string {
  return opts.session ?? process.env.BROWSE_SESSION ?? "default";
}

function isHeadless(opts: GlobalOpts): boolean {
  return opts.headless === true && opts.headed !== true;
}

function output(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function runCommand(command: string, args: unknown[]): Promise<unknown> {
  const opts = program.opts<GlobalOpts>();
  const session = getSession(opts);
  const headless = isHeadless(opts);
  // If --ws provided, bypass daemon and connect directly
  if (opts.ws) {
    const stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      disablePino: true,
      localBrowserLaunchOptions: {
        cdpUrl: opts.ws,
      },
    });
    await stagehand.init();
    try {
      return await executeCommand(stagehand.context, command, args);
    } finally {
      await stagehand.close();
    }
  }

  await ensureDaemon(session, headless);
  return sendCommand(session, command, args, headless);
}

program
  .name("browse")
  .description("Browser automation CLI for AI agents")
  .version(VERSION)
  .option(
    "--ws <url>",
    "CDP WebSocket URL (bypasses daemon, direct connection)",
  )
  .option("--headless", "Run Chrome in headless mode")
  .option("--headed", "Run Chrome with visible window (default)")
  .option("--json", "Output as JSON", false)
  .option(
    "--session <name>",
    "Session name for multiple browsers (or use BROWSE_SESSION env var)",
  );

// ==================== DAEMON COMMANDS ====================

program
  .command("start")
  .description("Start browser daemon (auto-started by other commands)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const session = getSession(opts);
    if (await isDaemonRunning(session)) {
      console.log(JSON.stringify({ status: "already running", session }));
      return;
    }
    await ensureDaemon(session, isHeadless(opts));
    console.log(JSON.stringify({ status: "started", session }));
  });

program
  .command("stop")
  .description("Stop browser daemon")
  .option("--force", "Force kill Chrome processes if daemon is unresponsive")
  .action(async (cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    const session = getSession(opts);
    // Clear any explicit env override so next start uses env var detection
    try { await fs.unlink(getModeOverridePath(session)); } catch {}
    try {
      await sendCommand(session, "stop", []);
      console.log(JSON.stringify({ status: "stopped", session }));
    } catch {
      if (cmdOpts.force) {
        await killChromeProcesses(session);
        await cleanupStaleFiles(session);
        console.log(JSON.stringify({ status: "force stopped", session }));
      } else {
        console.log(JSON.stringify({ status: "not running", session }));
      }
    }
  });

program
  .command("status")
  .description("Check daemon status")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const session = getSession(opts);
    const running = await isDaemonRunning(session);
    let wsUrl = null;
    let mode: BrowseMode | null = null;
    if (running) {
      try {
        wsUrl = await fs.readFile(getWsPath(session), "utf-8");
      } catch {}
      mode = await readCurrentMode(session);
    }
    console.log(JSON.stringify({ running, session, wsUrl, mode }));
  });

program
  .command("env [target]")
  .description("Show or switch browser environment (local | remote)")
  .action(async (target?: string) => {
    const opts = program.opts<GlobalOpts>();
    const session = getSession(opts);

    if (!target) {
      let mode: string | null = null;
      const desiredMode = await getDesiredMode(session);
      if (await isDaemonRunning(session)) {
        mode = toModeTarget((await readCurrentMode(session)) ?? desiredMode);
      }
      console.log(JSON.stringify({
        mode: mode ?? "not running",
        desired: toModeTarget(desiredMode),
        session,
      }));
      return;
    }

    const modeMap: Record<string, BrowseMode> = {
      local: "local",
      remote: "browserbase",
    };
    const mapped = modeMap[target];
    if (!mapped) {
      console.error('Usage: browse env [local|remote]');
      process.exit(1);
    }

    try {
      assertModeSupported(mapped);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    await fs.writeFile(getModeOverridePath(session), mapped);

    if (await isDaemonRunning(session)) {
      const currentMode = (await readCurrentMode(session)) ?? "local";
      if (currentMode === mapped) {
        console.log(JSON.stringify({
          mode: toModeTarget(mapped),
          session,
          restarted: false,
        }));
        return;
      }
      await stopDaemonAndCleanup(session);
    }

    await ensureDaemon(session, isHeadless(opts));

    console.log(JSON.stringify({
      mode: toModeTarget(mapped),
      session,
      restarted: true,
    }));
  });

program
  .command("refs")
  .description("Show cached ref map from last snapshot")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("refs", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("daemon")
  .description("Run as daemon (internal use)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    await runDaemon(getSession(opts), isHeadless(opts));
  });

// ==================== NAVIGATION ====================

program
  .command("open <url>")
  .alias("goto")
  .description("Navigate to URL")
  .option(
    "--wait <state>",
    "Wait state: load, domcontentloaded, networkidle",
    "load",
  )
  .option("-t, --timeout <ms>", "Navigation timeout in milliseconds", "30000")
  .option("--context-id <id>", "Browserbase context ID to load browser state (remote mode only)")
  .option("--persist", "Persist context changes back after session ends (requires --context-id)", false)
  .action(async (url: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      // Validate context flags
      if (cmdOpts.persist && !cmdOpts.contextId) {
        console.error("Error: --persist requires --context-id");
        process.exit(1);
      }

      const session = getSession(opts);

      if (cmdOpts.contextId) {
        // Contexts only work with Browserbase remote sessions
        const desiredMode = await getDesiredMode(session);
        if (desiredMode === "local") {
          console.error("Error: --context-id is only supported in remote mode. Run `browse env remote` first.");
          process.exit(1);
        }

        const newConfig = JSON.stringify({ id: cmdOpts.contextId, persist: cmdOpts.persist ?? false });

        // If daemon is already running with a different context, restart it
        // (context is baked into the Browserbase session at creation time)
        if (await isDaemonRunning(session)) {
          let currentConfig: string | null = null;
          try {
            currentConfig = await fs.readFile(getContextPath(session), "utf-8");
          } catch {}
          if (currentConfig !== newConfig) {
            await stopDaemonAndCleanup(session);
          }
        }

        await fs.writeFile(getContextPath(session), newConfig);
      } else {
        // No --context-id: clear any stale context file so the daemon starts clean
        try { await fs.unlink(getContextPath(session)); } catch {}
      }

      const result = await runCommand("open", [
        url,
        cmdOpts.wait,
        parseInt(cmdOpts.timeout),
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("reload")
  .description("Reload current page")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("reload", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("back")
  .description("Go back in history")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("back", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("forward")
  .description("Go forward in history")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("forward", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== CLICK ACTIONS ====================

program
  .command("click <ref>")
  .description("Click element by ref (e.g., @0-5, 0-5, or CSS/XPath selector)")
  .option("-b, --button <btn>", "Mouse button: left, right, middle", "left")
  .option("-c, --count <n>", "Click count", "1")
  .option("-f, --force", "Force click even if element has no layout (uses synthetic event)")
  .action(async (ref: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("click", [
        ref,
        { button: cmdOpts.button, clickCount: parseInt(cmdOpts.count), force: cmdOpts.force },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("click_xy <x> <y>")
  .description("Click at exact coordinates")
  .option("-b, --button <btn>", "Mouse button: left, right, middle", "left")
  .option("-c, --count <n>", "Click count", "1")
  .option("--xpath", "Return XPath of clicked element")
  .action(async (x: string, y: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("click_xy", [
        parseFloat(x),
        parseFloat(y),
        {
          button: cmdOpts.button,
          clickCount: parseInt(cmdOpts.count),
          returnXPath: cmdOpts.xpath,
        },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== COORDINATE ACTIONS ====================

program
  .command("hover <x> <y>")
  .description("Hover at coordinates")
  .option("--xpath", "Return XPath of hovered element")
  .action(async (x: string, y: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("hover", [
        parseFloat(x),
        parseFloat(y),
        { returnXPath: cmdOpts.xpath },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("scroll <x> <y> <deltaX> <deltaY>")
  .description("Scroll at coordinates")
  .option("--xpath", "Return XPath of scrolled element")
  .action(async (x: string, y: string, dx: string, dy: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("scroll", [
        parseFloat(x),
        parseFloat(y),
        parseFloat(dx),
        parseFloat(dy),
        { returnXPath: cmdOpts.xpath },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("drag <fromX> <fromY> <toX> <toY>")
  .description("Drag from one point to another")
  .option("-b, --button <btn>", "Mouse button: left, right, middle", "left")
  .option("--steps <n>", "Number of intermediate drag steps", "10")
  .option("--delay <ms>", "Delay between drag steps in milliseconds", "0")
  .option("--xpath", "Return XPath of source and target elements")
  .action(async (fx: string, fy: string, tx: string, ty: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("drag", [
        parseFloat(fx),
        parseFloat(fy),
        parseFloat(tx),
        parseFloat(ty),
        {
          button: cmdOpts.button,
          steps: parseInt(cmdOpts.steps, 10),
          delay: parseInt(cmdOpts.delay, 10),
          returnXPath: cmdOpts.xpath,
        },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== KEYBOARD ====================

program
  .command("type <text>")
  .description("Type text")
  .option("-d, --delay <ms>", "Delay between keystrokes")
  .option("--mistakes", "Enable human-like typing with mistakes")
  .action(async (text: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("type", [
        text,
        {
          delay: cmdOpts.delay ? parseInt(cmdOpts.delay) : undefined,
          mistakes: cmdOpts.mistakes,
        },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("press <key>")
  .alias("key")
  .description("Press key (e.g., Enter, Tab, Escape, Cmd+A)")
  .action(async (key: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("press", [key]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== ELEMENT ACTIONS ====================

program
  .command("fill <selector> <value>")
  .description("Fill input element (presses Enter by default)")
  .option("--no-press-enter", "Don't press Enter after filling")
  .action(async (selector: string, value: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const pressEnter = cmdOpts.pressEnter !== false;
      const result = await runCommand("fill", [
        selector,
        value,
        { pressEnter },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("select <selector> <values...>")
  .description("Select option(s)")
  .action(async (selector: string, values: string[]) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("select", [selector, values]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("highlight <selector>")
  .description("Highlight element")
  .option("-d, --duration <ms>", "Duration", "2000")
  .action(async (selector: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("highlight", [
        selector,
        parseInt(cmdOpts.duration),
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== PAGE INFO ====================

program
  .command("get <what> [selector]")
  .description("Get page info: url, title, text, html, value, box, visible, checked")
  .action(async (what: string, selector?: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("get", [what, selector]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== SCREENSHOT ====================

program
  .command("screenshot [path]")
  .description("Take screenshot")
  .option("-f, --full-page", "Full page screenshot")
  .option("-t, --type <type>", "Image type: png, jpeg", "png")
  .option("-q, --quality <n>", "JPEG quality (0-100)")
  .option("--clip <json>", "Clip region as JSON")
  .option("--no-animations", "Disable animations")
  .option("--hide-caret", "Hide text caret")
  .action(async (filePath: string | undefined, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("screenshot", [
        {
          path: filePath,
          fullPage: cmdOpts.fullPage,
          type: cmdOpts.type,
          quality: cmdOpts.quality ? parseInt(cmdOpts.quality) : undefined,
          clip: cmdOpts.clip ? JSON.parse(cmdOpts.clip) : undefined,
          animations: cmdOpts.animations === false ? "disabled" : "allow",
          caret: cmdOpts.hideCaret ? "hide" : "initial",
        },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== SNAPSHOT ====================

program
  .command("snapshot")
  .description("Get accessibility tree snapshot")
  .option("-c, --compact", "Output tree only (no xpath map)")
  .action(async (cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = (await runCommand("snapshot", [cmdOpts.compact])) as {
        tree: string;
        xpathMap?: Record<string, string>;
        urlMap?: Record<string, string>;
        cssMap?: Record<string, string>;
      };
      if (cmdOpts.compact && !opts.json) {
        console.log(result.tree);
      } else {
        output(result, opts.json ?? false);
      }
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== VIEWPORT ====================

program
  .command("viewport <width> <height>")
  .description("Set viewport size")
  .option("-s, --scale <n>", "Device scale factor", "1")
  .action(async (w: string, h: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("viewport", [
        parseInt(w),
        parseInt(h),
        parseFloat(cmdOpts.scale),
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== EVAL ====================

program
  .command("eval <expression>")
  .description("Evaluate JavaScript in page")
  .action(async (expr: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("eval", [expr]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== WAIT ====================

program
  .command("wait <type> [arg]")
  .description("Wait for: load, selector, timeout")
  .option("-t, --timeout <ms>", "Timeout", "30000")
  .option(
    "-s, --state <state>",
    "Element state: visible, hidden, attached, detached",
    "visible",
  )
  .action(async (type: string, arg: string | undefined, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("wait", [
        type,
        arg,
        { timeout: parseInt(cmdOpts.timeout), state: cmdOpts.state },
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== ELEMENT STATE CHECKS ====================

program
  .command("is <check> <selector>")
  .description("Check element state: visible, checked")
  .action(async (check: string, selector: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("is", [check, selector]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== CURSOR ====================

program
  .command("cursor")
  .description("Enable visual cursor overlay")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("cursor", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== MULTI-PAGE ====================

program
  .command("pages")
  .description("List all open pages")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("pages", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("newpage [url]")
  .description("Create a new page/tab")
  .action(async (url?: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("newpage", [url]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("tab_switch <index>")
  .alias("switch")
  .description("Switch to tab by index")
  .action(async (index: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("tab_switch", [parseInt(index)]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command("tab_close [index]")
  .alias("close")
  .description("Close tab by index (defaults to last tab)")
  .action(async (index?: string) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("tab_close", [
        index ? parseInt(index) : undefined,
      ]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== NETWORK CAPTURE ====================

const networkCmd = program
  .command("network")
  .description(
    "Network capture commands (writes to filesystem for agent inspection)",
  );

networkCmd
  .command("on")
  .description("Enable network capture (creates temp directory for requests)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("network_enable", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

networkCmd
  .command("off")
  .description("Disable network capture")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("network_disable", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

networkCmd
  .command("path")
  .description("Get network capture directory path")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("network_path", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

networkCmd
  .command("clear")
  .description("Clear all captured requests")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("network_clear", []);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== RUN ====================

program.parse();
