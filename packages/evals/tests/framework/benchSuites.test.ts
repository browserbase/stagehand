import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  benchSuiteTaskName,
  isBenchSuite,
  listBenchSuiteTaskNames,
  listBenchSuites,
} from "../../framework/benchSuites.js";

describe("benchSuites registry", () => {
  it("lists short names and their agent/ task names in order", () => {
    expect(listBenchSuites()).toEqual([
      "webvoyager",
      "onlineMind2Web",
      "webtailbench",
      "hardbenchmark",
      "odysseysbench",
    ]);
    expect(listBenchSuiteTaskNames()).toEqual([
      "agent/webvoyager",
      "agent/onlineMind2Web",
      "agent/webtailbench",
      "agent/hardbenchmark",
      "agent/odysseysbench",
    ]);
    expect(benchSuiteTaskName("hardbenchmark")).toBe("agent/hardbenchmark");
  });

  it("is what discovery registers as bench suites", async () => {
    const { discoverTasks } = await import("../../framework/discovery.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evals-suites-"));
    try {
      const registry = await discoverTasks(root);
      expect((registry.byTier.get("bench") ?? []).map((task) => task.name)).toEqual(
        listBenchSuiteTaskNames(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("guards unknown names", () => {
    expect(isBenchSuite("hardbenchmark")).toBe(true);
    expect(isBenchSuite("gaia")).toBe(false);
  });
});
