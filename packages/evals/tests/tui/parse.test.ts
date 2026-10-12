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

  it("supports HardBench shorthand without an implicit corpus limit", () => {
    const full = applyBenchmarkShorthand("b:hardbenchmark", {});
    expect(full.target).toBe("agent/hardbenchmark");
    expect(full.envOverrides.EVAL_HARDBENCHMARK_LIMIT).toBeUndefined();
    expect(
      applyBenchmarkShorthand("b:hardbenchmark", { limit: 7 }).envOverrides
        .EVAL_HARDBENCHMARK_LIMIT,
    ).toBe("7");
  });

  it("no longer recognizes GAIA (removed benchmark)", () => {
    expect(() => applyBenchmarkShorthand("b:gaia", {})).toThrow(/Unknown benchmark/);
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

describe("resolveRunOptions: tracing config → env overrides", () => {
  it("applies persisted tracing defaults as env overrides when env is unset", () => {
    const resolved = resolveRunOptions(
      {},
      {},
      {},
      {},
      { transport: "otel", braintrustProject: "team-evals", langsmithProject: "ls-proj" },
    );
    expect(resolved.envOverrides.EVAL_TRACE_TRANSPORT).toBe("otel");
    expect(resolved.envOverrides.BRAINTRUST_PROJECT_NAME).toBe("team-evals");
    expect(resolved.envOverrides.LANGSMITH_PROJECT).toBe("ls-proj");
  });

  it("lets an already-set env var win over the persisted default", () => {
    const resolved = resolveRunOptions(
      {},
      {},
      { EVAL_TRACE_TRANSPORT: "native", BRAINTRUST_PROJECT_NAME: "from-env" },
      {},
      { transport: "otel", braintrustProject: "from-config", langsmithProject: "ls-proj" },
    );
    expect(resolved.envOverrides.EVAL_TRACE_TRANSPORT).toBeUndefined();
    expect(resolved.envOverrides.BRAINTRUST_PROJECT_NAME).toBeUndefined();
    expect(resolved.envOverrides.LANGSMITH_PROJECT).toBe("ls-proj");
  });

  it("emits no tracing overrides when the section is absent", () => {
    const resolved = resolveRunOptions({}, {}, {});
    expect(resolved.envOverrides.EVAL_TRACE_TRANSPORT).toBeUndefined();
    expect(resolved.envOverrides.BRAINTRUST_PROJECT_NAME).toBeUndefined();
    expect(resolved.envOverrides.LANGSMITH_PROJECT).toBeUndefined();
  });
});

describe("resolveRunOptions: config v2 sections", () => {
  it("applies defaults.harness and defaults.successMode under flags and env", () => {
    const resolved = resolveRunOptions({}, { harness: "claude_code", successMode: "process" }, {});
    expect(resolved.harness).toBe("claude_code");
    expect(resolved.successMode).toBe("process");
    expect(
      resolveRunOptions({}, { successMode: "process" }, { EVAL_SUCCESS_MODE: "both" }).successMode,
    ).toBe("both");
    expect(resolveRunOptions({ harness: "codex" }, { harness: "claude_code" }, {}).harness).toBe(
      "codex",
    );
  });

  it("turns harnesses/verifier/campaign into env overrides only when the env twin is unset", () => {
    const sections = {
      harnesses: {
        claude_code: { models: ["anthropic/a", "anthropic/b"], tool: "stagehand_facade" },
      },
      verifier: { model: "google/gemini-3.5-flash", maxUnverifiableCriteria: 2 },
      campaign: { tag: "facade-batch-0831" },
      providers: {
        openai: { concurrency: 6 },
        Anthropic: { concurrency: 4 },
        bad: { concurrency: 0 },
      },
    };
    const resolved = resolveRunOptions({ harness: "claude_code" }, {}, {}, {}, {}, sections);
    expect(resolved.envOverrides).toMatchObject({
      EVAL_CLAUDE_CODE_MODELS: "anthropic/a,anthropic/b",
      EVAL_VERIFIER_MODEL: "google/gemini-3.5-flash",
      EVAL_MAX_UNVERIFIABLE_CRITERIA: "2",
      EVAL_CAMPAIGN_TAG: "facade-batch-0831",
    });
    expect(resolved.coreToolSurface).toBe("stagehand_facade");
    expect(resolved.providerConcurrency).toEqual({ openai: 6, anthropic: 4 });

    const shadowed = resolveRunOptions(
      { harness: "claude_code", tool: "browse_cli" },
      {},
      {
        EVAL_CLAUDE_CODE_MODELS: "anthropic/z",
        EVAL_VERIFIER_MODEL: "openai/o",
        EVAL_MAX_UNVERIFIABLE_CRITERIA: "0",
        EVAL_CAMPAIGN_TAG: "shell",
      },
      {},
      {},
      sections,
    );
    expect(shadowed.envOverrides.EVAL_CLAUDE_CODE_MODELS).toBeUndefined();
    expect(shadowed.envOverrides.EVAL_VERIFIER_MODEL).toBeUndefined();
    expect(shadowed.envOverrides.EVAL_MAX_UNVERIFIABLE_CRITERIA).toBeUndefined();
    expect(shadowed.envOverrides.EVAL_CAMPAIGN_TAG).toBeUndefined();
    expect(shadowed.coreToolSurface).toBe("browse_cli");
  });

  it("honours benchmarks.<suite>.limit only when --limit and the env twins are unset", () => {
    const benchmarks = { hardbenchmark: { limit: 46 } };
    expect(applyBenchmarkShorthand("b:hardbenchmark", {}, benchmarks, {}).envOverrides).toEqual({
      EVAL_DATASET: "hardbenchmark",
      EVAL_HARDBENCHMARK_LIMIT: "46",
    });
    expect(
      applyBenchmarkShorthand("b:hardbenchmark", { limit: 5 }, benchmarks, {}).envOverrides,
    ).toMatchObject({ EVAL_MAX_K: "5", EVAL_HARDBENCHMARK_LIMIT: "5" });
    expect(
      applyBenchmarkShorthand("b:hardbenchmark", {}, benchmarks, { EVAL_HARDBENCHMARK_LIMIT: "9" })
        .envOverrides.EVAL_HARDBENCHMARK_LIMIT,
    ).toBeUndefined();
    expect(
      applyBenchmarkShorthand("b:hardbenchmark", {}, benchmarks, { EVAL_MAX_K: "9" }).envOverrides
        .EVAL_HARDBENCHMARK_LIMIT,
    ).toBeUndefined();
  });
});

describe("resolveRunOptions: harnesses.<h>.models", () => {
  it("is ignored for harnesses that pick models per task category (stagehand)", () => {
    const sections = { harnesses: { stagehand: { models: ["openai/x"] } } };
    const resolved = resolveRunOptions({ harness: "stagehand" }, {}, {}, {}, {}, sections);
    expect(resolved.envOverrides.EVAL_STAGEHAND_MODELS).toBeUndefined();
  });
});
