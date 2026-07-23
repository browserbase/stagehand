/**
 * Backfill coverage for the v4-eval-superset: pure logic that Stack 2 shipped
 * untested, plus the superset's own executeSnippet dispatch (the branch that
 * routes agent snippets to the isolated forked-child controller instead of the
 * in-process AsyncFunction). Stack 1's controller/runtime/config already have
 * their own behavioral suites; these fill the framework-logic gaps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveModelApiKey } from "../../initV4.js";
import { getTierRoots } from "../../framework/discovery.js";
import { buildSdkComparisonExperimentName } from "../../framework/runner.js";
import { executeCodeExposureSnippet } from "../../framework/claudeCodeToolAdapter.js";
import { parseRunArgs, resolveRunOptions } from "../../tui/commands/parse.js";

const noopConsole = { log() {}, warn() {}, error() {} };
const noopLogger = { log() {}, warn() {} } as unknown as Parameters<
  typeof executeCodeExposureSnippet
>[0]["logger"];

function snippetInput(
  overrides: Partial<Parameters<typeof executeCodeExposureSnippet>[0]>,
): Parameters<typeof executeCodeExposureSnippet>[0] {
  return {
    code: "return null;",
    handles: {},
    runToolSpec: {
      description: "",
      codeParamDescription: "",
      denyMessage: "",
      task: {},
      console: noopConsole,
    },
    plan: { startUrl: "https://example.com" },
    logger: noopLogger,
    ...overrides,
  } as Parameters<typeof executeCodeExposureSnippet>[0];
}

describe("initV4.resolveModelApiKey", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("resolves the provider-prefixed key from env", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(resolveModelApiKey("openai/gpt-4.1-mini")).toBe("sk-openai");
  });

  it("prefers the first configured candidate for a multi-env provider", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-primary";
    process.env.GEMINI_API_KEY = "g-secondary";
    expect(resolveModelApiKey("google/gemini-3-flash-preview")).toBe(
      "g-primary",
    );
  });

  it("throws when the provider prefix is unknown", () => {
    expect(() => resolveModelApiKey("mystery/model")).toThrow(
      /no known provider prefix|no API key/,
    );
  });

  it("throws when the key env var is unset", () => {
    expect(() => resolveModelApiKey("anthropic/claude-sonnet-5")).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe("discovery.getTierRoots (SDK selects the bench tree)", () => {
  it("selects the bench-v4 tree for --sdk v4", () => {
    expect(getTierRoots("/repo/tasks", "bench", "v4")).toEqual([
      "/repo/tasks/bench-v4",
    ]);
  });

  it("selects the classic bench tree for v3 (default)", () => {
    expect(getTierRoots("/repo/tasks", "bench")).toEqual(["/repo/tasks/bench"]);
    expect(getTierRoots("/repo/tasks", "bench", "v3")).toEqual([
      "/repo/tasks/bench",
    ]);
  });

  it("ignores the SDK for the core tier", () => {
    expect(getTierRoots("/repo/tasks", "core", "v4")).toEqual([
      "/repo/core/tasks",
    ]);
  });
});

describe("runner.buildSdkComparisonExperimentName", () => {
  it("builds a self-describing, date-stamped name and strips the model prefix", () => {
    const name = buildSdkComparisonExperimentName({
      base: "act__dropdown",
      sdk: "v4",
      environment: "LOCAL",
      model: "openai/gpt-4.1-mini",
    });
    expect(name).toMatch(
      /^act__dropdown__v4__local__gpt-4\.1-mini__\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("uses 'multi' when no model is pinned", () => {
    const name = buildSdkComparisonExperimentName({
      base: "suite",
      sdk: "v3",
      environment: "BROWSERBASE",
      model: undefined,
    });
    expect(name).toContain("__v3__browserbase__multi__");
  });
});

describe("parse: --sdk validation", () => {
  it("rejects an --sdk value that is not v3 or v4", () => {
    expect(() => parseRunArgs(["--sdk", "v5"])).toThrow(
      /--sdk must be "v3" or "v4"/,
    );
  });

  it("requires --harness stagehand when --sdk v4 is set", () => {
    const flags = parseRunArgs(["--sdk", "v4", "--harness", "codex"]);
    expect(() => resolveRunOptions(flags, {}, {})).toThrow(
      /--sdk v4 requires --harness stagehand/,
    );
  });

  it("accepts --sdk v4 with the stagehand harness", () => {
    const flags = parseRunArgs(["--sdk", "v4", "--harness", "stagehand"]);
    const resolved = resolveRunOptions(flags, {}, {});
    expect(resolved.sdk).toBe("v4");
  });
});

describe("adapter.executeCodeExposureSnippet dispatch", () => {
  it("routes to the out-of-process executeSnippet when present (handles ignored)", async () => {
    const executeSnippet = vi.fn(async () => "from-child");
    const result = await executeCodeExposureSnippet(
      snippetInput({
        code: "return 1 + 1;",
        handles: { stagehand: {}, page: {} },
        executeSnippet,
        runToolSpec: {
          description: "",
          codeParamDescription: "",
          denyMessage: "",
          task: { id: "T1" },
          console: noopConsole,
        },
        plan: {
          dataset: "webvoyager",
          instruction: "do the thing",
          startUrl: "https://start.example",
        },
      }),
    );
    expect(result).toBe("from-child");
    expect(executeSnippet).toHaveBeenCalledWith({
      code: "return 1 + 1;",
      startUrl: "https://start.example",
      task: { id: "T1" },
    });
  });

  it("binds handles by name for the in-process path (no executeSnippet)", async () => {
    const result = await executeCodeExposureSnippet(
      snippetInput({
        code: "return page.marker + startUrl + task.id;",
        handles: { page: { marker: "M-" } },
        runToolSpec: {
          description: "",
          codeParamDescription: "",
          denyMessage: "",
          task: { id: "T2" },
          console: noopConsole,
        },
        plan: {
          dataset: "webvoyager",
          instruction: "do the thing",
          startUrl: "U-",
        },
      }),
    );
    expect(result).toBe("M-U-T2");
  });
});
