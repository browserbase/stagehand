import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { spawnPassthrough } from "../src/lib/skills/install.js";
import { isProcessAlive } from "../src/lib/driver/daemon/process.js";
import { runCli } from "./helpers/run-cli.js";
import { writeNodeExecutable } from "./helpers/node-executable.js";

const cleanupPaths: string[] = [];
const cleanupServers: Server[] = [];

afterEach(async () => {
  while (cleanupServers.length > 0) {
    const server = cleanupServers.pop();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe("skills install", () => {
  it("installs the bundled browse CLI skill", async () => {
    const stubDir = await createTempDir("browse skills install bin-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir);

    const result = await runCli(["skills", "install"], {
      env: {
        BB_STUB_LOG: logPath,
        PATH: stubDir,
      },
    });

    expect(result.exitCode).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("--yes skills add ");
    expect(log).toContain(join("skills", "browse"));
    expect(log).toContain("--yes --global --agent *");
  });

  it("fails with a timeout message when the npx child hangs past the deadline", async () => {
    const stubDir = await createTempDir("browse-skills-timeout-bin-");
    const pidFile = join(stubDir, "child.pid");
    await writeSleepingNpxStub(stubDir, pidFile);
    const start = Date.now();

    const result = await runCli(["skills", "install"], {
      env: {
        PATH: stubDir,
        BROWSE_SKILLS_INSTALL_TIMEOUT_MS: "1000",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Skill install timed out after 1s");
    expect(Date.now() - start).toBeLessThan(10_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    await expect.poll(() => isProcessAlive(pid), { timeout: 2_000 }).toBe(false);
  });

  it("falls back to the GitHub installer when the catalog fetch hangs", async () => {
    const stubDir = await createTempDir("browse-skills-hang-bin-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir);
    const { server, baseUrl } = await startHangingServer();
    cleanupServers.push(server);

    const result = await runCli(["skills", "add", "airline.example/book-flight-ab12cd"], {
      env: {
        BB_STUB_LOG: logPath,
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
        BROWSE_SKILLS_BLOB_BASE_URL: baseUrl,
        BROWSE_SKILLS_FETCH_TIMEOUT_MS: "500",
        PATH: stubDir,
      },
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(logPath, "utf8")).resolves.toContain(
      "--yes skills add browserbase/browse.sh --skill airline.example/book-flight-ab12cd",
    );
  });
});

describe("spawnPassthrough", () => {
  it.each(["bin with spaces", join("node_modules", ".bin")])(
    "preserves literal arguments through a command shim in %s",
    async (relativeBin) => {
      const root = await createTempDir("browse-spawn-");
      const bin = join(root, relativeBin);
      await mkdir(bin, { recursive: true });
      const log = join(root, "args.json");
      await writeNodeExecutable(
        bin,
        "npx",
        `require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));`,
      );
      const executable = join(bin, process.platform === "win32" ? "npx.cmd" : "npx");
      const args = ["hello world", "a&b", 'say "hi"', "%PATH%", "*", "", "C:\\path with spaces\\"];
      const result = await spawnPassthrough(executable, args, 10_000);
      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      expect(JSON.parse(await readFile(log, "utf8"))).toEqual(args);
    },
  );

  it("kills a hung child after the deadline and reports a timeout", async () => {
    const start = Date.now();
    const result = await spawnPassthrough(
      process.execPath,
      ["-e", "setTimeout(() => {}, 600_000);"],
      500,
    );

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it("does not flag fast children as timed out", async () => {
    const result = await spawnPassthrough(process.execPath, ["-e", "process.exit(0);"], 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

async function writeNpxStub(stubDir: string): Promise<void> {
  await writeNodeExecutable(
    stubDir,
    "npx",
    [
      'const { appendFileSync } = require("node:fs");',
      'appendFileSync(process.env.BB_STUB_LOG, process.argv.slice(2).join(" ") + "\\n");',
    ].join("\n"),
  );
}

async function writeSleepingNpxStub(stubDir: string, pidFile: string): Promise<void> {
  // Exceed the install deadline, but bound the fixture's lifetime even if a
  // Windows shell exits before its Node child. The test must return before
  // this fallback fires, so an orphaned child cannot make the timeout test pass.
  await writeNodeExecutable(
    stubDir,
    "npx",
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 15_000);`,
  );
}

// Accepts connections but never responds, so fetches hang until aborted.
async function startHangingServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer(() => {
    // Intentionally never write a response.
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start hanging server.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}
