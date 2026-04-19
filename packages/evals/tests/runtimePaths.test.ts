import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveRuntimeTasksRoot } from "../runtimePaths.js";

describe("resolveRuntimeTasksRoot", () => {
  it("uses source tasks for source-mode callers", () => {
    const packageRoot = "/repo/packages/evals";
    const caller = "/repo/packages/evals/cli.ts";

    expect(resolveRuntimeTasksRoot(caller, packageRoot)).toBe(
      path.join(packageRoot, "tasks"),
    );
  });

  it("keeps built CLI callers on the source task tree", () => {
    const packageRoot = "/repo/packages/evals";
    const caller = "/repo/packages/evals/dist/cli/cli.js";

    expect(resolveRuntimeTasksRoot(caller, packageRoot)).toBe(
      path.join(packageRoot, "tasks"),
    );
  });
});
