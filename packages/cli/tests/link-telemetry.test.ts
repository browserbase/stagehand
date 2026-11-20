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

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

describe("link telemetry", () => {
  describe("cli.link_opened", () => {
    it("emits cli.link_opened for browse discord --no-open", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-link-discord-");
        const result = await runCli(["discord", "--no-open"], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        expect(result.exitCode).toBe(0);

        const payloads = telemetryPayloads(telemetryServer);
        const linkOpenedPayload = findPayload(payloads, "cli.link_opened");

        expect(linkOpenedPayload.properties.target).toBe("discord");
        expect(linkOpenedPayload.properties.source).toBe("discord_command");
        expect(linkOpenedPayload.properties.opened).toBe(false);
        expect(linkOpenedPayload.properties.browser_open_succeeded).toBe(true);
        expect(linkOpenedPayload.properties.$process_person_profile).toBe(false);
      } finally {
        await telemetryServer.close();
      }
    });

    it("emits cli.link_opened for browse issues --no-open", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-link-issues-");
        const result = await runCli(["issues", "--no-open"], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        expect(result.exitCode).toBe(0);

        const payloads = telemetryPayloads(telemetryServer);
        const linkOpenedPayload = findPayload(payloads, "cli.link_opened");

        expect(linkOpenedPayload.properties.target).toBe("github_issues");
        expect(linkOpenedPayload.properties.source).toBe("issues_command");
        expect(linkOpenedPayload.properties.opened).toBe(false);
        expect(linkOpenedPayload.properties.browser_open_succeeded).toBe(true);
      } finally {
        await telemetryServer.close();
      }
    });

    it("emits cli.link_opened for browse bug --no-open (alias)", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-link-bug-");
        const result = await runCli(["bug", "--no-open"], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        expect(result.exitCode).toBe(0);

        const payloads = telemetryPayloads(telemetryServer);
        const linkOpenedPayload = findPayload(payloads, "cli.link_opened");

        expect(linkOpenedPayload.properties.target).toBe("github_issues");
        expect(linkOpenedPayload.properties.source).toBe("issues_command");
      } finally {
        await telemetryServer.close();
      }
    });
  });

  describe("cli.help_links_shown", () => {
    it("emits cli.help_links_shown for root help", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-help-footer-");
        const result = await runCli(["--help"], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("COMMUNITY");

        const payloads = telemetryPayloads(telemetryServer);
        const helpLinksPayload = findPayload(payloads, "cli.help_links_shown");

        expect(helpLinksPayload.properties.source).toBe("help_footer");
        expect(helpLinksPayload.properties.result_code).toBe(null);
        expect(helpLinksPayload.properties.error_type).toBe(null);
        expect(helpLinksPayload.properties.$process_person_profile).toBe(false);
      } finally {
        await telemetryServer.close();
      }
    });

    it("emits cli.help_links_shown for bare browse invocation", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-help-bare-");
        const result = await runCli([], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("COMMUNITY");

        const payloads = telemetryPayloads(telemetryServer);
        const helpLinksPayload = findPayload(payloads, "cli.help_links_shown");

        expect(helpLinksPayload.properties.source).toBe("help_footer");
      } finally {
        await telemetryServer.close();
      }
    });

    it("does not double-emit cli.help_links_shown in one invocation", async () => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-help-double-");
        await runCli(["--help"], {
          env: telemetryEnv(telemetryServer, installIdFile),
        });

        const payloads = telemetryPayloads(telemetryServer);
        const helpLinksPayloads = payloads.filter((p) => p.event === "cli.help_links_shown");

        expect(helpLinksPayloads).toHaveLength(1);
      } finally {
        await telemetryServer.close();
      }
    });
  });

  describe("UTM params", () => {
    it("includes UTM params in GitHub issues URL for help footer", async () => {
      const result = await runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("utm_source=browse_cli");
      expect(result.stdout).toContain("utm_medium=help_footer");
    });

    it("includes UTM params in GitHub issues URL for browse issues", async () => {
      const result = await runCli(["issues", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("utm_source=browse_cli");
      expect(result.stdout).toContain("utm_medium=issues_command");
    });

    it("does not add UTM params to Discord URL (would break invite)", async () => {
      const result = await runCli(["discord", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("https://discord.gg/stagehand");
      expect(result.stdout).not.toContain("discord.gg/stagehand?");
    });
  });

  describe("telemetry opt-out", () => {
    it.each([
      { label: "DO_NOT_TRACK", env: { DO_NOT_TRACK: "1" } },
      {
        label: "BROWSERBASE_TELEMETRY_DISABLED",
        env: { BROWSERBASE_TELEMETRY_DISABLED: "1" },
      },
      { label: "CI", env: { CI: "1" } },
    ])("does not emit link telemetry when disabled via $label", async ({ env }) => {
      const telemetryServer = await startTelemetryServer();

      try {
        const installIdFile = await tempInstallIdFile("browse-link-disabled-");
        await runCli(["discord", "--no-open"], {
          env: {
            ...telemetryEnv(telemetryServer, installIdFile),
            ...env,
          },
        });

        const payloads = telemetryPayloads(telemetryServer);
        const linkPayloads = payloads.filter((p) => p.event === "cli.link_opened");
        expect(linkPayloads).toHaveLength(0);
      } finally {
        await telemetryServer.close();
      }
    });
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
    AI_AGENT: "",
    ANTIGRAVITY_AGENT: "",
    AUGMENT_AGENT: "",
    BROWSERBASE_API_BASE_URL: undefined,
    BROWSERBASE_API_KEY: undefined,
    BROWSERBASE_BASE_URL: undefined,
    BROWSERBASE_TELEMETRY_HOST: telemetryServer.baseUrl,
    BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: installIdFile,
    CLAUDECODE: "",
    CLAUDE_CODE: "",
    CLAUDE_CODE_IS_COWORK: "",
    CODEX_CI: "",
    CODEX_SANDBOX: "",
    CODEX_THREAD_ID: "",
    COPILOT_ALLOW_ALL: "",
    COPILOT_GITHUB_TOKEN: "",
    COPILOT_MODEL: "",
    CURSOR_AGENT: "",
    CURSOR_EXTENSION_HOST_ROLE: "",
    CURSOR_TRACE_ID: "",
    GEMINI_CLI: "",
    HERMES_SESSION_PLATFORM: "",
    OPENCLAW_SHELL: "",
    OPENCODE_CLIENT: "",
    REPL_ID: "",
    CI: "",
  };
}

function telemetryPayloads(server: FakeBrowserbaseServer): CapturePayload[] {
  return server.requests
    .filter((request) => request.path === "/i/v0/e/")
    .map((request) => asCapturePayload(request.jsonBody));
}

function asCapturePayload(body: unknown): CapturePayload {
  if (!body || typeof body !== "object") {
    throw new Error("Expected telemetry payload JSON body.");
  }

  const payload = body as {
    api_key?: string;
    distinct_id?: string;
    event?: string;
    properties?: Record<string, unknown>;
  };

  return {
    api_key: payload.api_key,
    distinct_id: payload.distinct_id,
    event: payload.event,
    properties: payload.properties ?? {},
  };
}

function findPayload(payloads: CapturePayload[], event: string): CapturePayload {
  const payload = payloads.find((candidate) => candidate.event === event);
  if (!payload) {
    throw new Error(`Missing telemetry payload for event "${event}".`);
  }
  return payload;
}

async function tempInstallIdFile(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return join(directory, "telemetry-id");
}

interface CapturePayload {
  api_key?: string;
  distinct_id?: string;
  event?: string;
  properties: Record<string, unknown>;
}
