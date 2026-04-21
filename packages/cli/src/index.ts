/**
 * Browse CLI - Browser automation for AI agents
 *
 * Usage:
 *   browse [options] <command> [args...]
 *
 * The CLI runs a daemon process that maintains browser state between commands.
 * Multiple sessions can run simultaneously using --session <name> or BROWSE_SESSION env var.
 */

import { Command, Option } from "commander";
import { Stagehand, type Page as BrowsePage } from "@browserbasehq/stagehand";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { spawn } from "child_process";
import * as readline from "readline";
import type { Protocol } from "devtools-protocol";
import WebSocket from "ws";
import { version as VERSION } from "../package.json";
import {
  DEFAULT_LOCAL_CONFIG,
  getLocalModeHint,
  type LocalBrowserLaunchOptions,
  type LocalCdpDiscovery,
  type LocalConfig,
  type LocalInfo,
  resolveLocalStrategy,
} from "./local-strategy";
import { resolveWsTarget } from "./resolve-ws";
import { NodeHtmlMarkdown } from "node-html-markdown";

const program = new Command();

// Type aliases
type BrowseContext = Stagehand["context"];

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
async function acquireLock(
  session: string,
  timeoutMs: number = 10000,
): Promise<boolean> {
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
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          // Lock holder is dead, remove stale lock
          try {
            await fs.unlink(lockPath);
          } catch {}
        }
        continue;
      }
      throw err;
    }
  }
  return false;
}

async function releaseLock(session: string): Promise<void> {
  try {
    await fs.unlink(getLockPath(session));
  } catch {}
}

/**
 * Check if a socket is actually connectable (not just exists on disk).
 */
async function isSocketConnectable(
  socketPath: string,
  timeoutMs: number,
): Promise<boolean> {
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
async function waitForSocketReady(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const startTime = Date.now();
  let delay = 50;

  while (Date.now() - startTime < timeoutMs) {
    if (await isSocketConnectable(socketPath, 500)) return;
    await new Promise((r) => setTimeout(r, delay));
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

function getConnectPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.connect`);
}

function getLocalConfigPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.local-config`);
}

function getLocalInfoPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.local-info`);
}

function getSessionParamsPath(session: string): string {
  return path.join(SOCKET_DIR, `browse-${session}.session-params`);
}

// ==================== LOCAL STRATEGY CONFIG ====================

async function readLocalConfig(session: string): Promise<LocalConfig> {
  try {
    const raw = await fs.readFile(getLocalConfigPath(session), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LOCAL_CONFIG };
  }
}

async function writeLocalConfig(
  session: string,
  config: LocalConfig,
): Promise<void> {
  await fs.writeFile(getLocalConfigPath(session), JSON.stringify(config));
}

async function writeLocalInfo(session: string, info: LocalInfo): Promise<void> {
  await fs.writeFile(getLocalInfoPath(session), JSON.stringify(info));
}

async function readLocalInfo(session: string): Promise<LocalInfo | null> {
  try {
    const raw = await fs.readFile(getLocalInfoPath(session), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function waitForLocalInfo(
  session: string,
  timeoutMs: number = 1500,
): Promise<LocalInfo | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const localInfo = await readLocalInfo(session);
    if (localInfo) {
      return localInfo;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return readLocalInfo(session);
}

function logLocalModeHint(
  localConfig: LocalConfig,
  localInfo?: LocalInfo | null,
): void {
  const hint = getLocalModeHint(localConfig, localInfo);
  if (hint) {
    console.error(hint);
  }
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
    const override = (
      await fs.readFile(getModeOverridePath(session), "utf-8")
    ).trim();
    if (override === "browserbase" || override === "local") return override;
  } catch {}
  return hasBrowserbaseCredentials() ? "browserbase" : "local";
}

// ==================== CDP AUTO-DISCOVERY ====================

/**
 * Well-known Chrome user-data directories per platform.
 * Each may contain a DevToolsActivePort file when Chrome is running with
 * remote debugging enabled.
 */
function getChromeUserDataDirs(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  if (process.platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    for (const name of [
      "Google/Chrome",
      "Google/Chrome Canary",
      "Chromium",
      "BraveSoftware/Brave-Browser",
    ]) {
      dirs.push(path.join(base, name));
    }
  } else if (process.platform === "linux") {
    const config = path.join(home, ".config");
    for (const name of [
      "google-chrome",
      "google-chrome-unstable",
      "chromium",
      "BraveSoftware/Brave-Browser",
    ]) {
      dirs.push(path.join(config, name));
    }
  }

  return dirs;
}

/**
 * Read DevToolsActivePort file from a Chrome user-data directory.
 * Returns { port, wsPath } or null if file doesn't exist or is malformed.
 */
async function readDevToolsActivePort(
  userDataDir: string,
): Promise<{ port: number; wsPath: string } | null> {
  try {
    const content = await fs.readFile(
      path.join(userDataDir, "DevToolsActivePort"),
      "utf-8",
    );
    const lines = content.trim().split("\n");
    const port = parseInt(lines[0]?.trim(), 10);
    if (isNaN(port) || port <= 0 || port > 65535) return null;
    const wsPath = lines[1]?.trim() || "/devtools/browser";
    return { port, wsPath };
  } catch {
    return null;
  }
}

/**
 * Check if a TCP port is reachable on localhost with a short timeout.
 */
function isPortReachable(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Probe a CDP endpoint at the given port.
 * Tries /json/version first, then falls back to a direct WebSocket handshake
 * (needed for Chrome 136+ with UI-based remote debugging).
 * Returns the webSocketDebuggerUrl on success, or null.
 */
async function probeCdpEndpoint(port: number): Promise<string | null> {
  // Try /json/version (standard path)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (json.webSocketDebuggerUrl) {
        return json.webSocketDebuggerUrl;
      }
    }
  } catch {
    // /json/version unavailable
  }

  // Fallback: direct WebSocket at /devtools/browser
  // Chrome 136+ with chrome://inspect may only expose WS, not HTTP endpoints
  const wsUrl = `ws://127.0.0.1:${port}/devtools/browser`;
  try {
    const verified = await verifyCdpWebSocket(wsUrl);
    if (verified) return wsUrl;
  } catch {
    // WS fallback also failed
  }

  return null;
}

/**
 * Verify a WebSocket URL is a valid CDP endpoint by attempting an HTTP upgrade.
 * Sends a minimal WebSocket handshake and checks for a 101 Switching Protocols response.
 */
function verifyCdpWebSocket(wsUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(wsUrl);
    const port = parseInt(url.port) || 80;
    const wsKey = Buffer.from(
      Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
    ).toString("base64");

    const sock = net.createConnection({ host: url.hostname, port });
    let response = "";

    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 2000);

    sock.on("connect", () => {
      // Send a WebSocket upgrade request
      sock.write(
        `GET ${url.pathname} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `\r\n`,
      );
    });

    sock.on("data", (data) => {
      response += data.toString();
      // Check for successful WebSocket upgrade (101 Switching Protocols)
      if (/^HTTP\/1\.[01] 101(?:\s|$)/.test(response)) {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      } else if (response.includes("\r\n\r\n")) {
        // Got a complete HTTP response that isn't 101
        clearTimeout(timer);
        sock.destroy();
        resolve(false);
      }
    });

    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

interface CdpCandidate {
  wsUrl: string;
  source: string; // e.g. "DevToolsActivePort (Google Chrome)" or "port 9222"
}

/**
 * Discover locally-running Chrome instances with CDP debugging enabled.
 * Returns the discovered CDP WebSocket URL, or null with a reason.
 *
 * Discovery order:
 * 1. DevToolsActivePort files in well-known Chrome user-data dirs
 * 2. Common debugging ports (9222, 9229)
 *
 * If multiple healthy candidates are found, returns null (ambiguity).
 */
async function discoverLocalCdp(): Promise<LocalCdpDiscovery | null> {
  const candidates: CdpCandidate[] = [];

  // Phase 1: Scan DevToolsActivePort files
  const userDataDirs = getChromeUserDataDirs();
  for (const dir of userDataDirs) {
    const info = await readDevToolsActivePort(dir);
    if (!info) continue;

    // Verify port is alive
    if (!(await isPortReachable(info.port))) {
      // Stale file — clean up
      try {
        await fs.unlink(path.join(dir, "DevToolsActivePort"));
      } catch {}
      continue;
    }

    const wsUrl = await probeCdpEndpoint(info.port);
    if (wsUrl) {
      const name = path.basename(dir);
      candidates.push({ wsUrl, source: `DevToolsActivePort (${name})` });
    }
  }

  // Phase 2: Probe common ports (only if DevToolsActivePort yielded nothing)
  if (candidates.length === 0) {
    for (const port of [9222, 9229]) {
      if (!(await isPortReachable(port))) continue;
      const wsUrl = await probeCdpEndpoint(port);
      if (wsUrl) {
        candidates.push({ wsUrl, source: `port ${port}` });
      }
    }
  }

  // Ambiguity check
  if (candidates.length > 1) {
    return null; // Caller should fall back to isolated and report ambiguity
  }

  return candidates[0] ?? null;
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
  getLocalInfoPath(session),
];

async function cleanupStaleFiles(session: string): Promise<void> {
  const files = [
    ...DAEMON_STATE_FILES(session),
    // Client-written config, only cleaned on full shutdown
    getContextPath(session),
    getConnectPath(session),
    getLocalConfigPath(session),
    getSessionParamsPath(session),
  ];

  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch {}
  }
}

/** Like cleanupStaleFiles but preserves client-written config (context). */
async function cleanupDaemonStateFiles(session: string): Promise<void> {
  for (const file of DAEMON_STATE_FILES(session)) {
    try {
      await fs.unlink(file);
    } catch {}
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
  async function ensureBrowserInitialized(): Promise<{
    stagehand: Stagehand;
    context: BrowseContext;
  }> {
    if (stagehand && context) {
      return { stagehand, context };
    }

    // Prevent concurrent initialization
    if (isInitializing) {
      // Wait for initialization to complete
      while (isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
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

      // Read connect config if present (written by `browse --connect <id>`)
      let connectSessionId: string | null = null;
      try {
        connectSessionId = (
          await fs.readFile(getConnectPath(session), "utf-8")
        ).trim();
      } catch {}

      // Read session params if present (written by --proxies, --advanced-stealth, etc.)
      let sessionParams: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(getSessionParamsPath(session), "utf-8");
        sessionParams = JSON.parse(raw);
      } catch {
        // No session params file
      }

      // Resolve local browser launch options based on strategy
      let localLaunchOptions: LocalBrowserLaunchOptions | undefined;
      let localInfo: LocalInfo | undefined;

      if (!useBrowserbase) {
        const resolvedLocalStrategy = await resolveLocalStrategy({
          localConfig: await readLocalConfig(session),
          headless,
          defaultViewport: DEFAULT_VIEWPORT,
          discoverLocalCdp,
          resolveWsTarget,
        });
        localLaunchOptions = resolvedLocalStrategy.localLaunchOptions;
        localInfo = resolvedLocalStrategy.localInfo;
      }

      stagehand = new Stagehand({
        env: useBrowserbase ? "BROWSERBASE" : "LOCAL",
        verbose: 0,
        disablePino: true,
        ...(useBrowserbase
          ? {
              disableAPI: true,
              ...(connectSessionId
                ? {
                    browserbaseSessionID: connectSessionId,
                    keepAlive: true,
                  }
                : {}),
              ...(!connectSessionId
                ? {
                    browserbaseSessionCreateParams: (() => {
                      const sessionBrowserSettings =
                        (sessionParams.browserSettings as Record<
                          string,
                          unknown
                        >) || {};
                      const { browserSettings: _, ...sessionParamsWithoutBS } =
                        sessionParams;
                      void _;
                      return {
                        userMetadata: { browse_cli: "true" },
                        ...sessionParamsWithoutBS,
                        browserSettings: {
                          ...sessionBrowserSettings,
                          ...(contextConfig ? { context: contextConfig } : {}),
                        },
                      };
                    })(),
                  }
                : {}),
            }
          : {
              localBrowserLaunchOptions: localLaunchOptions,
            }),
      });

      // Persist mode and local info so status command can report it
      await fs.writeFile(getModePath(session), desiredMode);
      if (localInfo) {
        await writeLocalInfo(session, localInfo);
      }

      await stagehand.init();

      context = stagehand.context;

      // Clear cached state when the browser connection dies so the next
      // command triggers a full re-initialization instead of reusing a
      // dead Stagehand/context pair (fixes "awaitActivePage: no page
      // available" when a stale daemon outlives its browser).
      context.conn.onTransportClosed(() => {
        stagehand = null;
        context = null;
      });

      // Try to save Chrome info for reference (best effort)
      try {
        const wsUrl = stagehand.connectURL();
        await fs.writeFile(getWsPath(session), wsUrl);
      } catch {}

      // Store session name for network capture
      networkSession = session;

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
        const { stagehand: sh, context: ctx } =
          await ensureBrowserInitialized();

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
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.close();

    try {
      if (stagehand) {
        await stagehand.close();
      }
    } catch {}

    // Only clean daemon state, not client-written config (local-config, context, mode-override)
    await cleanupDaemonStateFiles(session);
    process.exit(0);
  };

  // Handle all termination signals
  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());
  process.on("SIGHUP", () => shutdown());
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown();
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown();
  });

  // Keep daemon running (signal already sent above)
}

// ==================== REF MAP (cached from last snapshot) ====================

/** Cached ref maps from the last snapshot - allows @ref syntax in commands */
let refMap: {
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
} = {
  xpathMap: {},
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
    /^\[\d+-\d+]$/.test(selector)
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
  const page =
    command !== "pages" && command !== "newpage"
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
        timeoutMs: timeout ?? 30000,
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
        return { clicked: true, xpath: result };
      }
      return { clicked: true };
    }
    case "hover": {
      const [x, y, opts] = args as [number, number, { returnXPath?: boolean }];
      const result = await page!.hover(x, y);
      if (opts?.returnXPath) {
        return { hovered: true, xpath: result };
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
        return { scrolled: true, xpath: result };
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
      await page!.type(text, {
        delay: opts?.delay,
        withMistakes: opts?.mistakes,
      });
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
    case "upload": {
      const [selector, filePaths] = args as [string, string[]];
      const resolved = resolveSelector(selector);
      const files = filePaths.length === 1 ? filePaths[0] : filePaths;
      await page!.deepLocator(resolved).setInputFiles(files);
      return { uploaded: true, files: filePaths };
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
        case "markdown": {
          const target = selector ? resolveSelector(selector) : "body";
          const html = await page!.deepLocator(target).innerHtml();
          return { markdown: NodeHtmlMarkdown.translate(html) };
        }
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
        urlMap: snapshot.urlMap ?? {},
      };

      if (compact) {
        return { tree: snapshot.formattedTree };
      }
      return {
        tree: snapshot.formattedTree,
        xpathMap: snapshot.xpathMap,
        urlMap: snapshot.urlMap,
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

      // Set up CDP event listeners for network capture
      const requestStartTimes = new Map<string, number>();
      const requestDirs = new Map<string, string>();

      cdpSession.on(
        "Network.requestWillBeSent",
        async (params: Protocol.Network.RequestWillBeSentEvent) => {
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

          const requestDir = await writeRequestToFs(request);
          if (requestDir) {
            requestDirs.set(params.requestId, requestDir);
          }
        },
      );

      cdpSession.on(
        "Network.loadingFinished",
        async (params: Protocol.Network.LoadingFinishedEvent) => {
          if (!networkEnabled) return;

          const requestDir = requestDirs.get(params.requestId);
          const pending = pendingRequests.get(params.requestId);
          if (!requestDir || !pending) return;

          const startTime =
            requestStartTimes.get(params.requestId) || Date.now();
          const duration = Date.now() - startTime;

          let body: string | null = null;
          try {
            const result =
              await cdpSession.send<Protocol.Network.GetResponseBodyResponse>(
                "Network.getResponseBody",
                {
                  requestId: params.requestId,
                },
              );
            body = result.body || null;
            if (result.base64Encoded && body) {
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

          pendingRequests.delete(params.requestId);
          requestStartTimes.delete(params.requestId);
          requestDirs.delete(params.requestId);
        },
      );

      cdpSession.on(
        "Network.loadingFailed",
        async (params: Protocol.Network.LoadingFailedEvent) => {
          if (!networkEnabled) return;

          const requestDir = requestDirs.get(params.requestId);
          if (!requestDir) return;

          const startTime =
            requestStartTimes.get(params.requestId) || Date.now();
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

          pendingRequests.delete(params.requestId);
          requestStartTimes.delete(params.requestId);
          requestDirs.delete(params.requestId);
        },
      );

      networkEnabled = true;
      return { enabled: true, path: networkDir };
    }

    case "network_disable": {
      if (!networkEnabled) {
        return { enabled: false, alreadyDisabled: true };
      }

      try {
        await page!.mainFrame().session.send("Network.disable");
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
        await new Promise((r) => setTimeout(r, 200));
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

  throw new Error(
    `Max retries exceeded for command ${command} on session ${session}`,
  );
}

async function stopDaemonAndCleanup(session: string): Promise<void> {
  try {
    await sendCommandOnce(session, "stop", []);
  } catch {
    // Daemon may already be down.
  }
  await new Promise((r) => setTimeout(r, 500));
  // Only clean daemon state files, not client-written config (local-config, context, mode-override)
  await cleanupDaemonStateFiles(session);
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
  connect?: string;
  // Session creation flags (remote only)
  proxies?: boolean;
  advancedStealth?: boolean;
  solveCaptchas?: boolean;
  region?: string;
  keepAlive?: boolean;
  sessionTimeout?: number;
  blockAds?: boolean;
}

function getSession(opts: GlobalOpts): string {
  return opts.session ?? process.env.BROWSE_SESSION ?? "default";
}

function isHeadless(opts: GlobalOpts): boolean {
  return opts.headless === true && opts.headed !== true;
}

function buildSessionParamsFromOpts(
  opts: GlobalOpts,
): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};
  const browserSettings: Record<string, unknown> = {};

  if (opts.proxies) params.proxies = true;
  if (opts.region) params.region = opts.region;
  if (opts.keepAlive) params.keepAlive = true;
  if (opts.sessionTimeout !== undefined) params.timeout = opts.sessionTimeout;

  if (opts.advancedStealth) browserSettings.advancedStealth = true;
  if (opts.blockAds) browserSettings.blockAds = true;
  if (opts.solveCaptchas !== undefined) {
    browserSettings.solveCaptchas = opts.solveCaptchas;
  }

  if (Object.keys(browserSettings).length > 0) {
    params.browserSettings = browserSettings;
  }

  if (Object.keys(params).length === 0) return null;
  return params;
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
    const cdpUrl = await resolveWsTarget(opts.ws);
    const stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      disablePino: true,
      localBrowserLaunchOptions: {
        cdpUrl,
      },
    });
    await stagehand.init();
    try {
      return await executeCommand(stagehand.context, command, args);
    } finally {
      await stagehand.close();
    }
  }

  // Handle --connect flag: write session ID for daemon to read
  if (opts.connect) {
    const desiredMode = await getDesiredMode(session);
    if (desiredMode === "local") {
      throw new Error(
        "--connect is only supported in remote mode. Run `browse env remote` first.",
      );
    }

    if (await isDaemonRunning(session)) {
      let currentConnect: string | null = null;
      try {
        currentConnect = (
          await fs.readFile(getConnectPath(session), "utf-8")
        ).trim();
      } catch {}
      if (currentConnect !== opts.connect) {
        await stopDaemonAndCleanup(session);
      }
    }

    await fs.writeFile(getConnectPath(session), opts.connect);
  } else {
    try {
      await fs.unlink(getConnectPath(session));
    } catch {}
  }

  // Handle session params flags (--proxies, --advanced-stealth, etc.)
  const sessionParams = buildSessionParamsFromOpts(opts);
  if (sessionParams) {
    const desiredMode = await getDesiredMode(session);
    if (desiredMode !== "browserbase") {
      console.error(
        JSON.stringify({
          error:
            "Session flags (--proxies, --advanced-stealth, etc.) are only supported in remote mode. Run 'browse env remote' first.",
        }),
      );
      process.exit(1);
    }

    const paramsPath = getSessionParamsPath(session);
    const newParamsJson = JSON.stringify(sessionParams);

    let currentParamsJson = "";
    try {
      currentParamsJson = await fs.readFile(paramsPath, "utf-8");
    } catch {}

    await fs.writeFile(paramsPath, newParamsJson);

    if (
      currentParamsJson !== newParamsJson &&
      (await isDaemonRunning(session))
    ) {
      await stopDaemonAndCleanup(session);
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
    "--ws <url|port>",
    "CDP WebSocket URL or port number (bypasses daemon, direct connection)",
  )
  .option("--headless", "Run Chrome in headless mode")
  .option("--headed", "Run Chrome with visible window (default)")
  .option("--json", "Output as JSON", false)
  .option(
    "--session <name>",
    "Session name for multiple browsers (or use BROWSE_SESSION env var)",
  )
  .option(
    "--connect <session-id>",
    "Connect to an existing Browserbase session by ID",
  )
  .option("--proxies", "Enable Browserbase proxy (remote only)")
  .option("--advanced-stealth", "Enable advanced stealth mode (remote only)")
  .option("--solve-captchas", "Enable automatic CAPTCHA solving (remote only)")
  .option(
    "--no-solve-captchas",
    "Disable automatic CAPTCHA solving (remote only)",
  )
  .option("--block-ads", "Enable ad blocking (remote only)")
  .option(
    "--region <region>",
    "Session region: us-west-2, us-east-1, eu-central-1, ap-southeast-1 (remote only)",
  )
  .option(
    "--keep-alive",
    "Keep session alive after disconnection (remote only)",
  )
  .option(
    "--session-timeout <seconds>",
    "Session timeout in seconds (remote only)",
    parseInt,
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
    try {
      await fs.unlink(getModeOverridePath(session));
    } catch {}
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
    let browserbaseSessionId: string | null = null;
    let localDetails: Record<string, unknown> = {};
    if (running) {
      try {
        wsUrl = await fs.readFile(getWsPath(session), "utf-8");
      } catch {}
      mode = await readCurrentMode(session);
      try {
        browserbaseSessionId = (
          await fs.readFile(getConnectPath(session), "utf-8")
        ).trim();
      } catch {}
      if (mode === "local") {
        const localConfig = await readLocalConfig(session);
        const localInfo =
          (await readLocalInfo(session)) ?? (await waitForLocalInfo(session));
        logLocalModeHint(localConfig, localInfo);
        localDetails = {
          localStrategy: localConfig.strategy,
          ...(localInfo ?? {}),
        };
      }
    }
    let sessionParams: Record<string, unknown> | null = null;
    try {
      const raw = await fs.readFile(getSessionParamsPath(session), "utf-8");
      sessionParams = JSON.parse(raw);
    } catch {}
    console.log(
      JSON.stringify({
        running,
        session,
        wsUrl,
        mode,
        browserbaseSessionId,
        ...localDetails,
        ...(sessionParams ? { sessionParams } : {}),
      }),
    );
  });

const envUsage =
  "Usage: browse env [local|remote]\n" +
  "  browse env local [--auto-connect|<port|url>]";

const envCommand = program
  .command("env [target] [cdpTarget]")
  .description(
    "Show or switch browser environment (local | remote)\n\n" +
      "  browse env                    Show current environment\n" +
      "  browse env local              Use clean isolated local browser (default)\n" +
      "  browse env local --auto-connect  Auto-discover local Chrome, fallback to isolated\n" +
      "  browse env local <port|url>   Attach to specific CDP target\n" +
      "  browse env remote             Use Browserbase (requires API key)",
  )
  .option(
    "--auto-connect",
    "Auto-discover an existing local Chrome instance via CDP",
  );

envCommand.addOption(
  new Option(
    "--isolated",
    "Deprecated alias for the default isolated local browser",
  ).hideHelp(),
);

envCommand.action(
  async (
    target: string | undefined,
    cdpTarget: string | undefined,
    cmdOpts: { autoConnect?: boolean; isolated?: boolean },
  ) => {
    const opts = program.opts<GlobalOpts>();
    const session = getSession(opts);

    if (!target) {
      let mode: string | null = null;
      const desiredMode = await getDesiredMode(session);
      const localConfig = await readLocalConfig(session);
      const localInfo = await readLocalInfo(session);
      if (await isDaemonRunning(session)) {
        mode = toModeTarget((await readCurrentMode(session)) ?? desiredMode);
      }
      console.log(
        JSON.stringify({
          mode: mode ?? "not running",
          desired: toModeTarget(desiredMode),
          session,
          ...(desiredMode === "local"
            ? {
                localStrategy: localConfig.strategy,
                ...(localInfo ?? {}),
              }
            : {}),
        }),
      );
      return;
    }

    const modeMap: Record<string, BrowseMode> = {
      local: "local",
      remote: "browserbase",
    };
    const mapped = modeMap[target];
    if (!mapped) {
      console.error(envUsage);
      process.exit(1);
    }

    try {
      assertModeSupported(mapped);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let localConfig: LocalConfig = { ...DEFAULT_LOCAL_CONFIG };
    if (mapped === "local") {
      const selectedLocalStrategies = [
        Boolean(cmdOpts.autoConnect),
        Boolean(cmdOpts.isolated),
        Boolean(cdpTarget),
      ].filter(Boolean);

      if (selectedLocalStrategies.length > 1) {
        console.error(envUsage);
        console.error(
          "Use only one of --auto-connect, --isolated, or <port|url>.",
        );
        process.exit(1);
      }

      if (cmdOpts.autoConnect) {
        localConfig = { strategy: "auto" };
      } else if (cdpTarget) {
        localConfig = { strategy: "cdp", cdpTarget };
      }

      await writeLocalConfig(session, localConfig);
    }

    await fs.writeFile(getModeOverridePath(session), mapped);

    // Always restart daemon when switching env to pick up new local config
    if (await isDaemonRunning(session)) {
      const currentMode = (await readCurrentMode(session)) ?? "local";
      const needsRestart = currentMode !== mapped || mapped === "local"; // local always restarts to pick up strategy change
      if (!needsRestart) {
        // needsRestart is false only when currentMode === mapped && mapped !== "local"
        // (local always restarts to pick up strategy changes)
        console.log(
          JSON.stringify({
            mode: toModeTarget(mapped),
            session,
            restarted: false,
          }),
        );
        return;
      }
      await stopDaemonAndCleanup(session);
    }

    await ensureDaemon(session, isHeadless(opts));

    if (mapped === "local") {
      logLocalModeHint(localConfig, await waitForLocalInfo(session));
    }

    console.log(
      JSON.stringify({
        mode: toModeTarget(mapped),
        session,
        restarted: true,
        ...(mapped === "local" ? { localStrategy: localConfig.strategy } : {}),
      }),
    );
  },
);

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
  .option(
    "--context-id <id>",
    "Browserbase context ID to load browser state (remote mode only)",
  )
  .option(
    "--persist",
    "Persist context changes back after session ends (requires --context-id)",
    false,
  )
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
        if (opts.connect) {
          console.error(
            "Error: --context-id cannot be used with --connect (the session already exists)",
          );
          process.exit(1);
        }
        // Contexts only work with Browserbase remote sessions
        const desiredMode = await getDesiredMode(session);
        if (desiredMode === "local") {
          console.error(
            "Error: --context-id is only supported in remote mode. Run `browse env remote` first.",
          );
          process.exit(1);
        }

        const newConfig = JSON.stringify({
          id: cmdOpts.contextId,
          persist: cmdOpts.persist ?? false,
        });

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
        try {
          await fs.unlink(getContextPath(session));
        } catch {}
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
  .option(
    "-f, --force",
    "Force click even if element has no layout (uses synthetic event)",
  )
  .action(async (ref: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("click", [
        ref,
        {
          button: cmdOpts.button,
          clickCount: parseInt(cmdOpts.count),
          force: cmdOpts.force,
        },
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
  .command("upload <selector> <files...>")
  .description('Upload file(s) to an <input type="file"> element')
  .action(async (selector: string, files: string[]) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("upload", [selector, files]);
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
  .description(
    "Get page info: url, title, text, html, markdown, value, box, visible, checked",
  )
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

// ==================== CDP TAILING ====================

interface CDPMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

const CDP_DEFAULT_DOMAINS = ["Network", "Console", "Runtime", "Log", "Page"];

program
  .command("cdp <url|port>")
  .description(
    "Attach to a CDP target and stream DevTools protocol events as NDJSON.\n" +
      "Accepts a WebSocket URL (ws://...) or a bare port number (e.g. 9222).\n" +
      "Output is one JSON object per line, suitable for piping to files or jq.",
  )
  .option(
    "--domain <domains...>",
    `CDP domains to enable (repeatable). Default: ${CDP_DEFAULT_DOMAINS.join(",")}`,
  )
  .option("--pretty", "Human-readable output instead of JSON")
  .action(
    async (
      target: string,
      cmdOpts: { domain?: string[]; pretty?: boolean },
    ) => {
      const wsUrl = await resolveWsTarget(target);
      const domains = cmdOpts.domain ?? CDP_DEFAULT_DOMAINS;
      const usePretty = cmdOpts.pretty ?? process.stdout.isTTY ?? false;

      let messageId = 1;
      const pendingIds = new Set<number>();
      const targetSessionMap = new Map<string, string>();

      function sendCDP(
        ws: WebSocket,
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
      ): number {
        const id = messageId++;
        pendingIds.add(id);
        const msg: Record<string, unknown> = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
        return id;
      }

      function enableDomainsForSession(ws: WebSocket, sessionId: string): void {
        for (const domain of domains) {
          if (domain === "Network") {
            sendCDP(
              ws,
              "Network.enable",
              { maxTotalBufferSize: 1000000, maxResourceBufferSize: 100000 },
              sessionId,
            );
          } else {
            sendCDP(ws, `${domain}.enable`, {}, sessionId);
          }
        }
      }

      function writeEvent(message: CDPMessage): void {
        try {
          process.stdout.write(JSON.stringify(message) + "\n");
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
          throw err;
        }
      }

      function writePrettyEvent(message: CDPMessage): void {
        if (!message.method) return;
        const params = message.params as Record<string, unknown> | undefined;
        let line = `[${message.method}]`;

        try {
          switch (message.method) {
            case "Network.requestWillBeSent": {
              const req = params?.request as
                | { method?: string; url?: string }
                | undefined;
              if (req) line += ` ${req.method ?? "?"} ${req.url ?? ""}`;
              break;
            }
            case "Network.responseReceived": {
              const resp = params?.response as
                | { status?: number; url?: string }
                | undefined;
              if (resp) line += ` ${resp.status ?? "?"} ${resp.url ?? ""}`;
              break;
            }
            case "Network.loadingFailed": {
              const errorText =
                (params?.errorText as string) ??
                (params?.canceled ? "Canceled" : "Unknown");
              line += ` ${errorText}`;
              break;
            }
            case "Runtime.consoleAPICalled": {
              const type = (params?.type as string) ?? "log";
              const args =
                (params?.args as Array<{
                  value?: unknown;
                  description?: string;
                }>) ?? [];
              const text = args
                .map((a) => a.description ?? a.value ?? "")
                .join(" ");
              line += ` [${type}] ${text}`;
              break;
            }
            case "Runtime.exceptionThrown": {
              const detail = params?.exceptionDetails as
                | {
                    text?: string;
                    exception?: { description?: string };
                  }
                | undefined;
              line += ` ${detail?.exception?.description ?? detail?.text ?? "Unknown exception"}`;
              break;
            }
            case "Page.frameNavigated": {
              const url = (params?.frame as { url?: string })?.url ?? "";
              if (url) line += ` ${url}`;
              break;
            }
            case "Target.attachedToTarget": {
              const info = params?.targetInfo as
                | { type?: string; url?: string }
                | undefined;
              if (info) line += ` [${info.type ?? "?"}] ${info.url ?? ""}`;
              break;
            }
            default:
              break;
          }
        } catch {
          // Formatting failed — use method name only
        }

        try {
          process.stdout.write(line + "\n");
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
          throw err;
        }
      }

      const emit = usePretty ? writePrettyEvent : writeEvent;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl);
        let closed = false;

        function cleanup(): void {
          if (closed) return;
          closed = true;
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close();
          }
          resolve();
        }

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        ws.on("open", () => {
          if (usePretty) {
            process.stderr.write(`Connected to ${wsUrl}\n`);
          }

          // Auto-attach to page targets
          sendCDP(ws, "Target.setAutoAttach", {
            autoAttach: true,
            flatten: true,
            waitForDebuggerOnStart: false,
            filter: [{ type: "page" }],
          });

          sendCDP(ws, "Target.setDiscoverTargets", {
            discover: true,
            filter: [{ type: "page" }],
          });
        });

        ws.on("message", (raw: WebSocket.RawData) => {
          let data: CDPMessage;
          try {
            data = JSON.parse(raw.toString()) as CDPMessage;
          } catch {
            return;
          }

          // Filter out responses to our own commands
          if (data.id !== undefined && pendingIds.has(data.id)) {
            pendingIds.delete(data.id);
            if (data.error) {
              process.stderr.write(
                `CDP error (id=${data.id}): ${data.error.message}\n`,
              );
            }
            return;
          }

          // Track page targets and enable domains
          if (data.method === "Target.attachedToTarget" && data.params) {
            const p = data.params as {
              sessionId: string;
              targetInfo: { targetId: string; type: string };
            };
            if (p.targetInfo?.type === "page") {
              targetSessionMap.set(p.targetInfo.targetId, p.sessionId);
              enableDomainsForSession(ws, p.sessionId);
            }
          }

          if (data.method === "Target.detachedFromTarget" && data.params) {
            const p = data.params as {
              sessionId: string;
              targetId?: string;
            };
            const targetId =
              p.targetId ??
              [...targetSessionMap.entries()].find(
                ([, sid]) => sid === p.sessionId,
              )?.[0];
            if (targetId) targetSessionMap.delete(targetId);
          }

          emit(data);
        });

        ws.on("error", (err: Error) => {
          process.stderr.write(`Error: ${err.message}\n`);
        });

        ws.on("close", () => {
          if (!closed && usePretty) {
            process.stderr.write("Disconnected.\n");
          }
          cleanup();
        });
      });
    },
  );

// ==================== RUN ====================

program.parse();
