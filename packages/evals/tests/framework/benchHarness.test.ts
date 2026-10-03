import { describe, expect, it, vi } from "vitest";
import { V3, type AvailableModel } from "stagehand-v3";
import {
  claudeCodeHarness,
  codexHarness,
  defineExternalHarness,
  getBenchHarness,
  isExecutableBenchHarness,
  listBenchHarnesses,
  listExecutableBenchHarnesses,
  parseBenchHarness,
  listBenchHarnessesForToolSurface,
  mastraHarness,
  piHarness,
  cursorHarness,
  fxHarness,
  deepagentsHarness,
  eveHarness,
  registerBenchHarness,
} from "../../framework/benchHarness.js";
import { MASTRA_TOOL_SURFACES } from "../../framework/mastraToolAdapter.js";
import { PI_TOOL_SURFACES } from "../../framework/piToolAdapter.js";
import { CURSOR_TOOL_SURFACES } from "../../framework/cursorToolAdapter.js";
import { defaultModelsEnvKey } from "../../framework/benchPlanner.js";
import type { BenchMatrixRow } from "../../framework/benchTypes.js";
import type { DiscoveredTask } from "../../framework/types.js";
import type { EvalInput } from "../../types/evals.js";
import { EvalLogger } from "../../logger.js";

describe("bench harness registry", () => {
  it("lists registered harnesses in registration order", () => {
    expect(listBenchHarnesses()).toEqual([
      "stagehand",
      "claude_code",
      "codex",
      "mastra",
      "pi",
      "eve",
      "deepagents",
      "fx",
      "cursor",
    ]);
  });

  it("parses registered harnesses and defaults to stagehand", () => {
    expect(parseBenchHarness(undefined)).toBe("stagehand");
    expect(parseBenchHarness("codex")).toBe("codex");
    expect(() => parseBenchHarness("nope")).toThrow(
      /Unknown harness "nope"\. Supported: stagehand, claude_code, codex, mastra, pi, eve, deepagents, fx, cursor\./,
    );
  });

  it("reports whether a harness is executable", () => {
    expect(isExecutableBenchHarness("claude_code")).toBe(true);
    expect(isExecutableBenchHarness("nope")).toBe(false);
  });

  it("registers claude_code as a concrete executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(claudeCodeHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces[0]).toBe("browse_cli");
    expect(harness.defaultModels).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("registers codex as a concrete executable harness", () => {
    const harness = getBenchHarness("codex");

    expect(harness).toBe(codexHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("registers mastra as a concrete executable harness", () => {
    const harness = getBenchHarness("mastra");

    expect(harness).toBe(mastraHarness);
    expect(parseBenchHarness("mastra")).toBe("mastra");
    expect(isExecutableBenchHarness("mastra")).toBe(true);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual(MASTRA_TOOL_SURFACES);
    expect(harness.supportedToolSurfaces[0]).toBe("stagehand_facade");
    expect(listBenchHarnessesForToolSurface("stagehand_facade")).toContain("mastra");
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("registers pi as a concrete executable harness", () => {
    const harness = getBenchHarness("pi");

    expect(harness).toBe(piHarness);
    expect(parseBenchHarness("pi")).toBe("pi");
    expect(isExecutableBenchHarness("pi")).toBe(true);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual(PI_TOOL_SURFACES);
    expect(harness.supportedToolSurfaces[0]).toBe("stagehand_facade");
    expect(harness.supportedToolSurfaces).not.toContain("browse_cli");
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("registers eve as a concrete executable harness", () => {
    const harness = getBenchHarness("eve");

    expect(harness).toBe(eveHarness);
    expect(parseBenchHarness("eve")).toBe("eve");
    expect(isExecutableBenchHarness("eve")).toBe(true);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
    expect(defaultModelsEnvKey("eve")).toBe("EVAL_EVE_MODELS");
  });

  it("registers deepagents as a concrete executable harness", () => {
    const harness = getBenchHarness("deepagents");

    expect(parseBenchHarness("deepagents")).toBe("deepagents");
    expect(harness).toBe(deepagentsHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
    expect(isExecutableBenchHarness("deepagents")).toBe(true);
  });

  it("registers fx as a concrete executable harness", () => {
    const harness = getBenchHarness("fx");

    expect(harness).toBe(fxHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
    expect(isExecutableBenchHarness("fx")).toBe(true);
  });

  it("registers cursor as a concrete executable harness", () => {
    const harness = getBenchHarness("cursor");

    expect(harness).toBe(cursorHarness);
    expect(parseBenchHarness("cursor")).toBe("cursor");
    expect(isExecutableBenchHarness("cursor")).toBe(true);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.start).toBeUndefined();
    expect(harness.supportedToolSurfaces).toEqual(CURSOR_TOOL_SURFACES);
    expect(harness.supportedToolSurfaces).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(harness.supportedToolSurfaces[0]).toBe("stagehand_facade");
    expect(harness.supportedToolSurfaces).not.toContain("browse_cli");
    expect(harness.supportedToolSurfaces).not.toContain("stagehand_code");
    expect(harness.defaultModels).toEqual(["cursor/auto"]);
  });

  it("registers a new harness and rejects duplicate ids", () => {
    const fakeHarness = {
      harness: "fake_harness",
      supportedTaskKinds: ["suite" as const],
      supportsApi: false,
      supportedToolSurfaces: ["browse_cli" as const],
      defaultModels: ["openai/x" as AvailableModel],
      execute: async () => ({ _success: true }),
      start: async () => {
        throw new Error("n/a");
      },
    };

    const unregister = registerBenchHarness(fakeHarness);
    try {
      expect(parseBenchHarness("fake_harness")).toBe("fake_harness");
      expect(() => registerBenchHarness(fakeHarness)).toThrow(/already registered/);
    } finally {
      unregister();
    }
  });

  it("keeps planning-only harnesses registered but non-executable", () => {
    const unregister = registerBenchHarness({
      harness: "planning_only_harness",
      supportedTaskKinds: ["suite"],
      supportsApi: false,
      supportedToolSurfaces: ["browse_cli"],
    });

    try {
      expect(listBenchHarnesses()).toContain("planning_only_harness");
      expect(listExecutableBenchHarnesses()).not.toContain("planning_only_harness");
      expect(isExecutableBenchHarness("planning_only_harness")).toBe(false);
    } finally {
      unregister();
    }
  });

  it("defines the shared external lifecycle and cleans up when the agent throws", async () => {
    let cleanupCalled = false;
    const adapter = {
      cleanup: async (): Promise<void> => {
        cleanupCalled = true;
      },
    };
    let preparedInput: Record<string, unknown> | undefined;
    let receivedAdapter: unknown;
    const harness = defineExternalHarness({
      harness: "fake_external",
      supportedToolSurfaces: ["browse_cli"],
      defaultModels: ["openai/x" as AvailableModel],
      prepareToolAdapter: async (input) => {
        preparedInput = input as unknown as Record<string, unknown>;
        return adapter;
      },
      runAgent: async (input) => {
        receivedAdapter = input.toolAdapter;
        throw new Error("agent failed");
      },
    });
    const input: EvalInput = {
      name: "agent/webvoyager",
      modelName: "openai/x" as AvailableModel,
      params: {
        id: "wv-1",
        web: "https://example.com",
        ques: "Find the checkout button",
      },
    };
    const row: BenchMatrixRow = {
      harness: "fake_external",
      task: input.name,
      category: "agent",
      taskKind: "agent",
      model: input.modelName,
      environment: "BROWSERBASE",
      useApi: false,
      toolSurface: "browse_cli",
      startupProfile: "tool_create_browserbase",
      trial: 1,
      config: {
        harness: "fake_external",
        model: input.modelName,
        environment: "BROWSERBASE",
        useApi: false,
        toolSurface: "browse_cli",
        startupProfile: "tool_create_browserbase",
      },
    };
    const task: DiscoveredTask = {
      name: input.name,
      tier: "bench",
      primaryCategory: "agent",
      categories: ["agent"],
      tags: [],
      filePath: "/tmp/fake.ts",
      isLegacy: false,
    };

    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    await expect(
      harness.execute?.({ task, input, row, logger: new EvalLogger(false) }),
    ).rejects.toThrow("agent failed");
    expect(preparedInput).toMatchObject({
      toolSurface: "browse_cli",
      startupProfile: "tool_create_browserbase",
      environment: "BROWSERBASE",
    });
    expect(receivedAdapter).toBe(adapter);
    expect(cleanupCalled).toBe(true);
  });

  it("closes the verifier carrier when adapter cleanup rejects", async () => {
    const close = vi.spyOn(V3.prototype, "close").mockResolvedValue(undefined);
    const harness = defineExternalHarness({
      harness: "cleanup_rejects_external",
      supportedToolSurfaces: ["browse_cli"],
      defaultModels: ["openai/x" as AvailableModel],
      prepareToolAdapter: async () => ({
        cleanup: async () => {
          throw new Error("cleanup failed");
        },
      }),
      runAgent: async () => ({ _success: true }),
    });
    const input: EvalInput = {
      name: "agent/webvoyager",
      modelName: "openai/x" as AvailableModel,
      params: { id: "wv-1", web: "https://example.com", ques: "Find it" },
    };
    const task: DiscoveredTask = {
      name: input.name,
      tier: "bench",
      primaryCategory: "agent",
      categories: ["agent"],
      tags: [],
      filePath: "/tmp/fake.ts",
      isLegacy: false,
    };
    const row: BenchMatrixRow = {
      harness: "cleanup_rejects_external",
      task: input.name,
      category: "agent",
      taskKind: "agent",
      model: input.modelName,
      environment: "LOCAL",
      useApi: false,
      toolSurface: "browse_cli",
      startupProfile: "tool_launch_local",
      trial: 1,
      config: {
        harness: "cleanup_rejects_external",
        model: input.modelName,
        environment: "LOCAL",
        useApi: false,
        toolSurface: "browse_cli",
        startupProfile: "tool_launch_local",
      },
    };

    try {
      await expect(
        harness.execute?.({ task, input, row, logger: new EvalLogger(false) }),
      ).rejects.toThrow("cleanup failed");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });

  it("rejects mismatched external harness config before preparing an adapter", async () => {
    let prepareCalled = false;
    const harness = defineExternalHarness({
      harness: "mismatch_external_harness",
      supportedToolSurfaces: ["browse_cli"],
      defaultModels: ["openai/x" as AvailableModel],
      prepareToolAdapter: async () => {
        prepareCalled = true;
        return { cleanup: async () => {} };
      },
      runAgent: async () => ({ _success: true }),
    });
    const input: EvalInput = {
      name: "agent/webvoyager",
      modelName: "openai/x" as AvailableModel,
      params: { id: "wv-1", web: "https://example.com", ques: "Find it" },
    };
    const task: DiscoveredTask = {
      name: input.name,
      tier: "bench",
      primaryCategory: "agent",
      categories: ["agent"],
      tags: [],
      filePath: "/tmp/fake.ts",
      isLegacy: false,
    };
    const row: BenchMatrixRow = {
      harness: "mismatch_external_harness",
      task: input.name,
      category: "agent",
      taskKind: "agent",
      model: input.modelName,
      environment: "LOCAL",
      useApi: false,
      trial: 1,
      config: {
        harness: "different_harness",
        model: input.modelName,
        environment: "LOCAL",
        useApi: false,
      },
    };

    await expect(
      harness.execute?.({ task, input, row, logger: new EvalLogger(false) }),
    ).rejects.toThrow(
      'Expected mismatch_external_harness harness config, received "different_harness".',
    );
    expect(prepareCalled).toBe(false);
  });
});
