import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfig, readConfig } from "../../tui/commands/config.js";

const tempDirs: string[] = [];

function makeTempEntryDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The harness registry is imported lazily by the code under test; its first
// cold import can take seconds when the whole suite runs in parallel.
beforeAll(async () => {
  await import("../../framework/benchHarness.js");
}, 60_000);

describe("readConfig", () => {
  it("throws on malformed evals.config.json instead of treating it as empty", () => {
    const entryDir = makeTempEntryDir();
    fs.writeFileSync(
      path.join(entryDir, "evals.config.json"),
      '{ "defaults": { "env": "local", } }',
    );

    expect(() => readConfig(entryDir)).toThrow(/Invalid JSON/);
  });

  it("throws on missing evals.config.json", () => {
    const entryDir = makeTempEntryDir();
    expect(() => readConfig(entryDir)).toThrow(/Missing config file/);
  });
});

describe("handleConfig", () => {
  it("rejects unknown config keys", async () => {
    const entryDir = makeTempEntryDir();
    fs.writeFileSync(
      path.join(entryDir, "evals.config.json"),
      JSON.stringify({ defaults: {}, benchmarks: {} }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleConfig(["set", "agentModes", "dom"], entryDir);

    expect(readConfig(entryDir).defaults).toEqual({});
    expect(error).toHaveBeenCalled();
  });
});

describe("config v2: tracked + local", () => {
  function seed(
    entryDir: string,
    tracked: Record<string, unknown>,
    local?: Record<string, unknown>,
  ) {
    fs.writeFileSync(path.join(entryDir, "evals.config.json"), JSON.stringify(tracked, null, 2));
    if (local) {
      fs.writeFileSync(path.join(entryDir, "evals.config.local.json"), JSON.stringify(local));
    }
  }
  const readLocal = (entryDir: string) =>
    JSON.parse(fs.readFileSync(path.join(entryDir, "evals.config.local.json"), "utf-8"));
  const readTracked = (entryDir: string) =>
    JSON.parse(fs.readFileSync(path.join(entryDir, "evals.config.json"), "utf-8"));

  it("reads a v1 file as v2 with empty new sections and drops defaults.provider", () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir, {
      defaults: { env: "local", concurrency: 10, provider: null },
      benchmarks: { hardbenchmark: { limit: 46 } },
      _meta: { firstRunCompletedAt: "2026-08-31T07:39:41.460Z", version: 1 },
    });
    const config = readConfig(entryDir);
    expect(config.version).toBeUndefined();
    expect(config.defaults).toEqual({ env: "local", concurrency: 10 });
    expect(config.harnesses).toBeUndefined();
    expect(config.providers).toBeUndefined();
    expect(config._meta?.firstRunCompletedAt).toBe("2026-08-31T07:39:41.460Z");
  });

  it("deep-merges local over tracked; null in local removes a tracked key", () => {
    const entryDir = makeTempEntryDir();
    seed(
      entryDir,
      {
        version: 2,
        defaults: { env: "local", concurrency: 3, model: "openai/gpt-4.1-mini" },
        providers: { openai: { concurrency: 6 } },
        tracing: { transport: "otel" },
      },
      {
        defaults: { concurrency: 10, model: null },
        providers: { anthropic: { concurrency: 4 } },
        campaign: { tag: "facade-batch-0831" },
        tracing: null,
      },
    );
    const config = readConfig(entryDir);
    expect(config.defaults).toEqual({ env: "local", concurrency: 10 });
    expect(config.providers).toEqual({ openai: { concurrency: 6 }, anthropic: { concurrency: 4 } });
    expect(config.campaign).toEqual({ tag: "facade-batch-0831" });
    expect(config.tracing).toBeUndefined();
  });

  it("config set writes only the difference to the local file and leaves the tracked file alone", async () => {
    const entryDir = makeTempEntryDir();
    const tracked = { version: 2, defaults: { env: "local", concurrency: 3 }, benchmarks: {} };
    seed(entryDir, tracked);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleConfig(["set", "concurrency", "10"], entryDir);
    await handleConfig(["set", "env", "browserbase"], entryDir);
    await handleConfig(["set", "harness", "claude_code"], entryDir);

    expect(readTracked(entryDir)).toEqual(tracked);
    expect(readLocal(entryDir)).toEqual({
      defaults: { concurrency: 10, env: "browserbase", harness: "claude_code" },
    });
    expect(readConfig(entryDir).defaults).toEqual({
      env: "browserbase",
      concurrency: 10,
      harness: "claude_code",
    });

    // Setting a key back to the tracked value removes the override.
    await handleConfig(["set", "concurrency", "3"], entryDir);
    expect(readLocal(entryDir).defaults).toEqual({ env: "browserbase", harness: "claude_code" });
  });

  it("--shared writes the tracked file (without _meta) and drops now-redundant local overrides", async () => {
    const entryDir = makeTempEntryDir();
    seed(
      entryDir,
      {
        version: 2,
        defaults: { env: "local", concurrency: 3 },
        benchmarks: {},
        _meta: { firstRunCompletedAt: "tracked", version: 1 },
      },
      { defaults: { concurrency: 10 }, _meta: { firstRunCompletedAt: "x", version: 1 } },
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleConfig(["set", "concurrency", "10", "--shared"], entryDir);

    expect(readTracked(entryDir)).toEqual({
      version: 2,
      defaults: { env: "local", concurrency: 10 },
      benchmarks: {},
    });
    expect(readLocal(entryDir)).toEqual({ _meta: { firstRunCompletedAt: "x", version: 1 } });
  });

  it("--shared never carries local overrides into the tracked file", async () => {
    const entryDir = makeTempEntryDir();
    seed(
      entryDir,
      { version: 2, defaults: { env: "local", concurrency: 3, trials: 3 }, benchmarks: {} },
      {
        defaults: { concurrency: 10, env: "browserbase" },
        harnesses: { codex: { models: ["openai/personal"] } },
      },
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleConfig(["set", "trials", "2", "--shared"], entryDir);
    await handleConfig(["providers", "set", "openai", "concurrency", "6", "--shared"], entryDir);

    expect(readTracked(entryDir)).toEqual({
      version: 2,
      defaults: { env: "local", concurrency: 3, trials: 2 },
      benchmarks: {},
      providers: { openai: { concurrency: 6 } },
    });
    // Personal overrides stay personal, and still apply.
    expect(readLocal(entryDir)).toEqual({
      defaults: { concurrency: 10, env: "browserbase" },
      harnesses: { codex: { models: ["openai/personal"] } },
    });
    expect(readConfig(entryDir).defaults).toMatchObject({ concurrency: 10, trials: 2 });
  });

  it("rejects unknown harnesses and invalid success modes; warns on the dead provider key", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir, { version: 2, defaults: {}, benchmarks: {} });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleConfig(["set", "harness", "nope"], entryDir);
    expect(error.mock.calls.flat().join("\n")).toContain('Unknown harness "nope"');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await handleConfig(["set", "successMode", "maybe"], entryDir);
    expect(error.mock.calls.flat().join("\n")).toContain(
      "successMode must be outcome, process or both",
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(readConfig(entryDir).defaults).toEqual({});

    await handleConfig(["set", "provider", "openai"], entryDir);
    expect(log.mock.calls.flat().join("\n")).toContain('config key "provider" is deprecated');
    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(entryDir, "evals.config.local.json"))).toBe(false);
  });

  it("section subcommands validate and write harnesses/providers/verifier/campaign", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir, { version: 2, defaults: {}, benchmarks: {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleConfig(
      ["harnesses", "set", "claude_code", "models", "anthropic/a, anthropic/b"],
      entryDir,
    );
    await handleConfig(["harnesses", "set", "claude_code", "tool", "stagehand_facade"], entryDir);
    await handleConfig(["harnesses", "set", "claude_code", "tool", "not_a_surface"], entryDir);
    await handleConfig(["harnesses", "set", "stagehand", "tool", "browse_cli"], entryDir);
    await handleConfig(["providers", "set", "OpenAI", "concurrency", "6"], entryDir);
    await handleConfig(["providers", "set", "openai", "concurrency", "zero"], entryDir);
    await handleConfig(["verifier", "set", "model", "google/gemini-3.5-flash"], entryDir);
    await handleConfig(["verifier", "set", "model", "gemini"], entryDir);
    await handleConfig(["verifier", "set", "maxUnverifiableCriteria", "2"], entryDir);
    await handleConfig(["campaign", "set", "tag", "facade-batch-0831"], entryDir);

    const errors = error.mock.calls.flat().join("\n");
    expect(errors).toContain('Harness "claude_code" supports --tool');
    expect(errors).toContain('Harness "stagehand" mounts no tool surface');
    expect(errors).toContain("concurrency must be a positive integer");
    expect(errors).toContain("verifier model must be provider/model");
    process.exitCode = undefined;

    expect(readLocal(entryDir)).toEqual({
      harnesses: {
        claude_code: { models: ["anthropic/a", "anthropic/b"], tool: "stagehand_facade" },
      },
      providers: { openai: { concurrency: 6 } },
      verifier: { model: "google/gemini-3.5-flash", maxUnverifiableCriteria: 2 },
      campaign: { tag: "facade-batch-0831" },
    });

    await handleConfig(["harnesses", "reset", "claude_code"], entryDir);
    await handleConfig(["providers", "reset", "openai"], entryDir);
    await handleConfig(["verifier", "reset"], entryDir);
    await handleConfig(["campaign", "reset"], entryDir);
    expect(readConfig(entryDir)).toMatchObject({ harnesses: {}, providers: {} });
    expect(readConfig(entryDir).verifier).toBeUndefined();
    expect(readConfig(entryDir).campaign).toBeUndefined();
  });

  it("resetting a section that the tracked file defines records a removal marker", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir, {
      version: 2,
      defaults: {},
      benchmarks: {},
      providers: { openai: { concurrency: 6 } },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleConfig(["providers", "reset", "openai"], entryDir);
    expect(readLocal(entryDir)).toEqual({ providers: { openai: null } });
    expect(readConfig(entryDir).providers).toEqual({});
  });
});

describe("config v2: validation", () => {
  function seed(entryDir: string, local?: unknown) {
    fs.writeFileSync(
      path.join(entryDir, "evals.config.json"),
      JSON.stringify({ version: 2, defaults: { env: "local" }, benchmarks: {} }),
    );
    if (local !== undefined) {
      fs.writeFileSync(path.join(entryDir, "evals.config.local.json"), JSON.stringify(local));
    }
  }
  const localPath = (entryDir: string) => path.join(entryDir, "evals.config.local.json");

  async function expectRejected(entryDir: string, args: string[], message: string) {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleConfig(args, entryDir);
    expect(error.mock.calls.flat().join("\n")).toContain(message);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(fs.existsSync(localPath(entryDir))).toBe(false);
  }

  it("rejects unsafe integers, malformed judge ids and models for category-picked harnesses", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir);
    await expectRejected(
      entryDir,
      ["providers", "set", "openai", "concurrency", "99999999999999999999"],
      "concurrency must be a positive integer",
    );
    await expectRejected(
      entryDir,
      ["verifier", "set", "model", "/gemini"],
      "verifier model must be provider/model",
    );
    await expectRejected(
      entryDir,
      ["verifier", "set", "model", "google/"],
      "verifier model must be provider/model",
    );
    await expectRejected(
      entryDir,
      ["harnesses", "set", "stagehand", "models", "openai/gpt-4.1"],
      'Harness "stagehand" picks models per task category',
    );
  });

  it("accepts 0 for maxUnverifiableCriteria (zero tolerance)", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleConfig(["verifier", "set", "maxUnverifiableCriteria", "0"], entryDir);
    expect(process.exitCode).toBeUndefined();
    expect(readConfig(entryDir).verifier).toEqual({ maxUnverifiableCriteria: 0 });
  });

  it("rejects --shared for core and tracing instead of writing a personal override", async () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir);
    await expectRejected(
      entryDir,
      ["core", "set", "tool", "understudy_code", "--shared"],
      "--shared is not supported for config core",
    );
    await expectRejected(
      entryDir,
      ["tracing", "set", "transport", "otel", "--shared"],
      "--shared is not supported for config tracing",
    );
    // The command tree hands the raw args (still carrying --shared) to the handlers.
    const { handleCore } = await import("../../tui/commands/core.js");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleCore(["set", "tool", "understudy_code", "--shared"], entryDir);
    expect(error.mock.calls.flat().join("\n")).toContain("--shared is not supported");
    process.exitCode = undefined;
    expect(fs.existsSync(localPath(entryDir))).toBe(false);
  });

  it("refuses a local file whose defaults is not an object", () => {
    const entryDir = makeTempEntryDir();
    seed(entryDir, { defaults: null });
    expect(() => readConfig(entryDir)).toThrow(/"defaults" must be an object/);
  });
});
