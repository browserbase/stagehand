/**
 * Stagehand CLI - Browser automation using understudy methods
 *
 * Usage:
 *   stagehand [options] <command> [args...]
 *
 * The CLI runs a daemon process that maintains browser state between commands.
 * Multiple sessions can run simultaneously using --session <name>.
 */

import { Command } from "commander";
import { type LaunchedChrome } from "chrome-launcher";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { spawn } from "child_process";
import * as readline from "readline";

// Dynamic imports to handle monorepo TypeScript resolution
const { V3Context } = await import("../../core/lib/v3/understudy/context");
const { launchLocalChrome } = await import("../../core/lib/v3/launch/local");
type Page = import("../../core/lib/v3/understudy/page").Page;

const program = new Command();

// ==================== DAEMON INFRASTRUCTURE ====================

const SOCKET_DIR = os.tmpdir();

function getSocketPath(session: string): string {
  return path.join(SOCKET_DIR, `stagehand-${session}.sock`);
}

function getPidPath(session: string): string {
  return path.join(SOCKET_DIR, `stagehand-${session}.pid`);
}

function getWsPath(session: string): string {
  return path.join(SOCKET_DIR, `stagehand-${session}.ws`);
}

function getChromePidPath(session: string): string {
  return path.join(SOCKET_DIR, `stagehand-${session}.chrome.pid`);
}

async function isDaemonRunning(session: string): Promise<boolean> {
  try {
    const pidFile = getPidPath(session);
    const pid = parseInt(await fs.readFile(pidFile, "utf-8"));
    process.kill(pid, 0); // Check if process exists

    // Also verify socket exists and is connectable
    const socketPath = getSocketPath(session);
    await fs.access(socketPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleFiles(session: string): Promise<void> {
  try { await fs.unlink(getSocketPath(session)); } catch {}
  try { await fs.unlink(getPidPath(session)); } catch {}
  try { await fs.unlink(getWsPath(session)); } catch {}
  try { await fs.unlink(getChromePidPath(session)); } catch {}
}

/** Verify a PID is actually a Chrome process before killing it */
async function verifyIsChromeProcess(pid: number): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    if (process.platform === "darwin" || process.platform === "linux") {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
      const processName = stdout.trim().toLowerCase();
      return processName.includes("chrome") || processName.includes("chromium");
    }
    return false;
  } catch {
    return false;
  }
}

/** Check if Chrome is already running on a given port */
async function isChromeRunningOnPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Safely kill Chrome process using PID file */
async function killChromeProcess(session: string): Promise<void> {
  const chromePidPath = getChromePidPath(session);
  try {
    const pidData = JSON.parse(await fs.readFile(chromePidPath, "utf-8"));
    const { pid } = pidData;

    // Verify it's actually Chrome before killing
    const isChrome = await verifyIsChromeProcess(pid);
    if (isChrome) {
      try {
        process.kill(pid, "SIGTERM");
        // Wait briefly for graceful shutdown
        await new Promise(r => setTimeout(r, 1000));
        // Check if still running
        try {
          process.kill(pid, 0);
          // Still running, force kill
          process.kill(pid, "SIGKILL");
        } catch {
          // Process already exited
        }
      } catch {
        // Process already gone
      }
    }
  } catch {
    // PID file doesn't exist or invalid
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
const CHROME_UI_HEIGHT = 87; // Address bar height

async function runDaemon(session: string, headless: boolean): Promise<void> {
  await cleanupStaleFiles(session);

  // Write daemon PID file
  await fs.writeFile(getPidPath(session), String(process.pid));

  // Launch Chrome using Stagehand's optimized launcher
  const { ws: wsUrl, chrome } = await launchLocalChrome({
    headless,
    chromeFlags: [
      `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height + CHROME_UI_HEIGHT}`,
    ],
    connectTimeoutMs: 10000,
  });

  // Save Chrome PID for safe cleanup (like agent-browse does)
  await fs.writeFile(
    getChromePidPath(session),
    JSON.stringify({ pid: chrome.pid, startTime: Date.now() })
  );

  // Save WebSocket URL for reference
  await fs.writeFile(getWsPath(session), wsUrl);

  // Connect to browser
  const context = await V3Context.create(wsUrl);

  // Set default viewport to match window size
  const page = context.activePage();
  if (page) {
    await page.setViewportSize(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  }

  // Create Unix socket server
  const socketPath = getSocketPath(session);
  const server = net.createServer((conn) => {
    const rl = readline.createInterface({ input: conn });

    rl.on("line", async (line) => {
      let response: DaemonResponse;
      try {
        const request: DaemonRequest = JSON.parse(line);
        const result = await executeCommand(context, request.command, request.args);
        response = { success: true, result };
      } catch (e) {
        response = { success: false, error: e instanceof Error ? e.message : String(e) };
      }
      conn.write(JSON.stringify(response) + "\n");
    });

    rl.on("close", () => {
      conn.destroy();
    });
  });

  server.listen(socketPath);

  // Graceful shutdown handler
  let shuttingDown = false;
  const shutdown = async (signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.close();
    try { await context.close(); } catch {}

    // Try graceful Chrome shutdown first, then force kill
    try {
      await chrome.kill();
    } catch {
      // If chrome.kill() fails, use our safe kill method
      await killChromeProcess(session);
    }

    await cleanupStaleFiles(session);
    process.exit(0);
  };

  // Handle all termination signals (like agent-browse)
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

  // Monitor Chrome process - shutdown daemon if Chrome dies
  const chromeMonitor = setInterval(async () => {
    try {
      process.kill(chrome.pid!, 0);
    } catch {
      // Chrome process is gone
      clearInterval(chromeMonitor);
      console.error(JSON.stringify({ error: "Chrome process died unexpectedly" }));
      await shutdown("chromeDied");
    }
  }, 5000);

  // Keep daemon running
  console.log(JSON.stringify({ daemon: "started", session, pid: process.pid, chromePid: chrome.pid, wsUrl }));
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

/**
 * Parse a ref from a selector argument.
 * Supports: @0-3, @[0-3], [0-3], 0-3, ref=0-3
 * Returns the ref ID (e.g., "0-3") or null if not a ref
 */
function parseRef(selector: string): string | null {
  // @0-3 or @[0-3]
  if (selector.startsWith("@")) {
    const rest = selector.slice(1);
    if (rest.startsWith("[") && rest.endsWith("]")) {
      return rest.slice(1, -1);
    }
    return rest;
  }
  // [0-3] format (our native format from snapshot)
  if (selector.startsWith("[") && selector.endsWith("]") && /^\[\d+-\d+\]$/.test(selector)) {
    return selector.slice(1, -1);
  }
  // ref=0-3 format
  if (selector.startsWith("ref=")) {
    return selector.slice(4);
  }
  // Plain 0-3 format (digit-dash-digit pattern)
  if (/^\d+-\d+$/.test(selector)) {
    return selector;
  }
  return null;
}

/**
 * Resolve a selector - if it's a ref, look up from refMap.
 * Prefers CSS selectors (faster) over XPath when available.
 */
function resolveSelector(selector: string): string {
  const ref = parseRef(selector);
  if (ref) {
    // Prefer CSS selector if available (faster and more reliable)
    const css = refMap.cssMap[ref];
    if (css) {
      return css;
    }
    // Fall back to XPath
    const xpath = refMap.xpathMap[ref];
    if (!xpath) {
      throw new Error(`Unknown ref "${ref}" - run snapshot first to populate refs (have ${Object.keys(refMap.xpathMap).length} refs)`);
    }
    return xpath;
  }
  return selector;
}

/**
 * Check if a selector looks like a ref
 */
function isRef(selector: string): boolean {
  return parseRef(selector) !== null;
}

// ==================== COMMAND EXECUTION ====================

async function executeCommand(context: V3Context, command: string, args: unknown[]): Promise<unknown> {
  const page = context.activePage();
  if (!page && command !== "pages" && command !== "newpage") {
    throw new Error("No active page");
  }

  switch (command) {
    // Navigation
    case "open": {
      const [url, waitUntil] = args as [string, string?];
      await page!.goto(url, { waitUntil: waitUntil as "load" | "domcontentloaded" | "networkidle" });
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

    // Click by ref (default) - resolves ref to coordinates and clicks
    case "click": {
      const [selector, opts] = args as [string, { button?: string; clickCount?: number }?];
      const resolved = resolveSelector(selector);
      const locator = page!.deepLocator(resolved);

      // Get center coordinates using centroid()
      const { x, y } = await locator.centroid();

      await page!.click(x, y, {
        button: (opts?.button as "left" | "right" | "middle") ?? "left",
        clickCount: opts?.clickCount ?? 1,
      });
      return { clicked: true, ref: selector, x: Math.round(x), y: Math.round(y) };
    }

    // Click by coordinates
    case "click_xy": {
      const [x, y, opts] = args as [number, number, { button?: string; clickCount?: number; returnXPath?: boolean }];
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
      const [x, y, deltaX, deltaY, opts] = args as [number, number, number, number, { returnXPath?: boolean }];
      const result = await page!.scroll(x, y, deltaX, deltaY);
      if (opts?.returnXPath) {
        return { scrolled: true, xpath: result?.xpath };
      }
      return { scrolled: true };
    }
    case "drag": {
      const [fromX, fromY, toX, toY, opts] = args as [number, number, number, number, { steps?: number; returnXPath?: boolean }];
      const result = await page!.drag(fromX, fromY, toX, toY, { steps: opts?.steps ?? 10 });
      if (opts?.returnXPath) {
        return { dragged: true, xpath: result?.xpath };
      }
      return { dragged: true };
    }

    // Keyboard
    case "type": {
      const [text, opts] = args as [string, { delay?: number; mistakes?: boolean }];
      await page!.type(text, { delay: opts?.delay, humanize: opts?.mistakes });
      return { typed: true };
    }
    case "press": {
      const [key] = args as [string];
      await page!.keyPress(key);
      return { pressed: key };
    }

    // Element actions
    case "fill": {
      const [selector, value, opts] = args as [string, string, { pressEnter?: boolean }?];
      await page!.deepLocator(resolveSelector(selector)).fill(value);
      if (opts?.pressEnter) {
        await page!.keyPress("Enter");
      }
      return { filled: true, pressedEnter: opts?.pressEnter ?? false };
    }
    case "select": {
      const [selector, values] = args as [string, string[]];
      await page!.deepLocator(resolveSelector(selector)).selectOption(values);
      return { selected: values };
    }
    case "highlight": {
      const [selector, duration] = args as [string, number?];
      await page!.deepLocator(resolveSelector(selector)).highlight({ durationMs: duration ?? 2000 });
      return { highlighted: true };
    }

    // Page info
    case "get": {
      const [what, selector] = args as [string, string?];
      switch (what) {
        case "url": return { url: page!.url() };
        case "title": return { title: await page!.title() };
        case "text": return { text: await page!.deepLocator(resolveSelector(selector!)).textContent() };
        case "html": return { html: await page!.deepLocator(resolveSelector(selector!)).innerHTML() };
        case "value": return { value: await page!.deepLocator(resolveSelector(selector!)).inputValue() };
        case "box": {
          const { x, y } = await page!.deepLocator(resolveSelector(selector!)).centroid();
          return { x: Math.round(x), y: Math.round(y) };
        }
        case "visible": return { visible: await page!.deepLocator(resolveSelector(selector!)).isVisible() };
        case "checked": return { checked: await page!.deepLocator(resolveSelector(selector!)).isChecked() };
        default: throw new Error(`Unknown get type: ${what}`);
      }
    }

    // Screenshot
    case "screenshot": {
      const [opts] = args as [{ path?: string; fullPage?: boolean; type?: string; quality?: number; clip?: object; animations?: string; caret?: string }];
      const buffer = await page!.screenshot({
        fullPage: opts?.fullPage,
        type: opts?.type as "png" | "jpeg" | undefined,
        quality: opts?.quality,
        clip: opts?.clip as { x: number; y: number; width: number; height: number } | undefined,
        animations: opts?.animations as "disabled" | "allow" | undefined,
        caret: opts?.caret as "hide" | "initial" | undefined,
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

      // Cache ref maps for subsequent commands using @ref syntax
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
      await page!.setViewportSize(width, height, { deviceScaleFactor: scale ?? 1 });
      return { viewport: { width, height } };
    }

    // Eval
    case "eval": {
      const [expr] = args as [string];
      const result = await page!.evaluate(expr);
      return { result };
    }

    // Wait
    case "wait": {
      const [type, arg, opts] = args as [string, string?, { timeout?: number; state?: string }?];
      switch (type) {
        case "load":
          await page!.waitForLoadState(
            (arg as "load" | "domcontentloaded" | "networkidle") ?? "load",
            opts?.timeout ?? 30000
          );
          break;
        case "selector":
          await page!.waitForSelector(resolveSelector(arg!), {
            state: (opts?.state as "attached" | "detached" | "visible" | "hidden") ?? "visible",
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

    // Element state
    case "is": {
      const [check, selector] = args as [string, string];
      const locator = page!.deepLocator(resolveSelector(selector));
      switch (check) {
        case "visible": return { visible: await locator.isVisible() };
        case "checked": return { checked: await locator.isChecked() };
        default: throw new Error(`Unknown check: ${check}`);
      }
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
        pages: pages.map((p, i) => ({
          index: i,
          url: p.url(),
          targetId: p.targetId(),
        })),
      };
    }
    case "newpage": {
      const [url] = args as [string?];
      const newPage = await context.newPage(url);
      return { created: true, url: newPage.url(), targetId: newPage.targetId() };
    }
    case "tab_switch": {
      const [index] = args as [number];
      const pages = context.pages();
      if (index < 0 || index >= pages.length) {
        throw new Error(`Tab index ${index} out of range (0-${pages.length - 1})`);
      }
      context.setActivePage(pages[index]);
      return { switched: true, index, url: pages[index].url() };
    }
    case "tab_close": {
      const [index] = args as [number?];
      const pages = context.pages();
      const targetIndex = index ?? pages.length - 1; // Default to last tab
      if (targetIndex < 0 || targetIndex >= pages.length) {
        throw new Error(`Tab index ${targetIndex} out of range (0-${pages.length - 1})`);
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

    // Daemon control
    case "stop": {
      // Signal shutdown - response will be sent, then daemon exits gracefully
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

async function sendCommandOnce(session: string, command: string, args: unknown[]): Promise<unknown> {
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

    rl.on("error", () => {}); // Suppress readline errors

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
async function sendCommand(session: string, command: string, args: unknown[], headless: boolean = false): Promise<unknown> {
  try {
    return await sendCommandOnce(session, command, args);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Don't retry for stop command
    if (command === "stop") {
      throw err;
    }

    // Only restart daemon on CONNECTION errors, not command execution errors
    // Connection errors: socket not found, connection refused
    // Note: Command timeout is NOT a connection error - the daemon is still running
    const isConnectionError = errMsg.includes("ENOENT") ||
                               errMsg.includes("ECONNREFUSED") ||
                               errMsg.includes("Connection failed");

    if (!isConnectionError) {
      // Command executed but failed - don't restart daemon, just throw
      throw err;
    }

    // Clean up stale session and restart daemon
    await killChromeProcess(session);
    await cleanupStaleFiles(session);
    await ensureDaemon(session, headless);

    // Retry command once
    return await sendCommandOnce(session, command, args);
  }
}

async function ensureDaemon(session: string, headless: boolean): Promise<void> {
  if (await isDaemonRunning(session)) {
    return;
  }

  // Start daemon in background
  const args = ["--session", session, "daemon"];
  if (headless) args.push("--headless");

  const child = spawn(process.argv[0], [process.argv[1], ...args], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

  // Wait for daemon to be ready
  return new Promise((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      if (!done) {
        done = true;
        rl.close();
        child.stdout?.destroy();
        child.unref();
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for daemon to start"));
    }, 20000);

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.daemon === "started") {
          clearTimeout(timeout);
          cleanup();
          // Give socket time to be ready
          setTimeout(() => resolve(), 50);
        }
      } catch {}
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });
  });
}

// ==================== CLI INTERFACE ====================

interface GlobalOpts {
  ws?: string;
  headless?: boolean;
  headed?: boolean;
  json?: boolean;
  session?: string;
}

function isHeadless(opts: GlobalOpts): boolean {
  // --headless takes precedence, otherwise default to headed (visible window)
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
  const session = opts.session ?? "default";
  const headless = isHeadless(opts);

  // If --ws provided, run directly without daemon
  if (opts.ws) {
    const context = await V3Context.create(opts.ws);
    try {
      return await executeCommand(context, command, args);
    } finally {
      await context.close();
    }
  }

  // Ensure daemon is running and send command (auto-restarts on failure)
  await ensureDaemon(session, headless);
  return sendCommand(session, command, args, headless);
}

program
  .name("stagehand")
  .description("Browser automation CLI using Stagehand understudy")
  .version("0.1.0")
  .option("--ws <url>", "CDP WebSocket URL (bypasses daemon, direct connection)")
  .option("--headless", "Run Chrome in headless mode")
  .option("--headed", "Run Chrome with visible window (default)")
  .option("--json", "Output as JSON", false)
  .option("--session <name>", "Session name for multiple browsers", "default");

// ==================== DAEMON COMMANDS ====================

program
  .command("start")
  .description("Start browser daemon (auto-started by other commands)")
  .action(async () => {
    const opts = program.opts<GlobalOpts>();
    const session = opts.session ?? "default";
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
  .option("--force", "Force kill Chrome process if daemon is unresponsive")
  .action(async (cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    const session = opts.session ?? "default";
    try {
      await sendCommand(session, "stop", []);
      console.log(JSON.stringify({ status: "stopped", session }));
    } catch {
      // Daemon not responding - try force cleanup if requested
      if (cmdOpts.force) {
        await killChromeProcess(session);
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
    const session = opts.session ?? "default";
    const running = await isDaemonRunning(session);
    let wsUrl = null;
    if (running) {
      try {
        wsUrl = await fs.readFile(getWsPath(session), "utf-8");
      } catch {}
    }
    console.log(JSON.stringify({ running, session, wsUrl }));
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
    await runDaemon(opts.session ?? "default", isHeadless(opts));
  });

// ==================== NAVIGATION ====================

program
  .command("open <url>")
  .alias("goto")
  .description("Navigate to URL")
  .option("--wait <state>", "Wait state: load, domcontentloaded, networkidle", "load")
  .action(async (url: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("open", [url, cmdOpts.wait]);
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
  .action(async (ref: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("click", [
        ref,
        { button: cmdOpts.button, clickCount: parseInt(cmdOpts.count) },
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
        { button: cmdOpts.button, clickCount: parseInt(cmdOpts.count), returnXPath: cmdOpts.xpath },
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
      const result = await runCommand("hover", [parseFloat(x), parseFloat(y), { returnXPath: cmdOpts.xpath }]);
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
        parseFloat(x), parseFloat(y), parseFloat(dx), parseFloat(dy),
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
  .option("--steps <n>", "Number of steps", "10")
  .option("--xpath", "Return XPath of dragged element")
  .action(async (fx: string, fy: string, tx: string, ty: string, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("drag", [
        parseFloat(fx), parseFloat(fy), parseFloat(tx), parseFloat(ty),
        { steps: parseInt(cmdOpts.steps), returnXPath: cmdOpts.xpath },
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
      const result = await runCommand("type", [text, { delay: cmdOpts.delay ? parseInt(cmdOpts.delay) : undefined, mistakes: cmdOpts.mistakes }]);
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
      // Default is true, --no-press-enter sets it to false
      const pressEnter = cmdOpts.pressEnter !== false;
      const result = await runCommand("fill", [selector, value, { pressEnter }]);
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
      const result = await runCommand("highlight", [selector, parseInt(cmdOpts.duration)]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== PAGE INFO ====================

program
  .command("get <what> [selector]")
  .description("Get page info: url, title, text, html, value, box")
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
      const result = await runCommand("screenshot", [{
        path: filePath,
        fullPage: cmdOpts.fullPage,
        type: cmdOpts.type,
        quality: cmdOpts.quality ? parseInt(cmdOpts.quality) : undefined,
        clip: cmdOpts.clip ? JSON.parse(cmdOpts.clip) : undefined,
        animations: cmdOpts.animations === false ? "disabled" : "allow",
        caret: cmdOpts.hideCaret ? "hide" : "initial",
      }]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== SNAPSHOT ====================

program
  .command("snapshot")
  .description("Get accessibility tree snapshot (uses understudy a11y)")
  .option("-c, --compact", "Output tree only (no xpath map)")
  .action(async (cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("snapshot", [cmdOpts.compact]) as { tree: string; xpathMap?: Record<string, string>; urlMap?: Record<string, string>; cssMap?: Record<string, string> };
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
      const result = await runCommand("viewport", [parseInt(w), parseInt(h), parseFloat(cmdOpts.scale)]);
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
  .option("-s, --state <state>", "Element state: visible, hidden, attached, detached", "visible")
  .action(async (type: string, arg: string | undefined, cmdOpts) => {
    const opts = program.opts<GlobalOpts>();
    try {
      const result = await runCommand("wait", [type, arg, { timeout: parseInt(cmdOpts.timeout), state: cmdOpts.state }]);
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
      const result = await runCommand("tab_close", [index ? parseInt(index) : undefined]);
      output(result, opts.json ?? false);
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

// ==================== RUN ====================

program.parse();
