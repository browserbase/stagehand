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
    expect(listBenchSuiteTaskNames()).toEqual(listBenchSuites().map(benchSuiteTaskName));
    expect(benchSuiteTaskName("hardbenchmark")).toBe("agent/hardbenchmark");
  });

  it("guards unknown names", () => {
    expect(isBenchSuite("hardbenchmark")).toBe(true);
    expect(isBenchSuite("gaia")).toBe(false);
  });
});
