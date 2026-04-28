import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTasks, resolveTarget } from "../../framework/discovery.js";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-discovery-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, contents = "export default {};\n"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("discovery", () => {
  it("discovers core tasks from core/tasks", async () => {
    const root = makeTempRoot();
    const tasksRoot = path.join(root, "tasks");

    writeFile(path.join(root, "core", "tasks", "navigation", "open.ts"));
    writeFile(path.join(tasksRoot, "bench", "act", "dropdown.ts"));

    const registry = await discoverTasks(tasksRoot, false);
    const openTasks = registry.tasks.filter(
      (task) => task.name === "navigation/open",
    );

    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].tier).toBe("core");
    expect(openTasks[0].filePath).toContain(
      `${path.sep}core${path.sep}tasks${path.sep}`,
    );
  });

  it("does not discover legacy tasks/core anymore", async () => {
    const root = makeTempRoot();
    const tasksRoot = path.join(root, "tasks");

    writeFile(path.join(tasksRoot, "core", "navigation", "open.ts"));

    const registry = await discoverTasks(tasksRoot, false);
    const openTask = registry.byName.get("navigation/open");

    expect(openTask).toBeUndefined();
  });

  it("still resolves short core task names via partial match", async () => {
    const root = makeTempRoot();
    const tasksRoot = path.join(root, "tasks");

    writeFile(path.join(root, "core", "tasks", "navigation", "open.ts"));

    const registry = await discoverTasks(tasksRoot, false);
    const tasks = resolveTarget(registry, "open");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("navigation/open");
    expect(tasks[0].tier).toBe("core");
  });

  it("applies legacy cross-cutting categories to category-qualified bench names", async () => {
    const root = makeTempRoot();
    const tasksRoot = path.join(root, "tasks");

    writeFile(path.join(tasksRoot, "bench", "observe", "observe_github.ts"));

    const registry = await discoverTasks(tasksRoot, false);
    const tasks = resolveTarget(registry, "regression");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("observe/observe_github");
    expect(tasks[0].categories).toEqual(["observe", "regression"]);
  });

  it("rejects empty tier-qualified category targets", async () => {
    const root = makeTempRoot();
    const tasksRoot = path.join(root, "tasks");

    writeFile(path.join(root, "core", "tasks", "navigation", "open.ts"));

    const registry = await discoverTasks(tasksRoot, false);

    expect(() => resolveTarget(registry, "core:not_real")).toThrow(
      /No tasks found matching "core:not_real"/,
    );
  });
});
