import { promises as fs, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureDriverDaemon } from "../src/lib/driver/daemon/client.js";
import { getLockPath, getPidPath, getSocketPath } from "../src/lib/driver/daemon/paths.js";
import { itPosix } from "./helpers/platform.js";

const mocks = vi.hoisted(() => ({
  isProcessAlive: vi.fn<(pid: number) => boolean>(),
  isDaemonProcess: vi.fn<(pid: number, session: string) => boolean | null>(),
  killProcess: vi.fn<(pid: number) => boolean>(),
  spawn: vi.fn(),
}));

vi.mock("../src/lib/driver/daemon/process.js", () => mocks);
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));

describe("daemon recovery races", () => {
  const session = `recovery-${process.pid}`;
  const pid = 98765432;
  const target = { kind: "managed-local", headless: true } as const;
  let daemonDir: string;
  let alive: boolean;
  const servers: net.Server[] = [];
  const sockets = new Set<net.Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function serverForStatus(response: (requestNumber: number) => "success" | "error" | "silent") {
    let requests = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}");
        const result = response(++requests);
        if (result === "silent") return;
        socket.end(
          `${JSON.stringify(
            result === "error"
              ? { type: "error", id: request.id, error: "Still starting" }
              : {
                  type: "success",
                  id: request.id,
                  data: {
                    browserConnected: false,
                    initialized: false,
                    mode: target.kind,
                    session,
                    target,
                  },
                },
          )}\n`,
        );
      });
    });
    servers.push(server);
    return server;
  }

  async function listen(server: net.Server) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getSocketPath(session), resolve);
    });
  }

  async function writePid(ageMs: number) {
    await fs.writeFile(getPidPath(session), String(pid));
    const timestamp = new Date(Date.now() - ageMs);
    await fs.utimes(getPidPath(session), timestamp, timestamp);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    daemonDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "browse-recover-")));
    vi.stubEnv("BROWSE_DAEMON_DIR", daemonDir);
    alive = true;
    mocks.isProcessAlive.mockImplementation((candidate) => candidate !== pid || alive);
    mocks.isDaemonProcess.mockImplementation(() => alive);
    mocks.killProcess.mockImplementation(() => {
      alive = false;
      for (const socket of sockets) socket.destroy();
      for (const server of servers) server.close();
      return true;
    });
    mocks.spawn.mockImplementation(() => {
      serverForStatus(() => "success").listen(getSocketPath(session));
      return { unref: vi.fn() };
    });
  });

  afterEach(async () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    sockets.clear();
    vi.unstubAllEnvs();
    await fs.rm(daemonDir, { recursive: true, force: true });
  });

  it("preserves an unresponsive process when its identity cannot be verified", async () => {
    await writePid(60_000);
    if (process.platform !== "win32") {
      await fs.writeFile(getSocketPath(session), "stale socket");
    }
    mocks.isDaemonProcess.mockReturnValue(null);

    await expect(ensureDriverDaemon({ session, target })).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_unresponsive" },
    });
    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(await fs.readFile(getPidPath(session), "utf8")).toBe(String(pid));
    if (process.platform !== "win32") {
      expect(await fs.readFile(getSocketPath(session), "utf8")).toBe("stale socket");
    }
    await expect(fs.access(getLockPath(session))).rejects.toMatchObject({ code: "ENOENT" });
  });

  itPosix(
    "does not kill after the runtime directory becomes unsafe during startup grace",
    async () => {
      await writePid(0);
      const unsafeDir = join(daemonDir, "symlink");
      await fs.symlink(daemonDir, unsafeDir);
      mocks.isDaemonProcess.mockImplementationOnce(() => {
        vi.stubEnv("BROWSE_DAEMON_DIR", unsafeDir);
        return true;
      });

      await expect(ensureDriverDaemon({ session, target })).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_invalid" },
      });
      expect(mocks.killProcess).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );

  it("does not signal a PID that was reused during startup grace", async () => {
    await writePid(29_800);
    mocks.isDaemonProcess.mockReturnValueOnce(true).mockReturnValue(false);

    await ensureDriverDaemon({ session, target });

    expect(mocks.isDaemonProcess).toHaveBeenCalledTimes(2);
    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("recovers when the daemon exits while waiting for startup", async () => {
    await writePid(29_800);
    mocks.isDaemonProcess.mockImplementationOnce(() => {
      timers.add(setTimeout(() => (alive = false), 20));
      return true;
    });

    await ensureDriverDaemon({ session, target });

    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("recovers when the daemon exits immediately before the kill", async () => {
    await writePid(60_000);
    mocks.killProcess.mockImplementation(() => {
      alive = false;
      return false;
    });

    await ensureDriverDaemon({ session, target });

    expect(mocks.killProcess).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("preserves a replacement daemon's PID file", async () => {
    await writePid(60_000);
    mocks.isDaemonProcess.mockImplementationOnce(() => {
      writeFileSync(getPidPath(session), String(pid + 1));
      return true;
    });

    await expect(ensureDriverDaemon({ session, target })).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_unresponsive" },
    });

    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(await fs.readFile(getPidPath(session), "utf8")).toBe(String(pid + 1));
  });

  it("keeps waiting through transient status failures during startup grace", async () => {
    await writePid(0);
    await listen(serverForStatus((request) => (request <= 3 ? "error" : "success")));

    await ensureDriverDaemon({ session, target });

    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("bounds a silent status response by the remaining startup grace", async () => {
    await writePid(29_750);
    await listen(serverForStatus((request) => (request <= 2 ? "error" : "silent")));

    await ensureDriverDaemon({ session, target });

    expect(mocks.killProcess).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  }, 5_000);
});
