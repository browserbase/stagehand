import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  jsonResponse,
  startFakeBrowserbaseServer,
  textResponse,
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

describe("CLI telemetry", () => {
  it("emits invoked and completed events for successful commands", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile(
        "browse-telemetry-success-",
      );
      const result = await runCli(["status"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });

      expect(result.exitCode).toBe(0);

      const payloads = telemetryPayloads(telemetryServer);
      expect(payloads).toHaveLength(2);
      expect(
        payloads.every(
          (payload) => payload.properties.$process_person_profile === false,
        ),
      ).toBe(true);

      const invokedPayload = findPayload(payloads, "cli.command_invoked");
      const completedPayload = findPayload(payloads, "cli.command_completed");

      expect(typeof invokedPayload.api_key).toBe("string");
      expect(invokedPayload.api_key).not.toHaveLength(0);
      expect(invokedPayload.properties.agent).toBe(null);
      expect(invokedPayload.properties.source).toBe("cli");
      expect(invokedPayload.properties.command_path).toBe("status");
      expect(invokedPayload.properties.top_level_command).toBe("status");
      expect(invokedPayload.properties.leaf_command).toBe("status");

      expect(completedPayload.properties.command_path).toBe("status");
      expect(completedPayload.properties.agent).toBe(null);
      expect(completedPayload.properties.exit_code).toBe(0);
      expect(completedPayload.properties.success).toBe(true);
      expect(completedPayload.properties.error_type).toBe(null);
      expect(completedPayload.properties.error_code).toBe(null);
      expect(completedPayload.properties.result_code).toBe("ok");
      expect(completedPayload.properties.http_status).toBe(null);
      expect(completedPayload.properties.request_had_http_response).toBe(null);
    } finally {
      await telemetryServer.close();
    }
  });

  it.each([
    {
      agent: "hermes",
      env: {
        HERMES_SESSION_PLATFORM: "telegram",
        CLAUDECODE: "1",
        CODEX_THREAD_ID: "",
        CODEX_CI: "",
      },
    },
    {
      agent: "codex",
      env: {
        CLAUDECODE: "",
        CLAUDE_CODE: "",
        CURSOR_TRACE_ID: "",
        CURSOR_AGENT: "",
        CODEX_THREAD_ID: "019dbcc0-587f-7ae0-94be-79ea21d5e8f3",
      },
    },
  ])("tags telemetry with agent=$agent", async ({ agent, env }) => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile(
        `browse-telemetry-agent-${agent}-`,
      );
      const result = await runCli(["status"], {
        env: {
          ...telemetryEnv(telemetryServer, installIdFile),
          ...env,
        },
      });

      expect(result.exitCode).toBe(0);

      const payloads = telemetryPayloads(telemetryServer);
      expect(payloads).toHaveLength(2);
      expect(
        payloads.every((payload) => payload.properties.agent === agent),
      ).toBe(true);
    } finally {
      await telemetryServer.close();
    }
  });

  it("emits completion telemetry for oclif parse failures without raw args", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile("browse-telemetry-parse-");
      const result = await runCli(
        ["cloud", "search", "sensitive search phrase", "--num-results", "999"],
        { env: telemetryEnv(telemetryServer, installIdFile) },
      );

      expect(result.exitCode).not.toBe(0);

      const payloads = telemetryPayloads(telemetryServer);
      const completedPayload = findPayload(payloads, "cli.command_completed");
      expect(completedPayload.properties.command_path).toBe("cloud.search");
      expect(completedPayload.properties.top_level_command).toBe("cloud");
      expect(completedPayload.properties.leaf_command).toBe("search");
      expect(completedPayload.properties.exit_code).not.toBe(0);
      expect(completedPayload.properties.success).toBe(false);
      expect(completedPayload.properties.error_type).toBe("oclif");
      expect(typeof completedPayload.properties.error_code).toBe("string");
      expect(completedPayload.properties.result_code).toBe("usage_error");
      expect(completedPayload.properties.http_status).toBe(null);
      expect(completedPayload.properties.request_had_http_response).toBe(null);
      expect(JSON.stringify(payloads)).not.toContain("sensitive search phrase");
    } finally {
      await telemetryServer.close();
    }
  });

  it("records missing API key failures without an HTTP response", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile(
        "browse-telemetry-missing-key-",
      );
      const result = await runCli(["cloud", "search", "test query"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Missing Browserbase API key");

      const payloads = telemetryPayloads(telemetryServer);
      const completedPayload = findPayload(payloads, "cli.command_completed");
      expect(completedPayload.properties.command_path).toBe("cloud.search");
      expect(completedPayload.properties.exit_code).toBe(1);
      expect(completedPayload.properties.success).toBe(false);
      expect(completedPayload.properties.error_type).toBe("runtime");
      expect(completedPayload.properties.error_code).toBe("COMMAND_FAILURE");
      expect(completedPayload.properties.result_code).toBe("missing_api_key");
      expect(completedPayload.properties.http_status).toBe(null);
      expect(completedPayload.properties.request_had_http_response).toBe(false);
    } finally {
      await telemetryServer.close();
    }
  });

  it("preserves runtime failure classification through command-friendly errors", async () => {
    const telemetryServer = await startTelemetryServer();
    const apiServer = await startFakeBrowserbaseServer((_request, response) => {
      textResponse(response, 500, "super secret upstream detail");
    });

    try {
      const installIdFile = await tempInstallIdFile(
        "browse-telemetry-runtime-",
      );
      const result = await runCli(
        ["cloud", "search", "sensitive search phrase"],
        {
          env: {
            ...telemetryEnv(telemetryServer, installIdFile),
            BROWSERBASE_API_KEY: "bb_test",
            BROWSERBASE_BASE_URL: apiServer.baseUrl,
          },
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("super secret upstream detail");

      const payloads = telemetryPayloads(telemetryServer);
      const completedPayload = findPayload(payloads, "cli.command_completed");
      expect(completedPayload.properties.command_path).toBe("cloud.search");
      expect(completedPayload.properties.exit_code).toBe(1);
      expect(completedPayload.properties.success).toBe(false);
      expect(completedPayload.properties.error_type).toBe("runtime");
      expect(completedPayload.properties.error_code).toBe("COMMAND_FAILURE");
      expect(completedPayload.properties.result_code).toBe(
        "search_internal_error",
      );
      expect(completedPayload.properties.http_status).toBe(500);
      expect(completedPayload.properties.request_had_http_response).toBe(true);
      expect(JSON.stringify(payloads)).not.toContain(
        "super secret upstream detail",
      );
      expect(JSON.stringify(payloads)).not.toContain("sensitive search phrase");
    } finally {
      await apiServer.close();
      await telemetryServer.close();
    }
  });

  it("does not emit telemetry for help and topic-help paths", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile("browse-telemetry-help-");
      const rootHelp = await runCli(["--help"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });
      const topicHelp = await runCli(["cloud"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });

      expect(rootHelp.exitCode).toBe(0);
      expect(topicHelp.exitCode).toBe(0);
      expect(telemetryPayloads(telemetryServer)).toHaveLength(0);
    } finally {
      await telemetryServer.close();
    }
  });

  it.each([
    { label: "DO_NOT_TRACK", env: { DO_NOT_TRACK: "1" } },
    {
      label: "BROWSERBASE_TELEMETRY_DISABLED",
      env: { BROWSERBASE_TELEMETRY_DISABLED: "1" },
    },
    { label: "CI", env: { CI: "1" } },
  ])("does not emit telemetry when disabled via $label", async ({ env }) => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile(
        "browse-telemetry-disabled-",
      );
      const result = await runCli(["status"], {
        env: {
          ...telemetryEnv(telemetryServer, installIdFile),
          ...env,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(telemetryPayloads(telemetryServer)).toHaveLength(0);
      await expect(access(installIdFile)).rejects.toThrow();
    } finally {
      await telemetryServer.close();
    }
  });

  it("reuses a stable anonymous install id across runs", async () => {
    const telemetryServer = await startTelemetryServer();

    try {
      const installIdFile = await tempInstallIdFile("browse-telemetry-stable-");
      const env = telemetryEnv(telemetryServer, installIdFile);
      const firstResult = await runCli(["status"], { env });
      const secondResult = await runCli(["status"], { env });

      expect(firstResult.exitCode).toBe(0);
      expect(secondResult.exitCode).toBe(0);

      const distinctIds = new Set(
        telemetryPayloads(telemetryServer)
          .map((payload) => payload.distinct_id)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
      );

      expect(distinctIds.size).toBe(1);
    } finally {
      await telemetryServer.close();
    }
  });

  it("ignores collector timeouts and preserves command behavior", async () => {
    const telemetryServer = await startFakeBrowserbaseServer(
      async (_request, response) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        jsonResponse(response, 200, { ok: true });
      },
    );

    try {
      const installIdFile = await tempInstallIdFile(
        "browse-telemetry-timeout-",
      );
      const startedAt = Date.now();
      const result = await runCli(["status"], {
        env: {
          ...telemetryEnv(telemetryServer, installIdFile),
          BROWSERBASE_TELEMETRY_TIMEOUT_MS: "50",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
    } finally {
      await telemetryServer.close();
    }
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

function findPayload(
  payloads: CapturePayload[],
  event: string,
): CapturePayload {
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
