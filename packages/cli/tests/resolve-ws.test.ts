import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as http from "http";
import * as net from "net";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { resolveWsTarget } from "../src/resolve-ws";

let server: http.Server;
let port: number;
const cleanupPaths: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc123`,
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  while (closeCallbacks.length > 0) {
    const close = closeCallbacks.pop();
    if (!close) continue;
    await close();
  }

  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) continue;
    await fs.rm(target, { recursive: true, force: true });
  }
});

async function trackTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

async function writeDevToolsActivePort(
  userDataDir: string,
  port: number,
  wsPath: string,
): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(
    path.join(userDataDir, "DevToolsActivePort"),
    `${port}\n${wsPath}\n`,
  );
}

async function listenNetServer(
  handler?: (socket: net.Socket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const wsServer = net.createServer((socket) => {
    handler?.(socket);
  });
  await new Promise<void>((resolve) =>
    wsServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const resolvedPort = (wsServer.address() as net.AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve, reject) =>
      wsServer.close((error) => (error ? reject(error) : resolve())),
    );
  closeCallbacks.push(close);
  return { port: resolvedPort, close };
}

describe("resolveWsTarget", () => {
  it("resolves a bare port via /json/version", async () => {
    const result = await resolveWsTarget(String(port));
    expect(result).toBe(`ws://127.0.0.1:${port}/devtools/browser/abc123`);
  });

  it("resolves a bare port via matching DevToolsActivePort when only the exact websocket path is available", async () => {
    const root = await trackTempDir("stagehand-cli-resolve-ws-");
    const userDataDir = path.join(root, "Google Chrome");
    const connectionPayloads: string[] = [];
    const exactPath = "/devtools/browser/from-active-port";

    const { port: exactPort } = await listenNetServer((socket) => {
      let payload = "";
      socket.on("data", (chunk) => {
        payload += chunk.toString();
      });
      socket.on("close", () => {
        connectionPayloads.push(payload);
      });
    });

    await writeDevToolsActivePort(userDataDir, exactPort, exactPath);

    const result = await resolveWsTarget(String(exactPort), {
      userDataDirs: [userDataDir],
    });

    expect(result).toBe(`ws://127.0.0.1:${exactPort}${exactPath}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectionPayloads).toEqual([""]);
  });

  it("falls back to ws://127.0.0.1:{port}/devtools/browser when /json/version is unavailable", async () => {
    const result = await resolveWsTarget("19999");
    expect(result).toBe("ws://127.0.0.1:19999/devtools/browser");
  });

  it("passes through ws:// URLs as-is", async () => {
    const url = "ws://localhost:9222/devtools/browser/xyz";
    expect(await resolveWsTarget(url)).toBe(url);
  });

  it("passes through wss:// URLs as-is", async () => {
    const url = "wss://remote.host/devtools/browser/xyz";
    expect(await resolveWsTarget(url)).toBe(url);
  });

  it("passes through http:// URLs as-is", async () => {
    const url = "http://localhost:9222/json/version";
    expect(await resolveWsTarget(url)).toBe(url);
  });
});
