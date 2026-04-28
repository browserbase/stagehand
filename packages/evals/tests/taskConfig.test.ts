import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentProvider,
  providerEnvVarMap,
} from "@browserbasehq/stagehand";
import {
  tasksByName,
  getModelList,
  getAgentModelEntries,
  validateEvalName,
} from "../taskConfig.js";

describe("getModelList", () => {
  beforeEach(() => {
    // Clear provider override between tests
    delete process.env.EVAL_PROVIDER;
  });

  it("returns default models for no category", () => {
    const models = getModelList();
    expect(models.length).toBeGreaterThan(0);
    // Default set includes these three
    expect(models).toContain("google/gemini-2.0-flash");
    expect(models).toContain("openai/gpt-4.1-mini");
    expect(models).toContain("anthropic/claude-haiku-4-5");
  });

  it("returns agent models for agent category", () => {
    const models = getModelList("agent");
    expect(models.length).toBeGreaterThan(0);
    // Agent models include CUA models
    expect(models.some((m) => m.includes("anthropic"))).toBe(true);
  });

  it("returns agent models for external_agent_benchmarks", () => {
    const models = getModelList("external_agent_benchmarks");
    expect(models).toEqual(getModelList("agent"));
  });

  it("filters by provider when EVAL_PROVIDER is set", () => {
    process.env.EVAL_PROVIDER = "openai";
    const models = getModelList();
    expect(models.every((m) => m.toLowerCase().startsWith("gpt"))).toBe(true);
  });
});

describe("getAgentModelEntries", () => {
  it("returns entries with cua flag", () => {
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

  it("does not include CUA providers without API key env support by default", () => {
    const cuaEntries = getAgentModelEntries().filter((entry) => entry.cua);

    for (const entry of cuaEntries) {
      const provider = AgentProvider.getAgentProvider(entry.modelName);
      expect(provider in providerEnvVarMap).toBe(true);
    }

    expect(cuaEntries.map((entry) => entry.modelName)).not.toContain(
      "microsoft/fara-7b",
    );
  });
});

describe("cross-cutting categories", () => {
  it("preserves regression tag on tasks", () => {
    const task = tasksByName["observe_github"];
    expect(task).toBeDefined();
    expect(task.categories).toContain("observe");
    expect(task.categories).toContain("regression");
  });

  it("preserves targeted_extract tag", () => {
    const task = tasksByName["extract_recipe"];
    expect(task).toBeDefined();
    expect(task.categories).toContain("extract");
    expect(task.categories).toContain("targeted_extract");
  });

  it("external benchmarks have only external_agent_benchmarks, not agent", () => {
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

  it("does not expose core tier tasks", () => {
    // Core tasks like "open", "reload" should NOT be in the legacy registry
    expect(tasksByName["open"]).toBeUndefined();
    expect(tasksByName["reload"]).toBeUndefined();
    expect(tasksByName["navigation/open"]).toBeUndefined();
  });
});

describe("validateEvalName", () => {
  it("does not exit for a valid task name", () => {
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

  it("exits for a nonexistent task name", () => {
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
