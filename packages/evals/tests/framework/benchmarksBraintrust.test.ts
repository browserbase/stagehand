import { describe, expect, it } from "vitest";
import {
  benchmarkRunMetadata,
  benchmarkRunnerOptions,
  buildBenchmarkExperimentName,
  sdkForToolSurface,
} from "../../benchmarks/braintrust.js";
import type { BenchmarkCombination } from "../../benchmarks/schema.js";

const combination: BenchmarkCombination = {
  benchmark: "v4-vs-playwright",
  model: "anthropic/claude-haiku-4-5",
  harness: "stagehand",
  toolSurface: "v4_code",
  target: { kind: "tasks", include: ["act/dropdown"] },
  trials: 3,
};

describe("sdkForToolSurface", () => {
  it("maps the SDK code surfaces and nothing else", () => {
    expect(sdkForToolSurface("understudy_code")).toBe("v3");
    expect(sdkForToolSurface("v4_code")).toBe("v4");
    expect(sdkForToolSurface("playwright_mcp")).toBeUndefined();
    expect(sdkForToolSurface("cdp_code")).toBeUndefined();
  });
});

describe("buildBenchmarkExperimentName", () => {
  it("is self-describing and deterministic", () => {
    const name = buildBenchmarkExperimentName({
      benchmark: {
        name: "v4-vs-playwright",
        harness: "stagehand",
        toolSurface: "v4_code",
      },
      environment: "BROWSERBASE",
      model: "anthropic/claude-haiku-4-5",
      date: "2026-07-23",
    });
    expect(name).toBe(
      "v4-vs-playwright__stagehand__v4_code__browserbase__claude-haiku-4-5__2026-07-23",
    );
  });

  it("falls back to multi for mixed-model runs", () => {
    const name = buildBenchmarkExperimentName({
      benchmark: {
        name: "b",
        harness: "codex",
        toolSurface: "playwright_mcp",
      },
      environment: "LOCAL",
      date: "2026-07-23",
    });
    expect(name).toBe("b__codex__playwright_mcp__local__multi__2026-07-23");
  });
});

describe("benchmarkRunnerOptions", () => {
  it("carries the triple, model, trials, and inferred sdk", () => {
    const opts = benchmarkRunnerOptions(combination);
    expect(opts).toEqual({
      modelOverride: "anthropic/claude-haiku-4-5",
      harness: "stagehand",
      trials: 3,
      sdk: "v4",
      benchmark: {
        name: "v4-vs-playwright",
        harness: "stagehand",
        toolSurface: "v4_code",
      },
    });
  });

  it("omits sdk for non-SDK surfaces", () => {
    const opts = benchmarkRunnerOptions({
      ...combination,
      harness: "claude_code",
      toolSurface: "chrome_devtools_mcp",
    });
    expect(opts.sdk).toBeUndefined();
    expect(opts.benchmark.toolSurface).toBe("chrome_devtools_mcp");
  });
});

describe("benchmarkRunMetadata", () => {
  it("stamps the full triple", () => {
    expect(
      benchmarkRunMetadata({
        name: "v4-vs-playwright",
        harness: "stagehand",
        toolSurface: "v4_code",
      }),
    ).toEqual({
      benchmark: "v4-vs-playwright",
      harness: "stagehand",
      toolSurface: "v4_code",
    });
  });
});
