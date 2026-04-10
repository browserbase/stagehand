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

    scaffoldTask(["core", "navigation", "my_task"]);

    expect(
      fs.existsSync(
        path.join(packageRoot, "core", "tasks", "navigation", "my_task.ts"),
      ),
    ).toBe(true);
  });

  it("keeps bench tasks under tasks/bench", async () => {
    const { scaffoldTask } = await import("../../tui/commands/new.js");

    scaffoldTask(["bench", "act", "my_task"]);

    expect(
      fs.existsSync(
        path.join(packageRoot, "tasks", "bench", "act", "my_task.ts"),
      ),
    ).toBe(true);
  });
});
