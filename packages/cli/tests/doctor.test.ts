import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildDoctorReport } from "../src/lib/driver/doctor.js";
import {
  getLockPath,
  getPidPath,
  getSocketPath,
} from "../src/lib/driver/daemon/paths.js";
import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe("doctor command", () => {
  it("prints help with the discoverable diagnostic flags", async () => {
    const result = await runCli(["doctor", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Diagnose browse driver session");
    expect(result.stdout).toContain("--auto-connect");
    expect(result.stdout).toContain("--cdp=<url|port>");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("browse doctor --session research --json");
  });

  it("emits JSON and exits 0 for the default local preflight", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["doctor", "--json"], {
      env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      verdict: string;
      checks: Array<{ name: string; status: string }>;
    };
    expect(report.verdict).toBe("ok");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "daemon", status: "ok" }),
        expect.objectContaining({ name: "target", status: "ok" }),
        expect.objectContaining({ name: "browser", status: "ok" }),
      ]),
    );
  });

  it("fails human output for remote mode without an API key", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["doctor", "--remote"], {
      env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "[fail] browserbase BROWSERBASE_API_KEY is not set",
    );
    expect(result.stdout).toContain("Fix: export BROWSERBASE_API_KEY=...");
  });

  it("keeps --json exit 0 even when the verdict fails", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["doctor", "--remote", "--json"], {
      env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "browserbase", status: "fail" }),
      ]),
    });
  });

  it("passes remote mode when the API key is present", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["doctor", "--remote", "--json"], {
      env: { BROWSERBASE_API_KEY: "test-key", BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "ok",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "browserbase", status: "ok" }),
      ]),
    });
  });

  it("reports conflicting mode flags as a failed target check", async () => {
    const daemonDir = await tempDaemonDir();
    const result = await runCli(["doctor", "--local", "--remote", "--json"], {
      env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          message: "Pass either --local or --remote, not both.",
          name: "target",
          status: "fail",
        }),
      ]),
    });
  });

  it("resolves an explicit CDP HTTP endpoint", async () => {
    const daemonDir = await tempDaemonDir();
    const server = http.createServer((request, response) => {
      if (request.url === "/json/version") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test",
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });

    try {
      const port = await listen(server);
      const result = await runCli(
        ["doctor", "--cdp", `http://127.0.0.1:${port}`, "--json"],
        {
          env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        verdict: "ok",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "cdp", status: "ok" }),
        ]),
      });
    } finally {
      await close(server);
    }
  });

  it("reports an unresponsive daemon with a force-stop fix", async () => {
    const daemonDir = await tempDaemonDir();
    const session = "stuck";
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;

    try {
      process.env.BROWSE_DAEMON_DIR = daemonDir;
      await writeFile(getPidPath(session), String(process.pid));

      const result = await runCli(["doctor", "--session", session], {
        env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("[fail] daemon");
      expect(result.stdout).toContain(
        "Fix: browse stop --session stuck --force",
      );
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });

  it("warns about a stale daemon lock", async () => {
    const daemonDir = await tempDaemonDir();
    const session = "locked";
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;

    try {
      process.env.BROWSE_DAEMON_DIR = daemonDir;
      await writeFile(getLockPath(session), "999999");

      const result = await runCli(["doctor", "--session", session], {
        env: { BROWSERBASE_API_KEY: "", BROWSE_DAEMON_DIR: daemonDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Status: warn");
      expect(result.stdout).toContain(
        "Fix: browse stop --session locked --force",
      );
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });

  it("fails when requested target conflicts with the running daemon target", async () => {
    const daemonDir = await tempDaemonDir();
    const session = "target-conflict";
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const request = JSON.parse(buffer.slice(0, newline)) as { id: string };
        socket.end(
          JSON.stringify({
            data: {
              browserConnected: true,
              initialized: true,
              mode: "managed-local",
              pages: [],
              pid: process.pid,
              session,
              target: { headless: true, kind: "managed-local" },
            },
            id: request.id,
            type: "success",
          }) + "\n",
        );
      });
    });

    try {
      process.env.BROWSE_DAEMON_DIR = daemonDir;
      await listenSocket(server, getSocketPath(session));
      const result = await runCli(
        ["doctor", "--session", session, "--remote", "--json"],
        {
          env: {
            BROWSERBASE_API_KEY: "test-key",
            BROWSE_DAEMON_DIR: daemonDir,
          },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        verdict: "fail",
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "target",
            status: "fail",
          }),
        ]),
      });
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      await close(server);
    }
  });
});

describe("doctor report builder", () => {
  it("keeps the default session out of status suggestions", async () => {
    const report = await buildDoctorReport(
      {
        flags: {},
        session: "default",
      },
      {
        env: { BROWSERBASE_API_KEY: "" },
        getDriverStatus: async () => ({
          browserConnected: true,
          initialized: true,
          mode: "managed-local",
          pages: [],
          pid: process.pid,
          session: "default",
          target: { headless: true, kind: "managed-local" },
        }),
        readPackageVersion: async () => "0.0.0-test",
      },
    );

    expect(report.next).toBe("browse status");
  });

  it("checks auto-connect discovery through injectable dependencies", async () => {
    const daemonDir = await tempDaemonDir();
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;

    try {
      process.env.BROWSE_DAEMON_DIR = daemonDir;
      const report = await buildDoctorReport(
        {
          flags: { "auto-connect": true },
          session: "default",
        },
        {
          discoverLocalCdp: async () => ({
            source: "DevToolsActivePort:/tmp/profile",
            wsUrl: "ws://127.0.0.1:9222/devtools/browser/test",
          }),
          env: { BROWSERBASE_API_KEY: "" },
          getDriverStatus: async () => null,
          readPackageVersion: async () => "0.0.0-test",
        },
      );

      expect(report).toMatchObject({
        verdict: "ok",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "cdp", status: "ok" }),
        ]),
      });
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
    }
  });
});

async function tempDaemonDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "browse-doctor-test-"));
  cleanupPaths.push(dir);
  return dir;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function listenSocket(server: net.Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
}

function close(server: http.Server | net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
