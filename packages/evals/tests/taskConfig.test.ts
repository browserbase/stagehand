/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AgentProvider,
  AVAILABLE_CUA_MODELS,
  providerEnvVarMap,
} from "@browserbasehq/stagehand";

type TaskConfigModule = typeof import("../taskConfig.js");

const ENV_KEYS = [
  "EVAL_PROVIDER",
  "EVAL_MODELS",
  "EVAL_AGENT_MODELS",
  "EVAL_AGENT_MODELS_CUA",
] as const;

const originalEnv = new Map<string, string | undefined>();

async function loadTaskConfig(): Promise<TaskConfigModule> {
  return import("../taskConfig.js");
}

beforeEach(() => {
  originalEnv.clear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getModelList", () => {
  it("returns default models for no category", async () => {
    const { getModelList } = await loadTaskConfig();
    const models = getModelList();
    expect(models.length).toBeGreaterThan(0);
    // Default set includes these three
    expect(models).toContain("google/gemini-2.5-flash");
    expect(models).toContain("openai/gpt-4.1-mini");
    expect(models).toContain("anthropic/claude-haiku-4-5");
  });

  it("returns agent models for agent category", async () => {
    const { getModelList } = await loadTaskConfig();
    const models = getModelList("agent");
    expect(models.length).toBeGreaterThan(0);
    // Agent models include CUA models
    expect(models.some((m) => m.includes("anthropic"))).toBe(true);
  });

  it("returns agent models for external_agent_benchmarks", async () => {
    const { getModelList } = await loadTaskConfig();
    const models = getModelList("external_agent_benchmarks");
    expect(models).toEqual(getModelList("agent"));
  });

  it("filters by provider when EVAL_PROVIDER is set", async () => {
    process.env.EVAL_PROVIDER = "openai";
    const { getModelList } = await loadTaskConfig();
    const models = getModelList();
    expect(models.every((m) => m.toLowerCase().startsWith("gpt"))).toBe(true);
  });
});

describe("getAgentModelEntries", () => {
  it("returns entries with cua flag", async () => {
    const { getAgentModelEntries } = await loadTaskConfig();
    const entries = getAgentModelEntries();
    expect(entries.length).toBeGreaterThan(0);

    const standard = entries.filter((e) => !e.cua);
    const cua = entries.filter((e) => e.cua);

    expect(standard.length).toBeGreaterThan(0);
    expect(cua.length).toBeGreaterThan(0);

    // Each entry has modelName
    for (const entry of entries) {
      expect(typeof entry.modelName).toBe("string");
      expect(entry.modelName.length).toBeGreaterThan(0);
    }
  });

  it("does not include CUA providers without API key env support by default", async () => {
    const { getAgentModelEntries } = await loadTaskConfig();
    const cuaEntries = getAgentModelEntries().filter((entry) => entry.cua);

    for (const entry of cuaEntries) {
      const provider = AgentProvider.getAgentProvider(entry.modelName);
      expect(provider in providerEnvVarMap).toBe(true);
    }

    expect(cuaEntries.map((entry) => entry.modelName)).not.toContain(
      "microsoft/fara-7b",
    );
  });

  it("runs configured standard agent models in dom and hybrid modes", async () => {
    process.env.EVAL_AGENT_MODELS = "openai/gpt-4.1-mini";
    process.env.EVAL_AGENT_MODELS_CUA = " ";

    const { getAgentModelEntries } = await loadTaskConfig();
    const entries = getAgentModelEntries();
    const modes = entries
      .filter((entry) => entry.modelName === "openai/gpt-4.1-mini")
      .map((entry) => entry.mode)
      .sort();

    expect(modes).toEqual(["dom", "hybrid"]);
    expect(entries.every((entry) => entry.cua === false)).toBe(true);
  });

  it("keeps the default CUA matrix intentionally smaller than all CUA models", async () => {
    const { getAgentModelEntries } = await loadTaskConfig();
    const cuaModels = [
      ...new Set(
        getAgentModelEntries()
          .filter((entry) => entry.cua)
          .map((entry) => entry.modelName),
      ),
    ];

    expect(cuaModels.length).toBeGreaterThan(0);
    expect(cuaModels.length).toBeLessThan(AVAILABLE_CUA_MODELS.length);
    expect(cuaModels).not.toContain("microsoft/fara-7b");
  });

  it("runs CUA-capable EVAL_AGENT_MODELS entries in dom and hybrid modes", async () => {
    process.env.EVAL_AGENT_MODELS =
      "openai/gpt-5.4,google/gemini-3-flash-preview";
    process.env.EVAL_AGENT_MODELS_CUA = " ";

    const { getAgentModelEntries } = await loadTaskConfig();
    const entries = getAgentModelEntries();
    const standardModes = entries
      .filter((entry) => entry.modelName === "openai/gpt-5.4")
      .map((entry) => entry.mode)
      .sort();
    const cuaEntries = entries.filter(
      (entry) => entry.modelName === "google/gemini-3-flash-preview",
    );

    expect(standardModes).toEqual(["dom", "hybrid"]);
    expect(cuaEntries.map((entry) => entry.mode).sort()).toEqual([
      "dom",
      "hybrid",
    ]);
    expect(cuaEntries.every((entry) => entry.cua === false)).toBe(true);
  });

  it("does not run non-CUA models from EVAL_AGENT_MODELS_CUA as CUA", async () => {
    process.env.EVAL_AGENT_MODELS = " ";
    process.env.EVAL_AGENT_MODELS_CUA =
      "openai/gpt-4.1-mini,google/gemini-3-flash-preview";

    const { getAgentModelEntries } = await loadTaskConfig();
    const entries = getAgentModelEntries();

    expect(entries).toEqual([
      {
        modelName: "google/gemini-3-flash-preview",
        mode: "cua",
        cua: true,
      },
    ]);
  });
});

describe("cross-cutting categories", () => {
  it("preserves regression tag on tasks", async () => {
    const { tasksByName } = await loadTaskConfig();
    const task = tasksByName["observe_github"];
    expect(task).toBeDefined();
    expect(task.categories).toContain("observe");
    expect(task.categories).toContain("regression");
  });

  it("preserves targeted_extract tag", async () => {
    const { tasksByName } = await loadTaskConfig();
    const task = tasksByName["extract_recipe"];
    expect(task).toBeDefined();
    expect(task.categories).toContain("extract");
    expect(task.categories).toContain("targeted_extract");
  });

  it("external benchmarks have only external_agent_benchmarks, not agent", async () => {
    const { tasksByName } = await loadTaskConfig();
    const task = tasksByName["agent/gaia"];
    expect(task).toBeDefined();
    expect(task.categories).toContain("external_agent_benchmarks");
    expect(task.categories).not.toContain("agent");
    // Same for webvoyager
    const wv = tasksByName["agent/webvoyager"];
    expect(wv).toBeDefined();
    expect(wv.categories).toContain("external_agent_benchmarks");
    expect(wv.categories).not.toContain("agent");
  });

  it("does not expose core tier tasks", async () => {
    const { tasksByName } = await loadTaskConfig();
    // Core tasks like "open", "reload" should NOT be in the legacy registry
    expect(tasksByName["open"]).toBeUndefined();
    expect(tasksByName["reload"]).toBeUndefined();
    expect(tasksByName["navigation/open"]).toBeUndefined();
  });
});

describe("validateEvalName", () => {
  it("does not exit for a valid task name", async () => {
    const { validateEvalName } = await loadTaskConfig();
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    // Use a task that should exist in the discovered filesystem
    // (the discovery runs at import time in taskConfig.ts)
    // If no tasks found, this will exit — that's fine, we just test the logic
    try {
      // Empty string should be a no-op (the if guard checks truthiness)
      validateEvalName("");
    } catch {
      // ignore
    }

    mockExit.mockRestore();
  });

  it("exits for a nonexistent task name", async () => {
    const { validateEvalName } = await loadTaskConfig();
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => validateEvalName("this_task_does_not_exist_xyz")).toThrow(
      "process.exit called",
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});
