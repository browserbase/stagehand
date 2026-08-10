import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { executeBenchTask } from "../../framework/benchRunner.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";

const tempDirs: string[] = [];
const closeMock = vi.fn(async () => {});

vi.mock("../../initV3.js", () => ({
  initV3: vi.fn(async ({ logger, modelName }) => ({
    v3: {
      context: {
        pages: () => [{}],
      },
      close: closeMock,
      browserbaseSessionURL: "https://www.browserbase.com/sessions/session-123",
      browserbaseDebugURL: "https://debug.browserbase.test/session-123",
    },
    logger,
    modelName,
    sessionUrl: "https://www.browserbase.com/sessions/session-123",
    debugUrl: "https://debug.browserbase.test/session-123",
  })),
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bench runner", () => {
  it("attaches Browserbase session URLs to legacy bench task results", async () => {
    const taskDir = makeTempDir();
    const taskFile = path.join(taskDir, "session_url_task.mjs");
    fs.writeFileSync(
      taskFile,
      `
      export const session_url_task = async () => ({
        _success: true,
        sessionUrl: "",
        debugUrl: "",
      });
      `,
    );

    const task: DiscoveredTask = {
      name: "act/session_url_task",
      tier: "bench",
      primaryCategory: "act",
      categories: ["act"],
      tags: [],
      filePath: taskFile,
      isLegacy: true,
    };

    const result = await executeBenchTask(
      {
        name: task.name,
        modelName: "gpt-4o-mini" as AvailableModel,
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

    expect(result).toMatchObject({
      _success: true,
      sessionUrl: "https://www.browserbase.com/sessions/session-123",
      debugUrl: "https://debug.browserbase.test/session-123",
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
