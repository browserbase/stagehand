import childProcess from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDriverSession, type DriverFlags } from "../src/lib/driver/command-cli.js";
import { getLockPath, getSocketPath } from "../src/lib/driver/daemon/paths.js";
import { parseRequest, type DriverRequest } from "../src/lib/driver/daemon/protocol.js";
import { runDriverCommand } from "../src/lib/driver/runtime.js";
import type { ConnectionTarget } from "../src/lib/driver/types.js";

const headed: ConnectionTarget = { kind: "managed-local", headless: false };
const customChrome: ConnectionTarget = {
  ...headed,
  chromeArgs: ["--no-focus-on-navigate"],
  ignoreDefaultArgs: ["--enable-automation"],
};
const remote: ConnectionTarget = { kind: "remote", verified: true, proxies: true };
const cdp: ConnectionTarget = {
  kind: "cdp",
  endpoint: "ws://127.0.0.1:9222/devtools/browser/test",
  targetId: "page-1",
};

type SessionCase = { name: string; target: ConnectionTarget; flags: DriverFlags };
const reuseCases: SessionCase[] = [
  { name: "headed browser without flags", target: headed, flags: {} },
  { name: "custom Chrome arguments without flags", target: customChrome, flags: {} },
  { name: "remote settings without flags", target: remote, flags: {} },
  { name: "CDP attachment without flags", target: cdp, flags: {} },
  { name: "local mode only", target: customChrome, flags: { local: true } },
  { name: "remote mode only", target: remote, flags: { remote: true } },
  {
    name: "matching explicit Chrome options",
    target: customChrome,
    flags: {
      local: true,
      headed: true,
      "chrome-arg": ["--no-focus-on-navigate"],
      "ignore-default-chrome-arg": ["--enable-automation"],
    },
  },
  {
    name: "matching explicit remote options",
    target: remote,
    flags: { remote: true, verified: true, proxies: true },
  },
  {
    name: "matching explicit CDP attachment",
    target: cdp,
    flags: { cdp: cdp.endpoint, "target-id": cdp.targetId },
  },
];
const conflictCases: SessionCase[] = [
  { name: "headed versus headless", target: headed, flags: { local: true, headless: true } },
  {
    name: "different Chrome arguments",
    target: customChrome,
    flags: { local: true, headed: true, "chrome-arg": ["--disable-gpu"] },
  },
  { name: "local versus remote mode", target: headed, flags: { remote: true } },
  { name: "remote versus local mode", target: remote, flags: { local: true } },
  {
    name: "different remote settings",
    target: remote,
    flags: { remote: true, verified: true },
  },
  {
    name: "different CDP target",
    target: cdp,
    flags: { cdp: cdp.endpoint, "target-id": "page-2" },
  },
];

describe("driver session selection", () => {
  const session = `session-selection-${process.pid}`;
  const sockets = new Set<net.Socket>();
  let daemonDir: string;
  let server: net.Server;
  let target: ConnectionTarget;
  let requests: DriverRequest[];

  beforeEach(async () => {
    daemonDir = await fs.mkdtemp(join(tmpdir(), "browse-selection-"));
    vi.stubEnv("BROWSE_DAEMON_DIR", daemonDir);
    vi.stubEnv("BROWSERBASE_API_KEY", "");
    target = headed;
    requests = [];
    // No test in this suite should launch a real daemon or browser.
    vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      throw new Error("Unexpected daemon spawn");
    });
    server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      const reader = readline.createInterface({ input: socket });
      socket.once("close", () => reader.close());
      reader.once("line", (line) => {
        const request = parseRequest(line);
        requests.push(request);
        const data =
          request.type === "status"
            ? {
                session,
                pid: process.pid,
                mode: target.kind,
                target,
                browserConnected: true,
                initialized: true,
                pages: [],
              }
            : { handledBy: session };
        socket.end(`${JSON.stringify({ id: request.id, type: "success", data })}\n`);
      });
    });
  });

  async function listen() {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getSocketPath(session), resolve);
    });
  }

  async function closeServer() {
    for (const socket of sockets) socket.destroy();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  afterEach(async () => {
    await closeServer();
    sockets.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(daemonDir, { recursive: true, force: true });
  });

  it.each(reuseCases)("reuses $name", async (testCase) => {
    target = testCase.target;
    // An existing local session must win even when the environment now defaults remote.
    if (testCase.name === "headed browser without flags") {
      vi.stubEnv("BROWSERBASE_API_KEY", "test-key");
    }
    await listen();
    const selection = await resolveDriverSession(session, testCase.flags);
    await expect(runDriverCommand(session, selection, "snapshot", { full: true })).resolves.toEqual(
      {
        handledBy: session,
      },
    );
    expect(requests.map((request) => request.type)).toEqual(["status", "command"]);
    expect(requests[1]).toMatchObject({ command: "snapshot", params: { full: true } });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it.each(conflictCases)("rejects $name before executing a command", async (testCase) => {
    target = testCase.target;
    await listen();
    await expect(resolveDriverSession(session, testCase.flags)).rejects.toThrow(
      `Session "${session}" is already running in ${target.kind} mode.`,
    );
    expect(requests.map((request) => request.type)).toEqual(["status"]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: "", flags: {}, expected: { kind: "managed-local", headless: true } },
    { apiKey: "test-key", flags: {}, expected: { kind: "remote" } },
    {
      apiKey: "test-key",
      flags: { local: true, headed: true, "chrome-arg": ["--disable-gpu"] },
      expected: { kind: "managed-local", headless: false, chromeArgs: ["--disable-gpu"] },
    },
  ])(
    "selects a new session from caller flags and defaults: %j",
    async ({ apiKey, flags, expected }) => {
      vi.stubEnv("BROWSERBASE_API_KEY", apiKey);
      await expect(resolveDriverSession(session, flags)).resolves.toEqual({
        kind: "create",
        target: expected,
      });
    },
  );

  it("reports disappearance before snapshot without starting a replacement", async () => {
    await listen();
    const selection = await resolveDriverSession(session, { local: true, headed: true });
    await closeServer();
    await expect(
      runDriverCommand(session, selection, "snapshot", { full: true }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(`Driver daemon session "${session}" is not running.`),
      telemetry: { resultCode: "daemon_not_running" },
    });
    expect(requests.map((request) => request.type)).toEqual(["status"]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it(
    "auto-recovers for open when the session vanishes after selection",
    { timeout: 35_000 },
    async () => {
      await listen();
      const selection = await resolveDriverSession(session, { local: true, headed: true });
      expect(selection).toMatchObject({ kind: "existing", fallbackTarget: expect.any(Object) });
      await closeServer();
      // Remove socket file to trigger daemon_not_running error (ENOENT)
      const socketPath = getSocketPath(session);
      await fs.unlink(socketPath).catch(() => undefined);

      // Recovery will call ensureDriverDaemon, which spawns and waits for the socket.
      // The real spawn runs the vitest entrypoint instead of the browse CLI, so the
      // daemon never starts and waitForSocketReady times out. The key assertion is
      // that the final error comes from the recovery path (socket not ready), not
      // from the original daemon_not_running. This confirms recovery was attempted.
      const result = await runDriverCommand(session, selection, "open", {
        url: "about:blank",
      }).catch((error: unknown) => error);
      // After recovery attempt, error should be socket timeout (from ensureDriverDaemon),
      // not the original daemon_not_running. This confirms recovery was triggered.
      expect(result).toMatchObject({
        message: expect.stringContaining("socket was not ready"),
      });
      expect(requests.map((request) => request.type)).toEqual(["status"]);
    },
  );

  it("auto-recovers for open when daemon_connection_lost occurs", { timeout: 35_000 }, async () => {
    // First, start the normal server for the status check
    await listen();
    const selection = await resolveDriverSession(session, { local: true, headed: true });
    expect(selection).toMatchObject({ kind: "existing", fallbackTarget: expect.any(Object) });

    // Close the server and replace it with one that closes without responding
    await closeServer();

    const socketPath = getSocketPath(session);
    // Create a server that waits for request data then closes without responding
    // (simulating a daemon crash mid-request). This triggers daemon_connection_lost.
    const crashingServer = net.createServer((socket) => {
      // Wait for request data, then end without responding
      socket.once("data", () => {
        crashingServer.close();
        fs.unlink(socketPath).catch(() => undefined);
        socket.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      crashingServer.once("error", reject);
      crashingServer.listen(socketPath, resolve);
    });

    // The open command will get daemon_connection_lost, triggering recovery
    const result = await runDriverCommand(session, selection, "open", { url: "about:blank" }).catch(
      (error: unknown) => error,
    );

    // Recovery was attempted (socket timeout is from ensureDriverDaemon failing
    // because spawn runs vitest instead of browse CLI in test environment)
    expect(result).toMatchObject({
      message: expect.stringContaining("socket was not ready"),
    });
    expect(requests.map((request) => request.type)).toEqual(["status"]);
  });

  it.each([
    { waitsForLock: false, compatible: true },
    { waitsForLock: false, compatible: false },
    { waitsForLock: true, compatible: true },
    { waitsForLock: true, compatible: false },
  ])("checks a concurrently started daemon: %j", async ({ waitsForLock, compatible }) => {
    const selection = await resolveDriverSession(session, { local: true, headed: true });
    expect(selection.kind).toBe("create");
    target = compatible ? headed : remote;
    const lockPath = getLockPath(session);
    let waitingForLock: Promise<void> | undefined;
    let resumeLockAcquisition: (() => void) | undefined;
    if (waitsForLock) {
      await fs.writeFile(lockPath, String(process.pid));
      const open = fs.open.bind(fs);
      let sawOccupiedLock = false;
      const fixtureReady = new Promise<void>((resolve) => {
        resumeLockAcquisition = resolve;
      });
      waitingForLock = new Promise<void>((resolve) => {
        vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          const isLockAttempt = args[0] === lockPath && args[1] === "wx";
          if (isLockAttempt && sawOccupiedLock) {
            resolve();
            await fixtureReady;
          }
          try {
            return await open(...args);
          } catch (error) {
            if (isLockAttempt && (error as NodeJS.ErrnoException).code === "EEXIST") {
              sawOccupiedLock = true;
            }
            throw error;
          }
        });
      });
    } else {
      await listen();
    }

    const result = runDriverCommand(session, selection, "snapshot", {}).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    if (waitingForLock) {
      // Pause the retry after the occupied lock is inspected so fixture removal
      // cannot overlap its read or the next exclusive open on Windows.
      await waitingForLock;
      try {
        await listen();
        await fs.rm(lockPath);
      } finally {
        resumeLockAcquisition?.();
      }
    }
    if (compatible) {
      expect(await result).toEqual({ value: { handledBy: session } });
      expect(requests.map((request) => request.type)).toEqual(["status", "command"]);
    } else {
      expect(await result).toMatchObject({
        error: { message: expect.stringContaining("already running in remote mode") },
      });
      expect(requests.map((request) => request.type)).toEqual(["status"]);
    }
    expect(childProcess.spawn).not.toHaveBeenCalled();
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
