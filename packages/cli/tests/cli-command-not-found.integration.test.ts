import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

// Integration coverage: these exercise the built CLI end-to-end (real
// command_not_found hook, real telemetry transport against a dummy server),
// as opposed to the pure-function unit tests in cli-command-not-found.test.ts.

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

describe("command_not_found hook (built CLI)", () => {
  it("prints a did-you-mean suggestion and preserves exit code 2", async () => {
    const result = await runCli(["sessions"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '"browse sessions" is not a browse command. Did you mean "browse cloud sessions list"? Run browse --help for all commands.',
    );
    expect(result.stderr).toContain("command sessions not found");
  });

  it("omits the did-you-mean clause when no decent match exists", async () => {
    const result = await runCli(["frobnicate"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '"browse frobnicate" is not a browse command. Run browse --help for all commands.',
    );
    expect(result.stderr).not.toContain("Did you mean");
  });

  it("emits cli.command_not_found telemetry before the process exits", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile("browse-notfound-");
      const result = await runCli(["sessions", "list"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        'Did you mean "browse cloud sessions list"?',
      );

      const payload = telemetryServer.requests
        .filter((request) => request.path === "/i/v0/e/")
        .map(
          (request) =>
            request.jsonBody as {
              event?: string;
              properties?: Record<string, unknown>;
            },
        )
        .find((body) => body.event === "cli.command_not_found");

      expect(payload).toBeDefined();
      expect(payload?.properties?.attempted_command).toBe("sessions.list");
      expect(payload?.properties?.suggested_command).toBe(
        "cloud.sessions.list",
      );
      expect(payload?.properties?.source).toBe("cli");
    } finally {
      await telemetryServer.close();
    }
  });

  it("never sends raw argv values in not-found telemetry", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile("browse-notfound-priv-");
      const result = await runCli(
        ["opne", "https://example.com/?token=supersecret"],
        { env: telemetryEnv(telemetryServer, installIdFile) },
      );

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Did you mean "browse open"?');

      const serialized = JSON.stringify(
        telemetryServer.requests.map((request) => request.jsonBody),
      );
      expect(serialized).toContain("cli.command_not_found");
      expect(serialized).not.toContain("example.com");
      expect(serialized).not.toContain("supersecret");
    } finally {
      await telemetryServer.close();
    }
  });

  it("does not affect valid commands", async () => {
    const result = await runCli(["status", "--session", "not-found-probe"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("is not a browse command");
  });
});

async function startTelemetryServer(): Promise<FakeBrowserbaseServer> {
  return startFakeBrowserbaseServer((_request, response) => {
    jsonResponse(response, 200, { ok: true });
  });
}

function telemetryEnv(
  telemetryServer: FakeBrowserbaseServer,
  installIdFile: string,
): NodeJS.ProcessEnv {
  return {
    BROWSERBASE_TELEMETRY_HOST: telemetryServer.baseUrl,
    BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: installIdFile,
    CI: "",
  };
}

async function tempInstallIdFile(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return join(directory, "telemetry-id");
}
