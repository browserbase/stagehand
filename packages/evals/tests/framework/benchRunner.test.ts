import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  formatBenchHarnessFlags,
  listBenchHarnessesForTaskKind,
} from "../../framework/benchHarness.js";
import { executeBenchTask } from "../../framework/benchRunner.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";

const tempDirs: string[] = [];
const closeMock = vi.fn(async () => {});
const browserCloseMock = vi.fn(async () => {});

vi.mock("../../initStagehand.js", () => ({
  initStagehand: vi.fn(async ({ logger, modelName }) => ({
    stagehand: {
      close: closeMock,
      browser: { close: browserCloseMock },
    },
    page: { url: async () => "about:blank" },
    debugUrl: "",
    sessionUrl: "",
    cleanup: async () => {
      await closeMock();
      await browserCloseMock();
    },
    logger,
    modelName,
  })),
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

function writeDefinitionTask(dir: string, fileName: string, body: string): string {
  const taskFile = path.join(dir, fileName);
  fs.writeFileSync(
    taskFile,
    `
    export default {
      __taskDefinition: true,
      meta: {},
      fn: async (ctx) => { ${body} },
    };
    `,
  );
  return taskFile;
}

afterEach(() => {
  closeMock.mockClear();
  browserCloseMock.mockClear();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bench runner", () => {
  it("runs a/e/o definition tasks on the Stagehand SDK client and cleans up", async () => {
    const taskFile = writeDefinitionTask(
      makeTempDir(),
      "act_task.mjs",
      `return { _success: Boolean(ctx.stagehand && ctx.page) };`,
    );

    const task: DiscoveredTask = {
      name: "act/act_task",
      tier: "bench",
      primaryCategory: "act",
      categories: ["act"],
      tags: [],
      isLegacy: false,
      filePath: taskFile,
    };

    const result = await executeBenchTask(
      { name: task.name, modelName: "gpt-4o-mini" as AvailableModel },
      task,
      {
        tasks: [task],
        registry: makeRegistry([task]),
        environment: "LOCAL",
        harness: "stagehand",
        verbose: false,
      },
    );

    expect(result).toMatchObject({ _success: true });
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(browserCloseMock).toHaveBeenCalledTimes(1);
  });

  it("preserves task error messages", async () => {
    const taskFile = writeDefinitionTask(
      makeTempDir(),
      "thrown_task.mjs",
      `throw new Error("diagnostic failure");`,
    );

    const task: DiscoveredTask = {
      name: "act/thrown_task",
      tier: "bench",
      primaryCategory: "act",
      categories: ["act"],
      tags: [],
      isLegacy: false,
      filePath: taskFile,
    };

    const result = await executeBenchTask(
      { name: task.name, modelName: "gpt-4o-mini" as AvailableModel },
      task,
      {
        tasks: [task],
        registry: makeRegistry([task]),
        environment: "LOCAL",
        harness: "stagehand",
        verbose: false,
      },
    );

    expect(result).toMatchObject({
      _success: false,
      error: "diagnostic failure",
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-a/e/o tasks with external-harness guidance", async () => {
    const taskFile = writeDefinitionTask(makeTempDir(), "agent_task.mjs", `return {};`);

    const task: DiscoveredTask = {
      name: "agent/agent_task",
      tier: "bench",
      primaryCategory: "agent",
      categories: ["agent"],
      tags: [],
      isLegacy: false,
      filePath: taskFile,
    };

    const result = await executeBenchTask(
      { name: task.name, modelName: "gpt-4o-mini" as AvailableModel },
      task,
      {
        tasks: [task],
        registry: makeRegistry([task]),
        environment: "LOCAL",
        harness: "stagehand",
        verbose: false,
      },
    );

    expect(result._success).toBe(false);
    expect(String(result.error)).toContain(
      formatBenchHarnessFlags(listBenchHarnessesForTaskKind("suite")),
    );
    expect(closeMock).not.toHaveBeenCalled();
  });
});
