import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface LocalCdpDiscovery {
  source: string;
  wsUrl: string;
}

interface DevToolsActivePortInfo {
  port: number;
  wsPath: string;
}

interface CdpCandidate {
  source: string;
  wsUrl: string;
}

interface DiscoverLocalCdpOptions {
  fallbackPorts?: number[];
  userDataDirs?: string[];
}

interface ResolveWsTargetFromPortOptions {
  userDataDirs?: string[];
}

const DEFAULT_FALLBACK_PORTS = [9222, 9229];

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
    const base = path.join(home, ".config");
    for (const name of [
      "google-chrome",
      "google-chrome-unstable",
      "chromium",
      "BraveSoftware/Brave-Browser",
    ]) {
      dirs.push(path.join(base, name));
    }
  } else if (process.platform === "win32") {
    const base = path.join(home, "AppData", "Local");
    for (const name of [
      "Google/Chrome/User Data",
      "Google/Chrome Beta/User Data",
      "Google/Chrome SxS/User Data",
      "Chromium/User Data",
      "BraveSoftware/Brave-Browser/User Data",
    ]) {
      dirs.push(path.join(base, name));
    }
  }

  return dirs;
}

export function buildDevToolsWsUrl(port: number, wsPath: string): string {
  const normalizedPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  return `ws://127.0.0.1:${port}${normalizedPath}`;
}

export async function readDevToolsActivePort(
  userDataDir: string,
): Promise<DevToolsActivePortInfo | null> {
  try {
    const content = await fs.readFile(
      path.join(userDataDir, "DevToolsActivePort"),
      "utf8",
    );
    const lines = content.trim().split("\n");
    const port = Number.parseInt(lines[0]?.trim() ?? "", 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { port, wsPath: lines[1]?.trim() || "/devtools/browser" };
  } catch {
    return null;
  }
}

function isPortReachable(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function probeJsonVersion(port: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      webSocketDebuggerUrl?: string;
    };
    return payload.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCdpWebSocket(wsUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(wsUrl);
    const port = Number.parseInt(url.port, 10) || 80;
    const key = Buffer.from(
      Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
    ).toString("base64");
    const socket = net.createConnection({ host: url.hostname, port });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);

    socket.on("connect", () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    socket.on("data", (data) => {
      response += data.toString();
      if (/^HTTP\/1\.[01] 101(?:\s|$)/.test(response)) {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      } else if (response.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      }
    });
    socket.on("error", () => {
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
    if (!info || info.port !== port) continue;
    if (!(await isPortReachable(info.port))) continue;
    return buildDevToolsWsUrl(info.port, info.wsPath);
  }

  return null;
}

export async function resolveWsTargetFromPort(
  port: number,
  options: ResolveWsTargetFromPortOptions = {},
): Promise<string> {
  const userDataDirs = options.userDataDirs ?? getChromeUserDataDirs();
  const devToolsUrl = await resolveDevToolsActivePortUrl(port, userDataDirs);
  if (devToolsUrl) return devToolsUrl;
  const jsonVersionUrl = await probeJsonVersion(port);
  if (jsonVersionUrl) return jsonVersionUrl;
  const fallback = buildDevToolsWsUrl(port, "/devtools/browser");
  if (await verifyCdpWebSocket(fallback)) return fallback;
  throw new Error(
    `Unable to resolve CDP endpoint from port ${port}. Is Chrome running with remote debugging?`,
  );
}

export async function discoverLocalCdp(
  options: DiscoverLocalCdpOptions = {},
): Promise<LocalCdpDiscovery | null> {
  const candidates: CdpCandidate[] = [];
  const userDataDirs = options.userDataDirs ?? getChromeUserDataDirs();

  for (const dir of userDataDirs) {
    const info = await readDevToolsActivePort(dir);
    if (!info || !(await isPortReachable(info.port))) continue;
    candidates.push({
      source: `DevToolsActivePort:${dir}`,
      wsUrl: buildDevToolsWsUrl(info.port, info.wsPath),
    });
  }

  for (const port of options.fallbackPorts ?? DEFAULT_FALLBACK_PORTS) {
    const wsUrl = await probeJsonVersion(port);
    if (!wsUrl) continue;
    if (!candidates.some((candidate) => candidate.wsUrl === wsUrl)) {
      candidates.push({ source: `port:${port}`, wsUrl });
    }
  }

  return candidates[0] ?? null;
}
