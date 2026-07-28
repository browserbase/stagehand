import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import { executeBenchTask } from "../../framework/benchRunner.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";

const tempDirs: string[] = [];
const { closeMock, initStagehandMock } = vi.hoisted(() => {
  const close = vi.fn(async () => {});
  return {
    closeMock: close,
    initStagehandMock: vi.fn(async ({ logger, modelName, systemPrompt }) => ({
      stagehand: { close },
      page: {},
      logger,
      modelName,
      systemPrompt,
      sessionUrl: "https://www.browserbase.com/sessions/session-123",
      debugUrl: "https://debug.browserbase.test/session-123",
    })),
  };
});

vi.mock("../../initStagehand.js", () => ({
  initStagehand: initStagehandMock,
}));

vi.mock("../../browserbaseCleanup.js", () => ({
  endBrowserbaseSession: vi.fn(async () => {}),
}));

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-bench-runner-"));
  tempDirs.push(dir);
  return dir;
}

function makeRegistry(tasks: DiscoveredTask[]): TaskRegistry {
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const byTier = new Map<"core" | "bench", DiscoveredTask[]>();
  const byCategory = new Map<string, DiscoveredTask[]>();

  for (const task of tasks) {
    if (!byTier.has(task.tier)) byTier.set(task.tier, []);
    byTier.get(task.tier)!.push(task);
    for (const category of task.categories) {
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(task);
    }
  }

  return { tasks, byName, byTier, byCategory };
}

afterEach(() => {
  closeMock.mockClear();
  initStagehandMock.mockClear();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bench runner", () => {
  it("passes task metadata into Stagehand and attaches session URLs", async () => {
    const taskDir = makeTempDir();
    const taskFile = path.join(taskDir, "session_url_task.mjs");
    fs.writeFileSync(
      taskFile,
      `
      export default {
        __taskDefinition: true,
        meta: {
          name: "session_url_task",
          systemPrompt: "Follow the task-specific instruction.",
        },
        fn: async () => ({
          _success: true,
          sessionUrl: "",
          debugUrl: "",
        }),
      };
      `,
    );

    const task: DiscoveredTask = {
      name: "act/session_url_task",
      tier: "bench",
      primaryCategory: "act",
      categories: ["act"],
      tags: [],
      filePath: taskFile,
      isLegacy: false,
    };

    const result = await executeBenchTask(
      {
        name: task.name,
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      task,
      {
        tasks: [task],
        registry: makeRegistry([task]),
        environment: "BROWSERBASE",
        harness: "stagehand",
        verbose: false,
      },
    );

    expect(initStagehandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "Follow the task-specific instruction.",
      }),
    );
    expect(result).toMatchObject({
      _success: true,
      sessionUrl: "https://www.browserbase.com/sessions/session-123",
      debugUrl: "https://debug.browserbase.test/session-123",
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a successful task result when harness cleanup fails", async () => {
    const taskDir = makeTempDir();
    const taskFile = path.join(taskDir, "cleanup_failure_task.mjs");
    fs.writeFileSync(
      taskFile,
      `
      export default {
        __taskDefinition: true,
        meta: { name: "cleanup_failure_task" },
        fn: async () => ({ _success: true }),
      };
      `,
    );

    const task: DiscoveredTask = {
      name: "act/cleanup_failure_task",
      tier: "bench",
      primaryCategory: "act",
      categories: ["act"],
      tags: [],
      filePath: taskFile,
      isLegacy: false,
    };
    closeMock.mockRejectedValueOnce(new Error("cleanup failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await executeBenchTask(
      {
        name: task.name,
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      task,
      {
        tasks: [task],
        registry: makeRegistry([task]),
        environment: "BROWSERBASE",
        harness: "stagehand",
        verbose: false,
      },
    );

    expect(result._success).toBe(true);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      `Warning: Error closing Stagehand for ${task.name}:`,
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
