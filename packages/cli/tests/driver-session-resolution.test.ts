import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CommandFailure } from "../src/lib/errors.js";
import { listRunningSessions } from "../src/lib/driver/daemon/client.js";
import {
  getPidPath,
  getSocketPath,
  sanitizeSessionName,
} from "../src/lib/driver/daemon/paths.js";
import {
  generateSessionName,
  resolveSession,
} from "../src/lib/driver/flags.js";
import type { DriverStatus } from "../src/lib/driver/types.js";
import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) await close();
  }
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
  delete process.env.BROWSE_SESSION;
});

describe("generateSessionName", () => {
  it("produces sess-<8 hex chars> names that already satisfy sanitizeSessionName's identity fast path", () => {
    const name = generateSessionName();
    expect(name).toMatch(/^sess-[a-f0-9]{8}$/);
    // Round-trips unchanged through the daemon file-path sanitizer -- no
    // hash suffix gets appended.
    expect(sanitizeSessionName(name)).toBe(name);
  });

  it("generates unique names across many calls", () => {
    const names = new Set(
      Array.from({ length: 500 }, () => generateSessionName()),
    );
    expect(names.size).toBe(500);
  });
});

describe("listRunningSessions", () => {
  it("returns an empty list when the runtime dir does not exist", async () => {
    const daemonDir = join(await tempDaemonDir(), "does-not-exist");
    await withDaemonDir(daemonDir, async () => {
      await expect(listRunningSessions()).resolves.toEqual([]);
    });
  });

  it("returns an empty list when there are no pid files", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      await expect(listRunningSessions()).resolves.toEqual([]);
    });
  });

  it("discovers a live session via its .pid file, not its .sock file", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const session = "live-one";
      const status = fakeStatus(session, "https://example.com");
      await startFakeDaemon(session, status);
      await writeFile(getPidPath(session), String(process.pid));

      const running = await listRunningSessions();
      expect(running).toEqual([{ session, status }]);
    });
  });

  it("drops dead daemons and self-heals their stale files", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const session = "stale-one";
      // A .pid file with no daemon actually listening on the socket.
      await writeFile(getPidPath(session), "999999");

      await expect(listRunningSessions()).resolves.toEqual([]);
    });
  });

  it("returns every live session when multiple are running", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const statusA = fakeStatus("multi-a", "https://example.com");
      const statusB = fakeStatus("multi-b", "https://example.org");
      await startFakeDaemon("multi-a", statusA);
      await startFakeDaemon("multi-b", statusB);
      await writeFile(getPidPath("multi-a"), String(process.pid));
      await writeFile(getPidPath("multi-b"), String(process.pid));

      const running = await listRunningSessions();
      expect(
        running.sort((a, b) => a.session.localeCompare(b.session)),
      ).toEqual([
        { session: "multi-a", status: statusA },
        { session: "multi-b", status: statusB },
      ]);
    });
  });
});

describe("resolveSession", () => {
  it("returns an explicit --session value as-is for role open, without generating", async () => {
    await expect(resolveSession("explicit-name", "open")).resolves.toEqual({
      session: "explicit-name",
    });
  });

  it("returns an explicit --session value as-is for role attach, bypassing running-session resolution entirely", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      // Two running sessions would normally be ambiguous -- but an explicit
      // --session must skip the lookup altogether and never even consider
      // them.
      await startFakeDaemon("amb-a", fakeStatus("amb-a", "https://a.example"));
      await startFakeDaemon("amb-b", fakeStatus("amb-b", "https://b.example"));
      await writeFile(getPidPath("amb-a"), String(process.pid));
      await writeFile(getPidPath("amb-b"), String(process.pid));

      await expect(
        resolveSession("not-running-yet", "attach"),
      ).resolves.toEqual({ session: "not-running-yet" });
    });
  });

  it("falls back to BROWSE_SESSION when no explicit flag value is given", async () => {
    process.env.BROWSE_SESSION = "from-env";
    await expect(resolveSession(undefined, "open")).resolves.toEqual({
      session: "from-env",
    });
    await expect(resolveSession(undefined, "attach")).resolves.toEqual({
      session: "from-env",
    });
  });

  it("generates a fresh session for role open with no explicit session", async () => {
    const resolved = await resolveSession(undefined, "open");
    expect(resolved.generated).toBe(true);
    expect(resolved.session).toMatch(/^sess-[a-f0-9]{8}$/);
    expect(resolved.status).toBeUndefined();
  });

  it("fails with no_running_session when nothing is running for role attach", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const error = await resolveSession(undefined, "attach").catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CommandFailure);
      const failure = error as CommandFailure;
      expect(failure.message).toBe(
        "No running browser session. Start one with browse open <url>.",
      );
      expect(failure.telemetry).toMatchObject({
        resultCode: "no_running_session",
      });
    });
  });

  it("attaches to the single running session for role attach", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const status = fakeStatus("only-one", "https://example.com");
      await startFakeDaemon("only-one", status);
      await writeFile(getPidPath("only-one"), String(process.pid));

      await expect(resolveSession(undefined, "attach")).resolves.toEqual({
        session: "only-one",
        status,
      });
    });
  });

  it("fails with ambiguous_session listing every candidate's name and URL", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      await startFakeDaemon(
        "ambiguous-a",
        fakeStatus("ambiguous-a", "https://a.example"),
      );
      await startFakeDaemon(
        "ambiguous-b",
        fakeStatus("ambiguous-b", "https://b.example"),
      );
      await writeFile(getPidPath("ambiguous-a"), String(process.pid));
      await writeFile(getPidPath("ambiguous-b"), String(process.pid));

      const error = await resolveSession(undefined, "attach").catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CommandFailure);
      const failure = error as CommandFailure;
      expect(failure.telemetry).toMatchObject({
        resultCode: "ambiguous_session",
      });
      expect(failure.message).toContain("ambiguous-a — https://a.example");
      expect(failure.message).toContain("ambiguous-b — https://b.example");
      expect(failure.message).toContain("Pass --session <name> to choose.");
    });
  });
});

describe("CLI: sessionless resolution end-to-end", () => {
  it("status fails with no_running_session when nothing is running and no --session is given", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["status"], {
      env: { BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "No running browser session. Start one with browse open <url>.",
    );
  });

  it("status succeeds against an explicit --session even when zero sessions are running", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["status", "--session", "explicit-empty"], {
      env: { BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      browserConnected: false,
      session: "explicit-empty",
    });
  });

  it("status resolves automatically to the single running session", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      const status = fakeStatus("cli-only-one", "https://example.com");
      await startFakeDaemon("cli-only-one", status);
      await writeFile(getPidPath("cli-only-one"), String(process.pid));

      const result = await runCli(["status"], {
        env: { BROWSE_DAEMON_DIR: daemonDir },
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        session: "cli-only-one",
        url: "https://example.com",
      });
    });
  });

  it("status fails with ambiguous_session when two sessions are running and no --session is given", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      await startFakeDaemon(
        "cli-amb-a",
        fakeStatus("cli-amb-a", "https://a.example"),
      );
      await startFakeDaemon(
        "cli-amb-b",
        fakeStatus("cli-amb-b", "https://b.example"),
      );
      await writeFile(getPidPath("cli-amb-a"), String(process.pid));
      await writeFile(getPidPath("cli-amb-b"), String(process.pid));

      const result = await runCli(["status"], {
        env: { BROWSE_DAEMON_DIR: daemonDir },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Multiple running sessions:");
      expect(result.stderr).toContain("cli-amb-a — https://a.example");
      expect(result.stderr).toContain("cli-amb-b — https://b.example");
      expect(result.stderr).toContain("Pass --session <name> to choose.");
    });
  });

  it("status resolves the requested session explicitly even when ambiguous overall", async () => {
    const daemonDir = await tempDaemonDir();
    await withDaemonDir(daemonDir, async () => {
      await startFakeDaemon(
        "explicit-amb-a",
        fakeStatus("explicit-amb-a", "https://a.example"),
      );
      await startFakeDaemon(
        "explicit-amb-b",
        fakeStatus("explicit-amb-b", "https://b.example"),
      );
      await writeFile(getPidPath("explicit-amb-a"), String(process.pid));
      await writeFile(getPidPath("explicit-amb-b"), String(process.pid));

      const result = await runCli(["status", "--session", "explicit-amb-a"], {
        env: { BROWSE_DAEMON_DIR: daemonDir },
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        session: "explicit-amb-a",
        url: "https://a.example",
      });
    });
  });
});

function fakeStatus(session: string, url: string): DriverStatus {
  return {
    browserConnected: true,
    initialized: true,
    mode: "managed-local",
    pages: [{ index: 0, url }],
    pid: 12345,
    session,
    target: { headless: true, kind: "managed-local" },
    url,
  };
}

async function startFakeDaemon(
  session: string,
  status: DriverStatus,
): Promise<void> {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline)) as { id: string };
      socket.end(
        `${JSON.stringify({ data: status, id: request.id, type: "success" })}\n`,
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(getSocketPath(session), resolve);
  });

  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );
}

async function tempDaemonDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "browse-session-resolution-"));
  cleanupPaths.push(dir);
  return dir;
}

async function withDaemonDir(
  dir: string,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env.BROWSE_DAEMON_DIR;
  process.env.BROWSE_DAEMON_DIR = dir;
  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSE_DAEMON_DIR;
    } else {
      process.env.BROWSE_DAEMON_DIR = previous;
    }
  }
}
