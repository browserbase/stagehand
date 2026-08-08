import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  quoteForCmdShell,
  shouldUseWindowsShell,
  spawnPassthrough,
} from "../src/lib/skills/install.js";
import { runCli } from "./helpers/run-cli.js";
import { itPosix } from "./helpers/platform.js";

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
  itPosix("installs the bundled browse CLI skill", async () => {
    const stubDir = await createTempDir("browse-skills-install-bin-");
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
    expect(log).toContain("/skills/browse");
    expect(log).toContain("--yes --global --agent *");
  });

  it("uses a shell for Windows command shims", () => {
    expect(shouldUseWindowsShell("C:\\npm\\npx.cmd", "win32")).toBe(true);
    expect(shouldUseWindowsShell("C:\\npm\\npx.bat", "win32")).toBe(true);
    expect(shouldUseWindowsShell("/usr/local/bin/npx", "darwin")).toBe(false);
    expect(shouldUseWindowsShell("C:\\npm\\npx.exe", "win32")).toBe(false);
  });

  itPosix(
    "fails with a timeout message when the npx child hangs past the deadline",
    async () => {
      const stubDir = await createTempDir("browse-skills-timeout-bin-");
      await writeSleepingNpxStub(stubDir);

      const result = await runCli(["skills", "install"], {
        env: {
          PATH: stubDir,
          BROWSE_SKILLS_INSTALL_TIMEOUT_MS: "1000",
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Skill install timed out after 1s");
    },
  );

  itPosix(
    "falls back to the GitHub installer when the catalog fetch hangs",
    async () => {
      const stubDir = await createTempDir("browse-skills-hang-bin-");
      const logPath = join(stubDir, "npx.log");
      await writeNpxStub(stubDir);
      const { server, baseUrl } = await startHangingServer();
      cleanupServers.push(server);

      const result = await runCli(
        ["skills", "add", "airline.example/book-flight-ab12cd"],
        {
          env: {
            BB_STUB_LOG: logPath,
            BROWSE_SKILLS_API_BASE_URL: baseUrl,
            BROWSE_SKILLS_BLOB_BASE_URL: baseUrl,
            BROWSE_SKILLS_FETCH_TIMEOUT_MS: "500",
            PATH: stubDir,
          },
        },
      );

      expect(result.exitCode).toBe(0);
      await expect(readFile(logPath, "utf8")).resolves.toContain(
        "--yes skills add browserbase/browse.sh --skill airline.example/book-flight-ab12cd",
      );
    },
  );
});

describe("quoteForCmdShell", () => {
  it("leaves plain tokens untouched", () => {
    expect(quoteForCmdShell("npx")).toBe("npx");
    expect(quoteForCmdShell("--yes")).toBe("--yes");
    expect(quoteForCmdShell("browserbase/browse.sh")).toBe(
      "browserbase/browse.sh",
    );
    expect(quoteForCmdShell("C:\\nodejs\\npx.cmd")).toBe("C:\\nodejs\\npx.cmd");
  });

  it("quotes the default Windows Node install path", () => {
    expect(quoteForCmdShell("C:\\Program Files\\nodejs\\npx.cmd")).toBe(
      '"C:\\Program Files\\nodejs\\npx.cmd"',
    );
  });

  it("quotes install paths with spaces", () => {
    expect(
      quoteForCmdShell("C:\\Users\\First Last\\.config\\browserbase\\skill"),
    ).toBe('"C:\\Users\\First Last\\.config\\browserbase\\skill"');
  });

  it("doubles embedded quotes", () => {
    expect(quoteForCmdShell('say "hi" now')).toBe('"say ""hi"" now"');
  });

  it("quotes cmd metacharacters", () => {
    expect(quoteForCmdShell("a&b")).toBe('"a&b"');
    expect(quoteForCmdShell("a|b")).toBe('"a|b"');
    expect(quoteForCmdShell("a^b")).toBe('"a^b"');
    expect(quoteForCmdShell("a<b")).toBe('"a<b"');
    expect(quoteForCmdShell("a>b")).toBe('"a>b"');
  });

  it("quotes the empty token", () => {
    expect(quoteForCmdShell("")).toBe('""');
  });

  it("builds an intact cmd.exe command line for a default Windows install", () => {
    const command = "C:\\Program Files\\nodejs\\npx.cmd";
    const args = [
      "--yes",
      "skills",
      "add",
      "C:\\Users\\First Last\\.config\\browserbase\\skills\\x\\y",
    ];

    // Before the fix Node joined the tokens unquoted, so cmd.exe split the
    // command at the space and executed `C:\Program` ("'C:\Program' is not
    // recognized as an internal or external command").
    const unquoted = [command, ...args].join(" ");
    expect(unquoted).toContain("C:\\Program Files\\");
    expect(unquoted.startsWith('"')).toBe(false);

    const quoted = [command, ...args].map(quoteForCmdShell).join(" ");
    expect(quoted).toBe(
      '"C:\\Program Files\\nodejs\\npx.cmd" --yes skills add "C:\\Users\\First Last\\.config\\browserbase\\skills\\x\\y"',
    );
  });
});

describe("spawnPassthrough", () => {
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
    const result = await spawnPassthrough(
      process.execPath,
      ["-e", "process.exit(0);"],
      30_000,
    );

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
  const stubPath = join(stubDir, "npx");
  await writeFile(
    stubPath,
    ["#!/bin/sh", 'printf \'%s\\n\' "$*" >> "$BB_STUB_LOG"', "exit 0", ""].join(
      "\n",
    ),
  );
  await chmod(stubPath, 0o755);
}

async function writeSleepingNpxStub(stubDir: string): Promise<void> {
  const stubPath = join(stubDir, "npx");
  // PATH is stripped to the stub dir in these tests, so use an absolute path.
  await writeFile(
    stubPath,
    ["#!/bin/sh", "exec /bin/sleep 600", ""].join("\n"),
  );
  await chmod(stubPath, 0o755);
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
