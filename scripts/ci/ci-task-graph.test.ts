import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const turbo = path.join(root, "node_modules/turbo/bin/turbo");

function taskGraph(command: string, args: string[]): string[] {
  const output = execFileSync(command, [...args, "--dry=json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  const graph = JSON.parse(output) as { tasks: { taskId: string; command: string }[] };
  return graph.tasks.filter((task) => task.command !== "<NONEXISTENT>").map((task) => task.taskId);
}

function turboGraph(args: string[]): string[] {
  return taskGraph(process.execPath, [turbo, "run", ...args]);
}

function scriptGraph(script: string, args: string[] = []): string[] {
  return taskGraph("pnpm", ["--silent", "run", script, ...args]);
}

describe("CI task isolation", () => {
  it.each([
    ["build:core", "@browserbasehq/stagehand#build"],
    ["check:core", "@browserbasehq/stagehand#typecheck"],
    ["test:unit:core", "@browserbasehq/stagehand#test:unit"],
  ])(
    "keeps %s independent of Browse and evals",
    (script, requiredTask) => {
      // Resolve the real dependency closure without executing the selected tests.
      const tasks = scriptGraph(script);
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
    const tasks = turboGraph(["build", "--filter=browse"]);
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
    const tasks = turboGraph([
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

  it("assigns every existing workspace check to a CI scope", () => {
    const checks = ["build", "fmt:check", "lint", "typecheck", "test:unit"];
    const allTasks = turboGraph(checks);
    const ownedTasks = new Set([
      ...scriptGraph("build:core"),
      ...scriptGraph("check:core"),
      ...scriptGraph("test:unit:core"),
      ...turboGraph(["build", "lint", "--filter=browse"]),
      ...turboGraph(["build", "typecheck", "test:unit", "--filter=@browserbasehq/stagehand-evals"]),
    ]);

    // A new package family must be assigned to a scope instead of silently
    // losing checks when the core scope uses positive package selectors.
    expect(allTasks.filter((task) => !ownedTasks.has(task))).toEqual([]);
  }, 30_000);
});
