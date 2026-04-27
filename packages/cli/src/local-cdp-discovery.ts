import { promises as fs } from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import type { LocalCdpDiscovery } from "./local-strategy";

interface DevToolsActivePortInfo {
  port: number;
  wsPath: string;
}

interface CdpCandidate {
  wsUrl: string;
  source: string;
}

interface DiscoverLocalCdpOptions {
  userDataDirs?: string[];
  fallbackPorts?: number[];
}

interface ResolveWsTargetFromPortOptions {
  userDataDirs?: string[];
}

const DEFAULT_FALLBACK_PORTS = [9222, 9229];

/**
 * Well-known Chrome user-data directories per platform.
 * Each may contain a DevToolsActivePort file when Chrome is running with
 * remote debugging enabled.
 */
export function getChromeUserDataDirs(): string[] {
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

export function buildDevToolsWsUrl(port: number, wsPath: string): string {
  const normalizedPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  return `ws://127.0.0.1:${port}${normalizedPath}`;
}

/**
 * Read DevToolsActivePort file from a Chrome user-data directory.
 * Returns { port, wsPath } or null if file doesn't exist or is malformed.
 */
export async function readDevToolsActivePort(
  userDataDir: string,
): Promise<DevToolsActivePortInfo | null> {
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

async function cleanupStaleDevToolsActivePort(
  userDataDir: string,
): Promise<void> {
  try {
    await fs.unlink(path.join(userDataDir, "DevToolsActivePort"));
  } catch {
    // Ignore cleanup failures.
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

async function probeJsonVersion(port: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (json.webSocketDebuggerUrl) {
        return json.webSocketDebuggerUrl;
      }
    }
  } catch {
    // /json/version unavailable
  } finally {
    clearTimeout(timer);
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
    const port = parseInt(url.port, 10) || 80;
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
      sock.write(
        `GET ${url.pathname} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    sock.on("data", (data) => {
      response += data.toString();
      if (/^HTTP\/1\.[01] 101(?:\s|$)/.test(response)) {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      } else if (response.includes("\r\n\r\n")) {
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

async function resolveDevToolsActivePortUrl(
  port: number,
  userDataDirs: string[],
): Promise<string | null> {
  for (const dir of userDataDirs) {
    const info = await readDevToolsActivePort(dir);
    if (!info || info.port !== port) {
      continue;
    }

    if (!(await isPortReachable(info.port))) {
      await cleanupStaleDevToolsActivePort(dir);
      continue;
    }

    return buildDevToolsWsUrl(info.port, info.wsPath);
  }

  return null;
}

async function probeFallbackPort(port: number): Promise<string | null> {
  const jsonVersionUrl = await probeJsonVersion(port);
  if (jsonVersionUrl) {
    return jsonVersionUrl;
  }

  const wsUrl = buildDevToolsWsUrl(port, "/devtools/browser");
  const verified = await verifyCdpWebSocket(wsUrl);
  return verified ? wsUrl : null;
}

/**
 * Resolve a bare port number to a CDP WebSocket URL.
 * Prefers an exact DevToolsActivePort match to avoid extra preflight requests.
 */
export async function resolveWsTargetFromPort(
  port: number,
  options: ResolveWsTargetFromPortOptions = {},
): Promise<string> {
  const userDataDirs = options.userDataDirs ?? getChromeUserDataDirs();
  const devToolsPortUrl = await resolveDevToolsActivePortUrl(
    port,
    userDataDirs,
  );
  if (devToolsPortUrl) {
    return devToolsPortUrl;
  }

  const jsonVersionUrl = await probeJsonVersion(port);
  if (jsonVersionUrl) {
    return jsonVersionUrl;
  }

  return buildDevToolsWsUrl(port, "/devtools/browser");
}

/**
 * Discover locally-running Chrome instances with CDP debugging enabled.
 * Returns the discovered CDP WebSocket URL, or null when none or many are found.
 */
export async function discoverLocalCdp(
  options: DiscoverLocalCdpOptions = {},
): Promise<LocalCdpDiscovery | null> {
  const candidates: CdpCandidate[] = [];
  const userDataDirs = options.userDataDirs ?? getChromeUserDataDirs();

  for (const dir of userDataDirs) {
    const info = await readDevToolsActivePort(dir);
    if (!info) continue;

    if (!(await isPortReachable(info.port))) {
      await cleanupStaleDevToolsActivePort(dir);
      continue;
    }

    candidates.push({
      wsUrl: buildDevToolsWsUrl(info.port, info.wsPath),
      source: `DevToolsActivePort (${path.basename(dir)})`,
    });
  }

  if (candidates.length === 0) {
    for (const port of options.fallbackPorts ?? DEFAULT_FALLBACK_PORTS) {
      if (!(await isPortReachable(port))) continue;
      const wsUrl = await probeFallbackPort(port);
      if (wsUrl) {
        candidates.push({ wsUrl, source: `port ${port}` });
      }
    }
  }

  if (candidates.length > 1) {
    return null;
  }

  return candidates[0] ?? null;
}
