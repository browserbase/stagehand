import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { createConnectionMock, spawnMock } = vi.hoisted(() => {
  let connectionAttempt = 0;

  return {
    createConnectionMock: vi.fn(() => {
      const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      const attempt = connectionAttempt++;
      queueMicrotask(() => {
        if (attempt < 2) {
          const error = Object.assign(new Error("socket missing"), {
            code: "ENOENT",
          });
          socket.emit("error", error);
          return;
        }
        socket.emit("connect");
      });
      return socket;
    }),
    spawnMock: vi.fn(() => ({ unref: vi.fn() })),
  };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:net", () => ({
  createConnection: createConnectionMock,
  default: { createConnection: createConnectionMock },
}));

import { ensureDriverDaemon } from "../src/lib/driver/daemon/client.js";

const cleanupPaths: string[] = [];
const originalDaemonDir = process.env.BROWSE_DAEMON_DIR;

afterEach(async () => {
  if (originalDaemonDir === undefined) {
    delete process.env.BROWSE_DAEMON_DIR;
  } else {
    process.env.BROWSE_DAEMON_DIR = originalDaemonDir;
  }
  vi.clearAllMocks();
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe("driver daemon startup", () => {
  it("hides the detached daemon process window on Windows", async () => {
    const daemonDir = await mkdtemp(join(tmpdir(), "browse-daemon-spawn-"));
    cleanupPaths.push(daemonDir);
    process.env.BROWSE_DAEMON_DIR = daemonDir;

    await ensureDriverDaemon({
      session: "default",
      target: { kind: "auto-connect" },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.any(String),
        "daemon",
        "--session",
        "default",
        "--target",
        JSON.stringify({ kind: "auto-connect" }),
      ],
      expect.objectContaining({
        detached: true,
        env: process.env,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(createConnectionMock).toHaveBeenCalledTimes(3);
  });
});
