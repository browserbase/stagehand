import { afterEach, describe, expect, it } from "vitest";
import {
  applyBenchmarkShorthand,
  parseRunArgs,
  resolveRunOptions,
  withEnvOverrides,
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

  it("accepts explicit agent modes", () => {
    for (const agentMode of ["dom", "hybrid", "cua"] as const) {
      const flags = parseRunArgs(["b:webvoyager", "--agent-mode", agentMode]);
      const resolved = resolveRunOptions(flags, {}, {});
      expect(resolved.agentMode).toBe(agentMode);
    }
  });

  it("accepts explicit agent mode matrices", () => {
    const flags = parseRunArgs(["b:webvoyager", "--agent-modes", "dom,hybrid,cua,dom"]);
    const resolved = resolveRunOptions(flags, {}, {});

    expect(resolved.agentMode).toBeUndefined();
    expect(resolved.agentModes).toEqual(["dom", "hybrid", "cua"]);
  });

  it("lets single agent mode override configured mode matrices", () => {
    const flags = parseRunArgs([
      "b:webvoyager",
      "--agent-mode",
      "dom",
      "--agent-modes",
      "hybrid,cua",
    ]);
    const resolved = resolveRunOptions(flags, { agentModes: ["cua"] }, {});

    expect(resolved.agentMode).toBe("dom");
    expect(resolved.agentModes).toBeUndefined();
  });

  it("respects agent mode matrices from config defaults", () => {
    const resolved = resolveRunOptions({}, { agentModes: ["dom", "hybrid"] }, {});

    expect(resolved.agentModes).toEqual(["dom", "hybrid"]);
  });

  it("rejects unknown agent modes", () => {
    expect(() => parseRunArgs(["b:webvoyager", "--agent-mode", "visual"])).toThrow(/agent-mode/);
    expect(() => parseRunArgs(["b:webvoyager", "--agent-modes", "dom,visual"])).toThrow(
      /agent-mode/,
    );
  });

  it("rejects unknown bench harnesses", () => {
    expect(() => resolveRunOptions({ harness: "not_a_harness" }, {}, {})).toThrow(
      /Unknown harness/,
    );
  });

  it("supports active unified benchmark shorthands", () => {
    const resolved = applyBenchmarkShorthand("b:webvoyager", { limit: 5 });
    expect(resolved.target).toBe("agent/webvoyager");
    expect(resolved.datasetFilter).toBe("webvoyager");
    expect(resolved.envOverrides.EVAL_DATASET).toBe("webvoyager");
    expect(resolved.envOverrides.EVAL_WEBVOYAGER_LIMIT).toBe("5");

    const webtailbench = applyBenchmarkShorthand("b:webtailbench", {
      limit: 2,
    });
    expect(webtailbench.target).toBe("agent/webtailbench");
    expect(webtailbench.datasetFilter).toBe("webtailbench");
    expect(webtailbench.envOverrides.EVAL_WEBTAILBENCH_LIMIT).toBe("2");
  });

  it("marks GAIA as legacy-only in the unified runner", () => {
    expect(() => applyBenchmarkShorthand("b:gaia", {})).toThrow(/legacy-only/);
  });

  it("does not advertise nonexistent WebBench", () => {
    expect(() => applyBenchmarkShorthand("b:webbench", {})).toThrow(/Unknown benchmark/);
  });

  it("rejects missing and invalid numeric run flags", () => {
    expect(() => parseRunArgs(["act", "--trials"])).toThrow(/Missing value/);
    expect(() => parseRunArgs(["act", "--trials", "2abc"])).toThrow(/positive integer/);
    expect(() => parseRunArgs(["act", "--concurrency", "0"])).toThrow(/positive integer/);
  });

  it("rejects invalid env and malformed filters", () => {
    expect(() => parseRunArgs(["act", "--env", "mars"])).toThrow(/local.*browserbase/);
    expect(() => parseRunArgs(["b:webvoyager", "--filter", "bad"])).toThrow(/key=value/);
  });
});

describe("withEnvOverrides", () => {
  const stamped = ["EVAL_TRAJECTORY_GROUP", "EVAL_EXPERIMENT_NAME", "EVAL_TRAJECTORY_MODEL"];

  afterEach(() => {
    for (const key of [...stamped, "EVAL_ENV"]) delete process.env[key];
  });

  it("restores declared overrides", async () => {
    delete process.env.EVAL_ENV;
    await withEnvOverrides({ EVAL_ENV: "BROWSERBASE" }, async () => {
      expect(process.env.EVAL_ENV).toBe("BROWSERBASE");
    });
    expect(process.env.EVAL_ENV).toBeUndefined();
  });

  it("does not leak env a run stamps from the inside", async () => {
    // The REPL is long-lived: a run stamps its trajectory group directly onto
    // process.env (the value is only known once testcases are generated, so it
    // can't be declared as an override). It must not survive the command.
    await withEnvOverrides({}, async () => {
      process.env.EVAL_TRAJECTORY_GROUP = "agent__20260716-110342-9f3a1c";
      process.env.EVAL_EXPERIMENT_NAME = "agent";
      process.env.EVAL_TRAJECTORY_MODEL = "openai/gpt-4.1-mini";
    });

    for (const key of stamped) expect(process.env[key]).toBeUndefined();
  });

  it("restores a run-stamped key to its prior value rather than deleting it", async () => {
    process.env.EVAL_TRAJECTORY_GROUP = "pre-existing";

    await withEnvOverrides({}, async () => {
      process.env.EVAL_TRAJECTORY_GROUP = "clobbered-by-run";
    });

    expect(process.env.EVAL_TRAJECTORY_GROUP).toBe("pre-existing");
  });
});
