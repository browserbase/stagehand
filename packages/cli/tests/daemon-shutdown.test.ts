import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPidPath, getSocketPath } from "../src/lib/driver/daemon/paths.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("daemon shutdown", () => {
  it("stop --force kills a live non-responding daemon", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-force-kill-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "force-kill";
    const sockets = new Set<net.Socket>();

    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}") as { id: string };
        socket.end(
          `${JSON.stringify({ error: "RPC client is closed", id: request.id, type: "error" })}\n`,
        );
      });
    });

    vi.resetModules();
    vi.doMock("../src/lib/driver/daemon/process.js", () => ({
      isProcessAlive: () => true,
      isDaemonProcess: () => true,
      killProcess: () => true,
    }));

    try {
      const { stopDriverDaemon: mockedStop } = await import("../src/lib/driver/daemon/client.js");
      await writeFile(getPidPath(session), "99999");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(getSocketPath(session), resolve);
      });

      const start = Date.now();
      const result = await mockedStop(session, true);
      expect(result.stopped).toBe(true);
      expect(Date.now() - start).toBeLessThan(6_500);
    } finally {
      vi.doUnmock("../src/lib/driver/daemon/process.js");
      vi.resetModules();
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("status error response returns existing selection", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-status-error-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "status-error";
    const sockets = new Set<net.Socket>();
    let statusRequests = 0;

    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}") as {
          id: string;
          type: string;
        };
        if (request.type === "status") {
          statusRequests++;
          socket.end(
            `${JSON.stringify({ error: "Browser disconnected", id: request.id, type: "error" })}\n`,
          );
        }
      });
    });

    try {
      await writeFile(getPidPath(session), String(process.pid));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(getSocketPath(session), resolve);
      });

      const { ensureDriverDaemon } = await import("../src/lib/driver/daemon/client.js");
      await expect(
        ensureDriverDaemon({ session, target: { headless: true, kind: "managed-local" } }),
      ).resolves.toBeUndefined();
      expect(statusRequests).toBe(1);
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
