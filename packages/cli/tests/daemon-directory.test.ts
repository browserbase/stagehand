import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describePosix } from "./helpers/platform.js";
import { resolveTargetForCommand } from "../src/lib/driver/command-cli.js";
import {
  getDriverStatus,
  openViaDaemon,
  runDriverCommandViaDaemon,
  stopDriverDaemon,
} from "../src/lib/driver/daemon/client.js";
import { getLockPath, getPidPath, getSocketPath } from "../src/lib/driver/daemon/paths.js";

// Use a real listening socket: these tests must detect both bare connectivity
// probes and requests that could forward credentials to an untrusted daemon.
describePosix("daemon directory validation before connections", () => {
  const session = "default";
  const sockets = new Set<net.Socket>();
  let daemonDir: string;
  let server: net.Server;
  let connections: number;
  let requests: string[];

  beforeEach(async () => {
    daemonDir = await fs.mkdtemp(join(tmpdir(), "browse-dir-"));
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
    if (daemonDir) await fs.rm(daemonDir, { recursive: true, force: true });
  });

  it.each(["unprivileged", "root"])(
    "refuses every client entry point before connecting as %s",
    async (caller) => {
      const entry = await fs.lstat(daemonDir);
      vi.spyOn(process, "getuid").mockReturnValue(caller === "root" ? 0 : entry.uid + 1);
      if (caller === "root" && entry.uid === 0) {
        vi.spyOn(fs, "lstat").mockResolvedValue(Object.assign(entry, { uid: 1 }));
      }
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
      // Simulate ownership changing after the connectivity probe, or after the
      // status reply but before stop. Each new connection must recheck ownership.
      vi.spyOn(process, "getuid").mockImplementation(() => (remainingChecks-- > 0 ? uid : uid + 1));
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

  it("still reads status from a daemon in an owned directory", async () => {
    await expect(getDriverStatus(session)).resolves.toMatchObject({
      session,
      target: { kind: "managed-local", headless: true },
    });
    expect(connections).toBe(2);
    expect(requests).toHaveLength(1);
  });
});
