import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DriverStatus, OpenResult } from "../../src/lib/driver/types.js";
import { runCli } from "../helpers/run-cli.js";

// Build first: pnpm exec turbo run build --filter=browse
// Then: pnpm --filter browse test:smoke (uses CHROME_PATH or local Chrome discovery).
describe("Browse with real Chrome", () => {
  const session = `smoke-${randomUUID().slice(0, 8)}`;
  let directory: string;
  let runtimeDir: string;
  let server: Server | undefined;
  let url: string;
  let daemonPid: number | undefined;

  beforeAll(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "browse smoke-")));
    runtimeDir = join(directory, "daemon");
    await mkdir(runtimeDir, { mode: 0o700 });
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head><title>Browse smoke</title></head>
  <body>
    <h1>Browse smoke</h1>
    <label for="name">Name</label>
    <input id="name" />
    <button onclick="document.querySelector('#result').textContent = 'Hello, ' + document.querySelector('#name').value">Submit</button>
    <p id="result">Waiting</p>
  </body>
</html>`);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server has no port");
    url = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    try {
      if (runtimeDir) {
        await cli(["stop"], 15_000);
        await waitForShutdown();
      }
    } finally {
      try {
        if (server) {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
          });
        }
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("opens, interacts through separate CLI processes, stops, and restarts the same session", async () => {
    expect(await cli(["status"])).toMatchObject({
      browserConnected: false,
      initialized: false,
      session,
    });

    expect(await open()).toMatchObject({
      mode: "managed-local",
      session,
      title: "Browse smoke",
      url,
    });
    const initial = await cli<DriverStatus>(["status"]);
    daemonPid = initial.pid;
    expect(initial).toMatchObject({
      browserConnected: true,
      initialized: true,
      target: { kind: "managed-local", headless: true },
      url,
    });
    expect(daemonPid).toBeGreaterThan(0);

    const snapshot = await cli<{ tree: string }>(["snapshot"]);
    expect(snapshot.tree).toContain("Name");
    // Use a real snapshot ref in a later process to exercise the daemon's ref cache.
    const buttonLine = snapshot.tree.split("\n").find((line) => line.includes("Submit"));
    const buttonRef = buttonLine?.match(/\[(\d+-\d+)\]/)?.[1];
    expect(buttonRef, snapshot.tree).toBeDefined();

    expect(await cli(["fill", "#name", "Browse user"])).toMatchObject({ filled: true });
    expect(await cli(["get", "value", "#name"])).toEqual({ value: "Browse user" });
    expect(await cli(["click", `@${buttonRef}`])).toMatchObject({ clicked: true });
    expect(await cli(["get", "text", "#result"])).toEqual({ text: "Hello, Browse user" });
    expect((await cli<{ tree: string }>(["snapshot"])).tree).toContain("Hello, Browse user");

    const reused = await cli<DriverStatus>(["status"]);
    expect(reused.pid).toBe(initial.pid);
    expect(reused.selectedTargetId).toBe(initial.selectedTargetId);

    expect(await cli(["stop"])).toMatchObject({ stopped: true, session });
    // Observe cleanup before calling status, which can itself remove stale files.
    await waitForShutdown();
    expect(await cli(["status"])).toMatchObject({ browserConnected: false, initialized: false });

    expect(await open()).toMatchObject({ title: "Browse smoke", url });
    const restarted = await cli<DriverStatus>(["status"]);
    daemonPid = restarted.pid;
    expect(restarted.pid).not.toBe(initial.pid);
    expect(restarted).toMatchObject({ browserConnected: true, initialized: true });
    expect(await cli(["get", "value", "#name"])).toEqual({ value: "" });
    expect(await cli(["get", "text", "#result"])).toEqual({ text: "Waiting" });

    expect(await cli(["stop"])).toMatchObject({ stopped: true });
    await waitForShutdown();
  });

  function open(): Promise<OpenResult> {
    return cli(["open", url, "--local", "--headless"], 100_000);
  }

  async function cli<T = unknown>(args: string[], timeoutMs = 40_000): Promise<T> {
    const result = await runCli([...args, "--session", session], {
      cwd: directory,
      timeoutMs,
      env: {
        BROWSE_DAEMON_DIR: runtimeDir,
        BROWSE_LOAD_DOTENV: "0",
        BROWSERBASE_API_KEY: undefined,
        BROWSERBASE_CONFIG_DIR: join(directory, "config"),
        BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: join(directory, "install-id"),
        DO_NOT_TRACK: "1",
      },
    });
    expect(
      result.exitCode,
      `browse ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
    return JSON.parse(result.stdout) as T;
  }

  async function waitForShutdown(): Promise<void> {
    await vi.waitFor(
      async () => {
        expect(await readdir(runtimeDir)).toEqual([]);
        if (daemonPid !== undefined) expect(isProcessAlive(daemonPid)).toBe(false);
      },
      { timeout: 15_000, interval: 100 },
    );
  }
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
