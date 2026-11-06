import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describePosix } from "./helpers/platform.js";
import { mockDirectoryOwner, mockRootOwnedParents } from "./helpers/directory-owner.js";
import { resolveTargetForCommand } from "../src/lib/driver/command-cli.js";
import {
  ensureDriverDaemon,
  getDriverStatus,
  openViaDaemon,
  runDriverCommandViaDaemon,
  stopDriverDaemon,
} from "../src/lib/driver/daemon/client.js";
import {
  cleanupDaemonFiles,
  getLockPath,
  getPidPath,
  getSocketPath,
} from "../src/lib/driver/daemon/paths.js";

// Use a real listening socket: these tests must detect both bare connectivity
// probes and requests that could forward credentials to an untrusted daemon.
describePosix("daemon directory validation before connections", () => {
  const session = "default";
  const sockets = new Set<net.Socket>();
  let fixtureDir: string;
  let daemonDir: string;
  let server: net.Server;
  let connections: number;
  let requests: string[];

  beforeEach(async () => {
    fixtureDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "browse-dir-")));
    daemonDir = join(fixtureDir, "runtime");
    await fs.mkdir(daemonDir);
    vi.stubEnv("BROWSE_DAEMON_DIR", daemonDir);
    vi.stubEnv("BROWSERBASE_API_KEY", "test-key-must-not-be-forwarded");
    connections = 0;
    requests = [];
    server = net.createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", (chunk) => {
        requests.push(chunk.toString());
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}");
        socket.end(
          `${JSON.stringify({
            type: "success",
            id: request.id,
            data: {
              session,
              mode: "managed-local",
              target: { kind: "managed-local", headless: true },
            },
          })}\n`,
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getSocketPath(session), resolve);
    });
    // These stale artifacts would be removed if a validation failure were
    // incorrectly treated as an absent daemon or a successful forced stop.
    await fs.writeFile(getPidPath(session), "999999");
    await fs.writeFile(getLockPath(session), "999999");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    vi.unstubAllEnvs();
    if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it.each(["unprivileged", "root"])(
    "refuses every client entry point before connecting as %s",
    async (caller) => {
      const uid = caller === "root" ? 0 : process.getuid!();
      vi.spyOn(process, "getuid").mockReturnValue(uid);
      if (caller === "root") mockRootOwnedParents();
      mockDirectoryOwner(daemonDir, () => uid + 1);
      const connect = vi.spyOn(net, "createConnection");
      const operations = [
        () => getDriverStatus(session),
        () => stopDriverDaemon(session),
        () => stopDriverDaemon(session, true),
        () => resolveTargetForCommand(session, {}),
        () => resolveTargetForCommand(session, { local: true }),
        () => openViaDaemon(session, "about:blank"),
        () => runDriverCommandViaDaemon(session, "snapshot"),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          telemetry: { resultCode: "daemon_dir_not_owned" },
        });
      }

      expect(connect).not.toHaveBeenCalled();
      expect(connections).toBe(0);
      expect(requests).toEqual([]);
      await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.readFile(getLockPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.access(getSocketPath(session))).resolves.toBeUndefined();
    },
  );

  it.each([
    { operation: "status", validChecks: 1 },
    { operation: "forced stop", validChecks: 2 },
  ])(
    "propagates ownership loss during $operation without cleanup",
    async ({ operation, validChecks }) => {
      const { uid } = await fs.lstat(daemonDir);
      let remainingChecks = validChecks;
      // Keep the caller fixed and change freshly read directory metadata after
      // the probe or status reply. Caching ownership must not pass this test.
      vi.spyOn(process, "getuid").mockReturnValue(uid);
      mockDirectoryOwner(daemonDir, () => (remainingChecks-- > 0 ? uid : uid + 1));
      const connect = vi.spyOn(net, "createConnection");

      await expect(
        operation === "status" ? getDriverStatus(session) : stopDriverDaemon(session, true),
      ).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_not_owned" },
      });

      expect(connect).toHaveBeenCalledTimes(validChecks);
      expect(requests).toHaveLength(operation === "status" ? 0 : 1);
      expect(requests.join("\n")).not.toContain("test-key-must-not-be-forwarded");
      await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.readFile(getLockPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.access(getSocketPath(session))).resolves.toBeUndefined();
    },
  );

  it.each(["status", "forced stop"])(
    "revalidates before cleanup after a failed probe during %s",
    async (operation) => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      // Leave a non-listening socket artifact so the real probe fails.
      await fs.writeFile(getSocketPath(session), "stale socket");
      let foreign = false;
      mockDirectoryOwner(daemonDir, (uid) => (foreign ? uid + 1 : uid));
      const connect = net.createConnection;
      vi.spyOn(net, "createConnection").mockImplementation((...args) => {
        foreign = true;
        return connect(...args);
      });
      const read = vi.spyOn(fs, "readFile");
      const unlink = vi.spyOn(fs, "unlink");

      await expect(
        operation === "status" ? getDriverStatus(session) : stopDriverDaemon(session, true),
      ).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_not_owned" },
      });

      expect(read).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.readFile(getLockPath(session), "utf8")).resolves.toBe("999999");
      await expect(fs.readFile(getSocketPath(session), "utf8")).resolves.toBe("stale socket");
    },
  );

  it("revalidates after reading stale PID metadata and before deleting artifacts", async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.writeFile(getSocketPath(session), "stale socket");
    let foreign = false;
    mockDirectoryOwner(daemonDir, (uid) => (foreign ? uid + 1 : uid));
    const read = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
      const result = await read(...args);
      if (args[0] === getPidPath(session)) foreign = true;
      return result;
    });
    const unlink = vi.spyOn(fs, "unlink");

    await expect(getDriverStatus(session)).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_not_owned" },
    });

    expect(unlink).not.toHaveBeenCalled();
    await expect(fs.access(getPidPath(session))).resolves.toBeUndefined();
    await expect(fs.access(getLockPath(session))).resolves.toBeUndefined();
    await expect(fs.access(getSocketPath(session))).resolves.toBeUndefined();
  });

  it("stops cleanup when ownership changes between artifact deletions", async () => {
    let foreign = false;
    mockDirectoryOwner(daemonDir, (uid) => (foreign ? uid + 1 : uid));
    const unlink = fs.unlink.bind(fs);
    const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      await unlink(file);
      foreign = true;
    });

    await expect(cleanupDaemonFiles(session)).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_not_owned" },
    });

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
    await expect(fs.readFile(getLockPath(session), "utf8")).resolves.toBe("999999");
  });

  it.each(["stale lock removal", "lock release"])(
    "preserves the lock after ownership loss during %s",
    async (operation) => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      let foreign = false;
      mockDirectoryOwner(daemonDir, (uid) => (foreign ? uid + 1 : uid));
      const lockPath = getLockPath(session);
      if (operation === "stale lock removal") {
        const read = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
          const result = await read(...args);
          if (args[0] === lockPath) foreign = true;
          return result;
        });
      } else {
        await fs.unlink(lockPath);
        // Preserve the owner-mocking implementation rather than the spy itself.
        const open = vi.mocked(fs.open).getMockImplementation()!;
        vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
          const handle = await open(file, flags, mode);
          if (String(file) === lockPath && flags === "wx") {
            const write = handle.write.bind(handle);
            vi.spyOn(handle, "write").mockImplementation(async (...args) => {
              const result = await write(...args);
              foreign = true;
              return result;
            });
          }
          return handle;
        });
      }
      const unlink = vi.spyOn(fs, "unlink");

      await expect(
        ensureDriverDaemon({ session, target: { kind: "remote" } }),
      ).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_not_owned" },
      });

      expect(unlink).not.toHaveBeenCalledWith(lockPath);
      await expect(fs.readFile(lockPath, "utf8")).resolves.toBe(
        operation === "stale lock removal" ? "999999" : String(process.pid),
      );
    },
  );

  it("rejects a symlink before probing its socket or cleaning up its target", async () => {
    const link = join(daemonDir, "link");
    await fs.symlink(daemonDir, link);
    vi.stubEnv("BROWSE_DAEMON_DIR", link);
    const connect = vi.spyOn(net, "createConnection");

    await expect(getDriverStatus(session)).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_invalid" },
    });
    await expect(stopDriverDaemon(session, true)).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_invalid" },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(connections).toBe(0);
    await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
    await expect(fs.access(getSocketPath(session))).resolves.toBeUndefined();
  });

  it("rejects a shared writable parent before any connection or cleanup", async () => {
    await fs.chmod(fixtureDir, 0o777);
    const connect = vi.spyOn(net, "createConnection");
    const unlink = vi.spyOn(fs, "unlink");
    for (const operation of [
      () => getDriverStatus(session),
      () => openViaDaemon(session, "about:blank"),
      () => runDriverCommandViaDaemon(session, "snapshot"),
      () => stopDriverDaemon(session, true),
      () => resolveTargetForCommand(session, { local: true }),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_unsafe_parent" },
      });
    }
    expect(connect).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(connections).toBe(0);
    await expect(fs.access(getSocketPath(session))).resolves.toBeUndefined();
  });

  it.each([
    { operation: "status", validChecks: 1 },
    { operation: "forced stop", validChecks: 2 },
  ])("propagates unsafe parent errors during $operation", async ({ operation, validChecks }) => {
    const lstat = fs.lstat.bind(fs);
    let remainingChecks = validChecks;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      const entry = await lstat(...args);
      if (args[0] === fixtureDir && remainingChecks-- <= 0) entry.mode |= 0o022;
      return entry;
    });
    const unlink = vi.spyOn(fs, "unlink");
    await expect(
      operation === "status" ? getDriverStatus(session) : stopDriverDaemon(session, true),
    ).rejects.toMatchObject({ telemetry: { resultCode: "daemon_dir_unsafe_parent" } });
    expect(unlink).not.toHaveBeenCalled();
    await expect(fs.readFile(getPidPath(session), "utf8")).resolves.toBe("999999");
    await expect(fs.readFile(getLockPath(session), "utf8")).resolves.toBe("999999");
  });

  it("still reads status from a daemon in an owned directory", async () => {
    await expect(getDriverStatus(session)).resolves.toMatchObject({
      session,
      target: { kind: "managed-local", headless: true },
    });
    expect(connections).toBe(2);
    expect(requests).toHaveLength(1);
  });
});
