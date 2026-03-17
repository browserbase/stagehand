import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendTopLevelTask,
  ensureWorkspaceLayout,
} from "../../lib/state/session.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("workspace layout", () => {
  test("creates the top-level and subagent workspace folders", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/workspace-layout",
    );
    createdDirs.push(rootDir);

    const layout = await ensureWorkspaceLayout(rootDir);

    expect(layout.rootDir).toBe(rootDir);
    expect(await fs.readFile(layout.todoPath, "utf8")).toContain("Workspace TODO");
    expect(Object.keys(layout.subagents)).toEqual(["1", "2", "3"]);
    await expect(fs.stat(layout.subagents["1"].rootDir)).resolves.toBeTruthy();
    await expect(fs.stat(layout.subagents["2"].logsDir)).resolves.toBeTruthy();
    await expect(fs.readFile(layout.subagents["3"].configPath, "utf8")).resolves.toContain("{}");
  });

  test("appends tasks to the top-level TODO file", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/workspace-tasks",
    );
    createdDirs.push(rootDir);

    const layout = await ensureWorkspaceLayout(rootDir);
    await appendTopLevelTask(layout.todoPath, "Investigate browser startup");

    const todo = await fs.readFile(layout.todoPath, "utf8");
    expect(todo).toContain("Investigate browser startup");
  });
});
