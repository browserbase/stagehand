import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const turbo = path.join(root, "node_modules/turbo/bin/turbo");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

function taskGraph(args: string[]): string[] {
  const output = execFileSync(process.execPath, [turbo, ...args, "--dry=json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const graph = JSON.parse(output) as { tasks: { taskId: string }[] };
  return graph.tasks.map((task) => task.taskId);
}

describe("CI task isolation", () => {
  it.each([
    ["build:core", "@browserbasehq/stagehand#build"],
    ["check:core", "@browserbasehq/stagehand#typecheck"],
    ["test:unit:core", "@browserbasehq/stagehand#test:unit"],
  ])(
    "keeps %s independent of Browse and evals",
    (script, requiredTask) => {
      const [runner, ...args] = manifest.scripts[script].split(/\s+/);
      expect(runner).toBe("turbo");
      // Resolve the real dependency closure without executing the selected tests.
      const tasks = taskGraph(args);
      expect(tasks).toContain(requiredTask);
      expect(tasks).not.toContain("//#lint:cli");
      expect(
        tasks.filter(
          (task) =>
            task.startsWith("browse#") || task.startsWith("@browserbasehq/stagehand-evals#"),
        ),
      ).toEqual([]);
    },
    30_000,
  );

  it("builds Browse with its SDK, extension, and protocol dependencies", () => {
    const tasks = taskGraph(["run", "build", "--filter=browse"]);
    expect(tasks).toEqual(
      expect.arrayContaining([
        "browse#build",
        "@browserbasehq/stagehand#build",
        "@browserbasehq/stagehand-extension#build",
        "@browserbasehq/stagehand-protocol#build",
      ]),
    );
    expect(tasks.some((task) => task.startsWith("@browserbasehq/stagehand-evals#"))).toBe(false);
  }, 30_000);

  it("preserves independent eval checks and their Browse dependency", () => {
    const tasks = taskGraph([
      "run",
      "build",
      "typecheck",
      "test:unit",
      "--filter=@browserbasehq/stagehand-evals",
    ]);
    expect(tasks).toEqual(
      expect.arrayContaining([
        "@browserbasehq/stagehand-evals#build",
        "@browserbasehq/stagehand-evals#typecheck",
        "@browserbasehq/stagehand-evals#test:unit",
        "browse#build",
      ]),
    );
    expect(tasks).not.toContain("@browserbasehq/stagehand#test:unit");
  }, 30_000);
});
