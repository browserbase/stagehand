import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
let packageRoot = "";

vi.mock("../../runtimePaths.js", () => ({
  getPackageRootDir: () => packageRoot,
}));

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-new-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  packageRoot = makeTempRoot();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffoldTask", () => {
  it("creates core tasks under core/tasks so discovery can find them", async () => {
    const { scaffoldTask } = await import("../../tui/commands/new.js");

    const task = scaffoldTask(["core", "navigation", "my_task"]);

    expect(
      fs.existsSync(
        path.join(packageRoot, "core", "tasks", "navigation", "my_task.ts"),
      ),
    ).toBe(true);
    expect(task?.displayPath).toBe("core/tasks/navigation/my_task.ts");
  });

  it("keeps bench tasks under tasks/bench", async () => {
    const { scaffoldTask } = await import("../../tui/commands/new.js");

    const task = scaffoldTask(["bench", "act", "my_task"]);

    expect(
      fs.existsSync(
        path.join(packageRoot, "tasks", "bench", "act", "my_task.ts"),
      ),
    ).toBe(true);
    expect(task?.displayPath).toBe("tasks/bench/act/my_task.ts");
  });

  it("returns generated content without entering a repl edit flow", async () => {
    const { scaffoldTask } = await import("../../tui/commands/new.js");

    const task = scaffoldTask(["bench", "observe", "test"]);
    expect(task?.content).toContain('await page.goto("https://example.com");');
    expect(task?.content).toContain("// TODO: implement eval logic");
  });

  it("rejects category path traversal", async () => {
    const { scaffoldTask } = await import("../../tui/commands/new.js");

    const task = scaffoldTask(["bench", "../../outside", "my_task"]);

    expect(task).toBeNull();
    expect(fs.existsSync(path.join(packageRoot, "outside"))).toBe(false);
  });
});
