import { afterEach, describe, expect, it } from "vitest";
import * as http from "http";
import * as net from "net";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { discoverLocalCdp } from "../src/local-cdp-discovery";

const cleanupPaths: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];

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
  server: net.Server,
): Promise<{ port: number; close: () => Promise<void> }> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.address() as net.AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  closeCallbacks.push(close);
  return { port, close };
}

async function listenHttpServer(
  server: http.Server,
): Promise<{ port: number; close: () => Promise<void> }> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.address() as net.AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  closeCallbacks.push(close);
  return { port, close };
}

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

describe("discoverLocalCdp", () => {
  it("uses the exact DevToolsActivePort wsPath without extra HTTP or websocket preflights", async () => {
    const root = await trackTempDir("stagehand-cli-discovery-");
    const userDataDir = path.join(root, "Google Chrome");
    const connectionPayloads: string[] = [];

    const server = net.createServer((socket) => {
      let payload = "";
      socket.on("data", (chunk) => {
        payload += chunk.toString();
      });
      socket.on("close", () => {
        connectionPayloads.push(payload);
      });
    });

    const { port } = await listenNetServer(server);
    await writeDevToolsActivePort(userDataDir, port, "/devtools/browser/actual");

    const result = await discoverLocalCdp({
      userDataDirs: [userDataDir],
      fallbackPorts: [],
    });

    expect(result).toEqual({
      wsUrl: `ws://127.0.0.1:${port}/devtools/browser/actual`,
      source: "DevToolsActivePort (Google Chrome)",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectionPayloads).toEqual([""]);
  });

  it("cleans up stale DevToolsActivePort files when the port is dead", async () => {
    const root = await trackTempDir("stagehand-cli-stale-");
    const userDataDir = path.join(root, "Google Chrome");

    const deadListener = net.createServer();
    await new Promise<void>((resolve) =>
      deadListener.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (deadListener.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => deadListener.close(() => resolve()));
    await writeDevToolsActivePort(userDataDir, port, "/devtools/browser/stale");

    const result = await discoverLocalCdp({
      userDataDirs: [userDataDir],
      fallbackPorts: [],
    });

    expect(result).toBeNull();
    await expect(
      fs.access(path.join(userDataDir, "DevToolsActivePort")),
    ).rejects.toThrow();
  });

  it("falls back to probing configured ports when no DevToolsActivePort files are found", async () => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/json/version") {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          webSocketDebuggerUrl:
            "ws://127.0.0.1:65535/devtools/browser/fallback",
        }),
      );
    });

    const { port } = await listenHttpServer(server);

    const result = await discoverLocalCdp({
      userDataDirs: [],
      fallbackPorts: [port],
    });

    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:65535/devtools/browser/fallback",
      source: `port ${port}`,
    });
  });

  it("returns null when more than one live DevToolsActivePort candidate is found", async () => {
    const root = await trackTempDir("stagehand-cli-ambiguous-");
    const firstDir = path.join(root, "Google Chrome");
    const secondDir = path.join(root, "Chromium");

    const firstServer = net.createServer();
    const secondServer = net.createServer();
    const [{ port: firstPort }, { port: secondPort }] = await Promise.all([
      listenNetServer(firstServer),
      listenNetServer(secondServer),
    ]);

    await writeDevToolsActivePort(firstDir, firstPort, "/devtools/browser/one");
    await writeDevToolsActivePort(secondDir, secondPort, "/devtools/browser/two");

    const result = await discoverLocalCdp({
      userDataDirs: [firstDir, secondDir],
      fallbackPorts: [],
    });

    expect(result).toBeNull();
  });
});
