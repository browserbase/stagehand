import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  aliasSuggestions,
  extractCommandTokens,
  levenshtein,
  suggestCommand,
} from "../src/lib/command-suggestions.js";
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

describe("levenshtein", () => {
  it("computes edit distances", () => {
    expect(levenshtein("open", "open")).toBe(0);
    expect(levenshtein("opne", "open")).toBe(2);
    expect(levenshtein("", "open")).toBe(4);
    expect(levenshtein("open", "")).toBe(4);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("extractCommandTokens", () => {
  it("keeps leading command-shaped tokens and lowercases them", () => {
    expect(extractCommandTokens("auth:status")).toEqual(["auth", "status"]);
    expect(extractCommandTokens("Sessions")).toEqual(["sessions"]);
  });

  it("stops at argument-like tokens", () => {
    expect(extractCommandTokens("opne:https://example.com")).toEqual([
      "opne",
      "https",
    ]);
    expect(extractCommandTokens("--badflag")).toEqual([]);
    expect(extractCommandTokens("fill:#password")).toEqual(["fill"]);
  });

  it("caps the number of tokens", () => {
    expect(extractCommandTokens("a:b:c:d:e:f")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("suggestCommand", () => {
  const commandIds = [
    "open",
    "doctor",
    "status",
    "cloud:search",
    "cloud:sessions:list",
    "cloud:sessions:create",
  ];

  it("prefers explicit aliases over fuzzy matches", () => {
    expect(suggestCommand("sessions", commandIds)).toEqual({
      attempted: "sessions",
      suggestion: "cloud:sessions:list",
    });
    expect(suggestCommand("search:test", commandIds)).toEqual({
      attempted: "search",
      suggestion: "cloud:search",
    });
  });

  it("matches the longest alias prefix first", () => {
    expect(suggestCommand("auth:status", commandIds)).toEqual({
      attempted: "auth:status",
      suggestion: "doctor",
    });
    expect(suggestCommand("auth", commandIds)).toEqual({
      attempted: "auth",
      suggestion: "doctor",
    });
  });

  it("falls back to nearest command by edit distance", () => {
    expect(suggestCommand("opne", commandIds)).toEqual({
      attempted: "opne",
      suggestion: "open",
    });
    expect(suggestCommand("cloud:sesions:list", commandIds)).toEqual({
      attempted: "cloud:sesions:list",
      suggestion: "cloud:sessions:list",
    });
  });

  it("omits suggestions beyond the distance threshold", () => {
    expect(suggestCommand("frobnicate", commandIds)).toEqual({
      attempted: "frobnicate",
      suggestion: null,
    });
  });

  it("never includes trailing argument-like tokens in the attempted command", () => {
    const result = suggestCommand(
      "opne:https://example.com/?token=secret",
      commandIds,
    );
    expect(result.attempted).toBe("opne");
    expect(result.suggestion).toBe("open");

    const noMatch = suggestCommand("frobnicate:somevalue", commandIds);
    expect(noMatch.attempted).toBe("frobnicate");
    expect(noMatch.suggestion).toBe(null);
  });

  it("drops trailing user tokens that do not align with command segments", () => {
    // "stat:s" must not fuzzy-match "status" as a whole string, which would
    // retain the user-provided "s" in the attempted command and telemetry.
    expect(suggestCommand("stat:s", commandIds)).toEqual({
      attempted: "stat",
      suggestion: "status",
    });

    // Per-segment matching still retains tokens that look like command-word
    // typos of the aligned segment.
    expect(suggestCommand("cloud:sessions:lst", commandIds)).toEqual({
      attempted: "cloud:sessions:lst",
      suggestion: "cloud:sessions:list",
    });
  });

  it("handles ids with no command-shaped tokens", () => {
    expect(suggestCommand("--badflag", commandIds)).toEqual({
      attempted: "",
      suggestion: null,
    });
  });
});

describe("alias table", () => {
  it("only maps to commands or topics that exist in the manifest", async () => {
    const manifestRaw = await readFile(
      new URL("../oclif.manifest.json", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as {
      commands: Record<string, unknown>;
    };
    const ids = Object.keys(manifest.commands);

    for (const target of aliasSuggestions.values()) {
      const isCommand = ids.includes(target);
      const isTopic = ids.some((id) => id.startsWith(`${target}:`));
      expect(isCommand || isTopic, `alias target "${target}"`).toBe(true);
    }
  });
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
      const result = await runCli(["auth", "status"], {
        env: telemetryEnv(telemetryServer, installIdFile),
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Did you mean "browse doctor"?');

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
      expect(payload?.properties?.attempted_command).toBe("auth.status");
      expect(payload?.properties?.suggested_command).toBe("doctor");
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
    const result = await runCli(["status"]);

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
