import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { SubagentRuntime } from "../../lib/SubagentRuntime.js";
import { ensureWorkspaceLayout } from "../../lib/workspace.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("SubagentRuntime queue", () => {
  test("serializes queued agent tasks and rewrites TODO state", async () => {
    const rootDir = path.join(process.cwd(), "packages/agent/.tmp/subagent-queue");
    createdDirs.push(rootDir);

    const layout = await ensureWorkspaceLayout(rootDir);
    const executions: string[] = [];

    const runtime = new SubagentRuntime({
      browserId: "1",
      workspace: layout.subagents["1"],
      stagehandFactory: () =>
        ({
          async init() {},
          async close() {},
          agent() {
            return {
              execute: async (input: { instruction: string }) => {
                executions.push(input.instruction);
                return { ok: true, instruction: input.instruction };
              },
            };
          },
          context: {
            pages() {
              return [];
            },
            resolvePageByMainFrameId() {
              return undefined;
            },
            async awaitActivePage() {
              return null;
            },
          },
        }) as never,
    });

    const first = runtime.enqueueDelegatedTask({ instruction: "first task" });
    const second = runtime.enqueueDelegatedTask({ instruction: "second task" });

    await expect(first).resolves.toEqual({ ok: true, instruction: "first task" });
    await expect(second).resolves.toEqual({ ok: true, instruction: "second task" });
    expect(executions).toEqual(["first task", "second task"]);

    const queue = await runtime.readTaskQueue();
    expect(queue.map((item) => item.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(queue.map((item) => item.instruction)).toEqual([
      "first task",
      "second task",
    ]);
  });
});
