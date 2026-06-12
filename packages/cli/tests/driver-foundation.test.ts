import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveConnectionTarget,
  targetsCompatible,
} from "../src/lib/driver/mode.js";
import {
  ensureRuntimeDir,
  getLockPath,
  getPidPath,
  getSocketPath,
  runtimeDir,
  sanitizeSessionName,
} from "../src/lib/driver/daemon/paths.js";
import {
  ensureDriverDaemon,
  getDriverStatus,
  openViaDaemon,
} from "../src/lib/driver/daemon/client.js";
import { runDriverDaemon } from "../src/lib/driver/daemon/server.js";
import { resolveWsTarget } from "../src/lib/driver/resolve-ws.js";
import { DriverSessionManager } from "../src/lib/driver/session-manager.js";
import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("driver foundation", () => {
  it("defaults remote mode from BROWSERBASE_API_KEY", async () => {
    const previousApiKey = process.env.BROWSERBASE_API_KEY;
    process.env.BROWSERBASE_API_KEY = "test-key";

    try {
      await expect(resolveConnectionTarget({})).resolves.toEqual({
        kind: "remote",
      });
    } finally {
      restoreEnv("BROWSERBASE_API_KEY", previousApiKey);
    }
  });

  it("resolves explicit driver modes", async () => {
    await expect(resolveConnectionTarget({ local: true })).resolves.toEqual({
      headless: true,
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({ headed: true, local: true }),
    ).resolves.toEqual({
      headless: false,
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({
        "chrome-arg": ["--no-focus-on-navigate"],
        headed: true,
        local: true,
      }),
    ).resolves.toEqual({
      chromeArgs: ["--no-focus-on-navigate"],
      headless: false,
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({
        "chrome-arg": [],
        local: true,
      }),
    ).resolves.toEqual({
      headless: true,
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({
        "ignore-default-chrome-arg": ["--enable-automation"],
        local: true,
      }),
    ).resolves.toEqual({
      headless: true,
      ignoreDefaultArgs: ["--enable-automation"],
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({
        "chrome-arg": ["--no-sandbox"],
        "no-default-chrome-args": true,
        local: true,
      }),
    ).resolves.toEqual({
      chromeArgs: ["--no-sandbox"],
      headless: true,
      ignoreDefaultArgs: true,
      kind: "managed-local",
    });
    await expect(
      resolveConnectionTarget({ "auto-connect": true }),
    ).resolves.toEqual({ kind: "auto-connect" });
    await expect(
      resolveConnectionTarget({
        cdp: "ws://127.0.0.1:9222/devtools/browser/test",
      }),
    ).resolves.toEqual({
      endpoint: "ws://127.0.0.1:9222/devtools/browser/test",
      kind: "cdp",
    });
  });

  it("rejects ambiguous mode flags", async () => {
    await expect(
      resolveConnectionTarget({ headless: true, headed: true, local: true }),
    ).rejects.toThrow("Pass either --headed or --headless");
    await expect(
      resolveConnectionTarget({ local: true, remote: true }),
    ).rejects.toThrow("Pass either --local or --remote");
    await expect(
      resolveConnectionTarget({ "auto-connect": true, remote: true }),
    ).rejects.toThrow("--auto-connect cannot be combined with --remote");
    await expect(
      resolveConnectionTarget({
        "auto-connect": true,
        "chrome-arg": ["--no-focus-on-navigate"],
      }),
    ).rejects.toThrow("--auto-connect cannot be combined with --chrome-arg");
    await expect(
      resolveConnectionTarget({ "auto-connect": true, local: true }),
    ).rejects.toThrow("--auto-connect cannot be combined with --local");
    await expect(
      resolveConnectionTarget({ "auto-connect": true, headed: true }),
    ).rejects.toThrow("--auto-connect cannot be combined with --headed");
    await expect(
      resolveConnectionTarget({ "auto-connect": true, headless: true }),
    ).rejects.toThrow("--auto-connect cannot be combined with --headless");
    await expect(
      resolveConnectionTarget({
        "chrome-arg": ["--no-focus-on-navigate"],
        remote: true,
      }),
    ).rejects.toThrow("--remote cannot be combined with --chrome-arg");
    await expect(
      resolveConnectionTarget({ remote: true, headed: true }),
    ).rejects.toThrow("--remote cannot be combined with --headed");
    await expect(
      resolveConnectionTarget({ remote: true, headless: true }),
    ).rejects.toThrow("--remote cannot be combined with --headless");
    await expect(
      resolveConnectionTarget({
        cdp: "9222",
        "chrome-arg": ["--no-focus-on-navigate"],
      }),
    ).rejects.toThrow("--cdp cannot be combined with --chrome-arg");
    await expect(
      resolveConnectionTarget({ cdp: "9222", local: true }),
    ).rejects.toThrow("--cdp cannot be combined with --local");
    await expect(
      resolveConnectionTarget({ cdp: "9222", remote: true }),
    ).rejects.toThrow("--cdp cannot be combined with --remote");
    await expect(
      resolveConnectionTarget({ cdp: "9222", "auto-connect": true }),
    ).rejects.toThrow("--cdp cannot be combined with --auto-connect");
    await expect(
      resolveConnectionTarget({ cdp: "9222", headed: true }),
    ).rejects.toThrow("--cdp cannot be combined with --headed");
    await expect(
      resolveConnectionTarget({ cdp: "9222", headless: true }),
    ).rejects.toThrow("--cdp cannot be combined with --headless");
    await expect(
      resolveConnectionTarget({ "target-id": "target-1" }),
    ).rejects.toThrow("--target-id requires --cdp");
  });

  it("rejects combining --no-default-chrome-args with --ignore-default-chrome-arg", async () => {
    await expect(
      resolveConnectionTarget({
        "ignore-default-chrome-arg": ["--enable-automation"],
        "no-default-chrome-args": true,
        local: true,
      }),
    ).rejects.toThrow(
      "--no-default-chrome-args cannot be combined with --ignore-default-chrome-arg.",
    );
  });

  it("rejects local-only display flags for implicit remote mode", async () => {
    const previousApiKey = process.env.BROWSERBASE_API_KEY;
    process.env.BROWSERBASE_API_KEY = "test-key";

    try {
      await expect(resolveConnectionTarget({ headed: true })).rejects.toThrow(
        "remote mode cannot be combined with --headed",
      );
      await expect(resolveConnectionTarget({ headless: true })).rejects.toThrow(
        "remote mode cannot be combined with --headless",
      );
      await expect(
        resolveConnectionTarget({
          "chrome-arg": ["--no-focus-on-navigate"],
        }),
      ).rejects.toThrow("remote mode cannot be combined with --chrome-arg");
    } finally {
      restoreEnv("BROWSERBASE_API_KEY", previousApiKey);
    }
  });

  it("only reuses daemon sessions for matching launch targets", () => {
    expect(
      targetsCompatible(
        {
          chromeArgs: ["--no-focus-on-navigate"],
          headless: false,
          kind: "managed-local",
        },
        {
          chromeArgs: ["--no-focus-on-navigate"],
          headless: false,
          kind: "managed-local",
        },
      ),
    ).toBe(true);
    expect(
      targetsCompatible(
        { headless: false, kind: "managed-local" },
        { chromeArgs: [], headless: false, kind: "managed-local" },
      ),
    ).toBe(true);
    expect(
      targetsCompatible(
        {
          chromeArgs: ["--no-focus-on-navigate"],
          headless: false,
          kind: "managed-local",
        },
        {
          chromeArgs: ["--disable-features=CalculateNativeWinOcclusion"],
          headless: false,
          kind: "managed-local",
        },
      ),
    ).toBe(false);
    expect(
      targetsCompatible(
        { headless: false, ignoreDefaultArgs: true, kind: "managed-local" },
        { headless: false, ignoreDefaultArgs: true, kind: "managed-local" },
      ),
    ).toBe(true);
    expect(
      targetsCompatible(
        {
          headless: false,
          ignoreDefaultArgs: ["--enable-automation"],
          kind: "managed-local",
        },
        {
          headless: false,
          ignoreDefaultArgs: ["--enable-automation"],
          kind: "managed-local",
        },
      ),
    ).toBe(true);
    expect(
      targetsCompatible(
        { headless: false, ignoreDefaultArgs: true, kind: "managed-local" },
        {
          headless: false,
          ignoreDefaultArgs: ["--enable-automation"],
          kind: "managed-local",
        },
      ),
    ).toBe(false);
    expect(
      targetsCompatible(
        { headless: false, kind: "managed-local" },
        { headless: false, ignoreDefaultArgs: true, kind: "managed-local" },
      ),
    ).toBe(false);
    expect(
      targetsCompatible(
        { endpoint: "ws://127.0.0.1:9222/devtools/browser/a", kind: "cdp" },
        { endpoint: "ws://127.0.0.1:9222/devtools/browser/a", kind: "cdp" },
      ),
    ).toBe(true);
    expect(
      targetsCompatible(
        { endpoint: "ws://127.0.0.1:9222/devtools/browser/a", kind: "cdp" },
        { endpoint: "ws://127.0.0.1:9222/devtools/browser/b", kind: "cdp" },
      ),
    ).toBe(false);
  });

  it("sanitizes daemon session names", () => {
    expect(sanitizeSessionName("research")).toBe("research");
    expect(sanitizeSessionName("research.v1")).toBe("research.v1");
    expect(sanitizeSessionName("../research session")).toMatch(
      /^research-session-[a-f0-9]{8}$/,
    );
    expect(sanitizeSessionName("..")).toMatch(/^default-[a-f0-9]{8}$/);
    expect(sanitizeSessionName("!!!")).toMatch(/^default-[a-f0-9]{8}$/);
    expect(sanitizeSessionName("my/session")).toMatch(
      /^my-session-[a-f0-9]{8}$/,
    );
    expect(sanitizeSessionName("my/session")).not.toBe(
      sanitizeSessionName("my:session"),
    );
  });

  it.runIf(process.platform !== "win32")(
    "defaults to a user-scoped runtime directory",
    () => {
      const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
      delete process.env.BROWSE_DAEMON_DIR;

      try {
        expect(runtimeDir()).toContain(`browse-driver-${process.getuid?.()}`);
      } finally {
        restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "creates the runtime directory with owner-only permissions",
    async () => {
      const parentDir = await mkdtemp(join(tmpdir(), "browse-driver-private-"));
      cleanupPaths.push(parentDir);
      const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
      process.env.BROWSE_DAEMON_DIR = join(parentDir, "runtime");

      try {
        const dir = await ensureRuntimeDir();
        expect(await fileMode(dir)).toBe(0o700);
      } finally {
        restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      }
    },
  );

  it("exposes descriptive help for top-level driver commands", async () => {
    for (const command of ["open", "status", "stop"]) {
      const result = await runCli([command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("FLAGS");
      expect(result.stdout).toContain("EXAMPLES");
      if (command === "open") expect(result.stdout).toContain("--chrome-arg");
    }
  });

  it("reports and stops an absent daemon as structured JSON", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const env = { BROWSE_DAEMON_DIR: daemonDir };
    const session = "test-foundation";

    const status = await runCli(["status", "--session", session], { env });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      browserConnected: false,
      initialized: false,
      session,
    });

    const stop = await runCli(["stop", "--session", session], { env });
    expect(stop.exitCode).toBe(0);
    expect(JSON.parse(stop.stdout)).toMatchObject({ session, stopped: false });
  });

  it("force stop removes stale daemon lock files", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const env = { BROWSE_DAEMON_DIR: daemonDir };
    const session = "stale-lock";
    const lockPath = getLockPath(session);

    try {
      await writeFile(lockPath, "999999");
      const stop = await runCli(["stop", "--session", session, "--force"], {
        env,
      });

      expect(stop.exitCode).toBe(0);
      expect(JSON.parse(stop.stdout)).toMatchObject({
        session,
        stopped: false,
      });
      await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });

  it("does not remove daemon files for an alive unresponsive daemon", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "alive-unresponsive";
    const pidPath = getPidPath(session);
    const socketPath = getSocketPath(session);

    try {
      await writeFile(pidPath, String(process.pid));
      await writeFile(socketPath, "not-a-socket");

      await expect(getDriverStatus(session)).resolves.toBeNull();
      await expect(access(pidPath)).resolves.toBeUndefined();
      await expect(access(socketPath)).resolves.toBeUndefined();
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });

  it("checks target compatibility after waiting for the daemon lock", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "after-lock-target";
    const lockPath = getLockPath(session);
    const sockets = new Set<net.Socket>();
    let serverStarted = false;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}") as {
          id: string;
        };
        socket.end(
          `${JSON.stringify({
            data: {
              browserConnected: true,
              initialized: true,
              mode: "managed-local",
              session,
              target: { headless: true, kind: "managed-local" },
            },
            id: request.id,
            type: "success",
          })}\n`,
        );
      });
    });

    let serverStartError: unknown;
    const releaseLockAndStartServer = setTimeout(() => {
      void new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(getSocketPath(session), () => {
          serverStarted = true;
          resolve();
        });
      })
        .then(() => rm(lockPath, { force: true }))
        .catch((error) => {
          serverStartError = error;
        });
    }, 100);

    try {
      await writeFile(lockPath, String(process.pid));
      await expect(
        ensureDriverDaemon({ session, target: { kind: "remote" } }),
      ).rejects.toThrow(
        `Session "${session}" is already running in managed-local mode.`,
      );
      if (serverStartError) throw serverStartError;
    } finally {
      clearTimeout(releaseLockAndStartServer);
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      for (const socket of sockets) {
        socket.destroy();
      }
      if (serverStarted) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
  });

  it("closes the daemon server after a stop request", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "stop-server";

    try {
      const runPromise = runDriverDaemon({
        session,
        target: { headless: true, kind: "managed-local" },
      });
      await waitForSocket(getSocketPath(session));
      if (process.platform !== "win32") {
        expect(await fileMode(daemonDir)).toBe(0o700);
        expect(await fileMode(getPidPath(session))).toBe(0o600);
      }

      const response = await sendSocketRequest(getSocketPath(session), {
        id: "stop-test",
        type: "stop",
      });
      expect(JSON.parse(response)).toMatchObject({
        data: { stopped: true },
        id: "stop-test",
        type: "success",
      });
      await expect(
        Promise.race([
          runPromise,
          rejectAfter(1_000, "Daemon server did not close."),
        ]),
      ).resolves.toBe(undefined);
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });

  it("times out resolving HTTP CDP endpoints", async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP test server address.");

      await expect(
        resolveWsTarget(`http://127.0.0.1:${address.port}`, {
          httpTimeoutMs: 50,
        }),
      ).rejects.toThrow("Timed out resolving CDP endpoint");
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("fails immediately when the daemon closes with a partial response", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-driver-test-"));
    cleanupPaths.push(daemonDir);
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "partial-response";
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.end('{"type":');
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(getSocketPath(session), resolve);
      });

      await expect(
        Promise.race([
          openViaDaemon(session, "https://example.com"),
          rejectAfter(
            1_000,
            "Partial daemon response was not rejected promptly.",
          ),
        ]),
      ).rejects.toThrow(
        `Driver daemon session "${session}" closed with an incomplete response.`,
      );
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("closes Stagehand when initialization fails", async () => {
    const init = vi.fn().mockRejectedValue(new Error("init failed"));
    const close = vi.fn().mockResolvedValue(undefined);
    const Stagehand = vi.fn(function () {
      return {
        close,
        context: {},
        init,
      };
    });

    vi.resetModules();
    vi.doMock("@browserbasehq/stagehand", () => ({
      Stagehand,
    }));

    try {
      const { DriverSessionManager: MockedDriverSessionManager } = await import(
        "../src/lib/driver/session-manager.js"
      );
      const manager = new MockedDriverSessionManager("init-failure", {
        headless: true,
        kind: "managed-local",
      });

      await expect(manager.open("https://example.com")).rejects.toThrow(
        "init failed",
      );
      await expect(manager.open("https://example.com")).rejects.toThrow(
        "init failed",
      );
      expect(Stagehand).toHaveBeenCalledTimes(1);
      expect(init).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@browserbasehq/stagehand");
      vi.resetModules();
    }
  });

  it("passes Chrome args to managed local Stagehand launches", async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const Stagehand = vi.fn(function () {
      return {
        close: vi.fn().mockResolvedValue(undefined),
        context: {},
        init,
      };
    });

    vi.resetModules();
    vi.doMock("@browserbasehq/stagehand", () => ({
      Stagehand,
    }));

    try {
      const { DriverSessionManager: MockedDriverSessionManager } = await import(
        "../src/lib/driver/session-manager.js"
      );
      const manager = new MockedDriverSessionManager("chrome-args", {
        chromeArgs: ["--no-focus-on-navigate"],
        headless: false,
        kind: "managed-local",
      });

      await manager.stagehandInstance();

      expect(Stagehand).toHaveBeenCalledWith(
        expect.objectContaining({
          env: "LOCAL",
          localBrowserLaunchOptions: {
            args: ["--no-focus-on-navigate"],
            headless: false,
          },
        }),
      );
    } finally {
      vi.doUnmock("@browserbasehq/stagehand");
      vi.resetModules();
    }
  });

  it("passes ignored default Chrome args to managed local Stagehand launches", async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const Stagehand = vi.fn(function () {
      return {
        close: vi.fn().mockResolvedValue(undefined),
        context: {},
        init,
      };
    });

    vi.resetModules();
    vi.doMock("@browserbasehq/stagehand", () => ({
      Stagehand,
    }));

    try {
      const { DriverSessionManager: MockedDriverSessionManager } = await import(
        "../src/lib/driver/session-manager.js"
      );
      const manager = new MockedDriverSessionManager("ignore-default-args", {
        headless: true,
        ignoreDefaultArgs: ["--enable-automation"],
        kind: "managed-local",
      });

      await manager.stagehandInstance();

      expect(Stagehand).toHaveBeenCalledWith(
        expect.objectContaining({
          env: "LOCAL",
          localBrowserLaunchOptions: {
            headless: true,
            ignoreDefaultArgs: ["--enable-automation"],
          },
        }),
      );
    } finally {
      vi.doUnmock("@browserbasehq/stagehand");
      vi.resetModules();
    }
  });

  it("creates a page for open when the initialized session has none", async () => {
    const manager = new DriverSessionManager("empty-open", {
      headless: true,
      kind: "managed-local",
    });
    const page = {
      targetId: () => "created-target",
    };
    const pages: (typeof page)[] = [];
    const context = {
      activePage: vi.fn(() => undefined),
      awaitActivePage: vi.fn(),
      newPage: vi.fn(async () => {
        pages.push(page);
        return page;
      }),
      pages: vi.fn(() => pages),
      setActivePage: vi.fn(),
    };

    vi.spyOn(
      manager as unknown as { ensureInitialized: () => Promise<void> },
      "ensureInitialized",
    ).mockResolvedValue();
    Object.assign(manager, { context });

    await expect(manager.pageForOpen()).resolves.toBe(page);
    expect(context.awaitActivePage).not.toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalledOnce();
    expect(context.setActivePage).toHaveBeenCalledWith(page);
  });

  it("uses the first existing page when no active page is selected", async () => {
    const manager = new DriverSessionManager("fallback-page", {
      headless: true,
      kind: "managed-local",
    });
    const page = {
      targetId: () => "existing-target",
    };
    const context = {
      activePage: vi.fn(() => undefined),
      awaitActivePage: vi.fn(),
      pages: vi.fn(() => [page]),
      setActivePage: vi.fn(),
    };

    vi.spyOn(
      manager as unknown as { ensureInitialized: () => Promise<void> },
      "ensureInitialized",
    ).mockResolvedValue();
    Object.assign(manager, { context });

    await expect(manager.activePage()).resolves.toBe(page);
    expect(context.awaitActivePage).not.toHaveBeenCalled();
    expect(context.setActivePage).toHaveBeenCalledWith(page);
  });

  it("reports status when the browser has pages but no active page", async () => {
    const manager = new DriverSessionManager("status-no-active", {
      headless: true,
      kind: "managed-local",
    });
    const page = {
      targetId: () => "page-1",
      title: vi.fn(async () => "Example"),
      url: () => "https://example.com",
    };
    const context = {
      activePage: vi.fn(() => {
        throw new Error("No Page found for awaitActivePage: no page available");
      }),
      pages: vi.fn(() => [page]),
    };

    Object.assign(manager, { context, stagehand: {} });

    await expect(manager.status()).resolves.toMatchObject({
      browserConnected: true,
      initialized: true,
      pages: [
        { targetId: "page-1", title: "Example", url: "https://example.com" },
      ],
      selectedTargetId: undefined,
      session: "status-no-active",
      url: undefined,
    });
  });

  it("fails clearly when a requested CDP target is not registered", async () => {
    const manager = new DriverSessionManager("target-missing", {
      endpoint: "ws://127.0.0.1:9222/devtools/browser/test",
      kind: "cdp",
      targetId: "missing-target",
    });

    vi.spyOn(
      manager as unknown as { ensureInitialized: () => Promise<void> },
      "ensureInitialized",
    ).mockResolvedValue();
    Object.assign(manager, {
      context: {
        pages: () => [
          {
            targetId: () => "different-target",
          },
        ],
      },
    });

    await expect(manager.open("https://example.com")).rejects.toThrow(
      "Target missing-target was not found in the attached browser.",
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function fileMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

async function waitForSocket(
  socketPath: string,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(socketPath)) return;
    await delay(20);
  }
  throw new Error(`Socket ${socketPath} was not ready after ${timeoutMs}ms.`);
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function sendSocketRequest(
  socketPath: string,
  request: unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for socket response."));
    }, 1_000);

    const finish = (result: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve(result);
    };

    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline !== -1) finish(buffer.slice(0, newline));
    });
    socket.once("error", finish);
    socket.once("close", () => {
      if (!settled) finish(new Error("Socket closed before response."));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
