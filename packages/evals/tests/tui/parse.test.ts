import { describe, expect, it } from "vitest";
import {
  applyBenchmarkShorthand,
  parseRunArgs,
  resolveRunOptions,
} from "../../tui/commands/parse.js";

describe("resolveRunOptions", () => {
  it("defaults verbose to false", () => {
    const resolved = resolveRunOptions({}, {}, {});
    expect(resolved.verbose).toBe(false);
  });

  it("respects verbose from config defaults", () => {
    const resolved = resolveRunOptions({}, { verbose: true }, {});
    expect(resolved.verbose).toBe(true);
  });

  it("defaults to the stagehand bench harness", () => {
    const resolved = resolveRunOptions({}, {}, {});
    expect(resolved.harness).toBe("stagehand");
  });

  it("accepts known bench harnesses", () => {
    const resolved = resolveRunOptions({ harness: "claude_code" }, {}, {});
    expect(resolved.harness).toBe("claude_code");
  });

  it("rejects unknown bench harnesses", () => {
    expect(() =>
      resolveRunOptions({ harness: "not_a_harness" }, {}, {}),
    ).toThrow(/Unknown harness/);
  });

  it("supports active unified benchmark shorthands", () => {
    const resolved = applyBenchmarkShorthand("b:webvoyager", { limit: 5 });
    expect(resolved.target).toBe("agent/webvoyager");
    expect(resolved.datasetFilter).toBe("webvoyager");
    expect(resolved.envOverrides.EVAL_DATASET).toBe("webvoyager");
    expect(resolved.envOverrides.EVAL_WEBVOYAGER_LIMIT).toBe("5");
  });

  it("marks GAIA as legacy-only in the unified runner", () => {
    expect(() => applyBenchmarkShorthand("b:gaia", {})).toThrow(
      /legacy-only/,
    );
  });

  it("does not advertise nonexistent WebBench", () => {
    expect(() => applyBenchmarkShorthand("b:webbench", {})).toThrow(
      /Unknown benchmark/,
    );
  });

  it("rejects missing and invalid numeric run flags", () => {
    expect(() => parseRunArgs(["act", "--trials"])).toThrow(/Missing value/);
    expect(() => parseRunArgs(["act", "--trials", "2abc"])).toThrow(
      /positive integer/,
    );
    expect(() => parseRunArgs(["act", "--concurrency", "0"])).toThrow(
      /positive integer/,
    );
  });

  it("rejects invalid env and malformed filters", () => {
    expect(() => parseRunArgs(["act", "--env", "mars"])).toThrow(
      /local.*browserbase/,
    );
    expect(() => parseRunArgs(["b:webvoyager", "--filter", "bad"])).toThrow(
      /key=value/,
    );
  });
});
