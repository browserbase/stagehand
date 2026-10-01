import { describe, expect, it } from "vitest";
import {
  summarizeGates,
  summarizeUsage,
  classifyRowOutcome,
  buildRunSummaryJson,
  collectFailures,
  isDeadJudgeRun,
  summarizeCells,
  summarizeVerifier,
  type SummaryRow,
} from "../../framework/runSummary.js";

function row(
  name: string,
  modelName: string,
  output: Record<string, unknown>,
  toolSurface = "stagehand_facade",
): SummaryRow {
  return {
    name,
    input: { name, modelName, params: { toolSurface } } as SummaryRow["input"],
    output: { _success: false, ...output } as SummaryRow["output"],
  };
}

const DEAD = "Fused judgment call failed: model not found";

const rows: SummaryRow[] = [
  row("t1", "anthropic/claude-sonnet-4-6", {
    _success: true,
    harnessStatus: "completed",
    criterionCount: 4,
    evidenceInsufficient: ["c2"],
    metrics: { facade_tool_calls: { count: 1, value: 12 } },
  }),
  row("t2", "anthropic/claude-sonnet-4-6", {
    _success: true,
    harnessStatus: "completed",
    criterionCount: 3,
    metrics: { facade_tool_calls: { count: 1, value: 0 } },
  }),
  row("t3", "anthropic/claude-sonnet-4-6", {
    harnessStatus: "max_turns",
    harnessStopReason: "50 turns, no final answer",
    criterionCount: 3,
    sessionUrl: "https://www.browserbase.com/sessions/77d2",
  }),
  row("u1", "openai/gpt-5.4-mini", {
    harnessStatus: "sdk_error",
    harnessStopReason: "rate_limit_exceeded (429)",
    sessionUrl: "https://www.browserbase.com/sessions/9ab0",
    providerThrottled: { source: "provider", throttles: 2, retried: true },
  }),
  row("u2", "openai/gpt-5.4-mini", {
    verifierError: DEAD,
    error: "criteria not graded",
  }),
  row("u3", "openai/gpt-5.4-mini", {
    _success: true,
    verifierError: DEAD,
  }),
];

describe("summarizeCells", () => {
  it("keys by harness × tool × model and splits status columns", () => {
    const cells = summarizeCells(rows, "claude_code");
    expect(cells.map((cell) => cell.cell)).toEqual([
      "claude_code × stagehand_facade × anthropic/claude-sonnet-4-6",
      "claude_code × stagehand_facade × openai/gpt-5.4-mini",
    ]);
    expect(cells[0]).toMatchObject({
      total: 3,
      passed: 2,
      maxTurns: 1,
      sdkError: 0,
      gated: 0,
      ungraded: 0,
      retried: 0,
    });
    expect(cells[1]).toMatchObject({
      total: 3,
      passed: 1,
      maxTurns: 0,
      sdkError: 1,
      gated: 0,
      ungraded: 2,
      retried: 1,
    });
  });

  it("omits the tool surface from the key when the row has none", () => {
    const [cell] = summarizeCells(
      [
        {
          name: "t",
          input: { name: "t", modelName: "openai/gpt-4.1-mini" } as SummaryRow["input"],
          output: { _success: true },
        },
      ],
      "stagehand",
    );
    expect(cell.cell).toBe("stagehand × openai/gpt-4.1-mini");
    expect(cell.toolSurface).toBeUndefined();
  });
});

describe("summarizeVerifier / dead judge", () => {
  it("counts graded and ungraded rows", () => {
    const verifier = summarizeVerifier(rows);
    expect(verifier).toEqual({
      attempted: 5,
      graded: 3,
      ungraded: 2,
      unverifiableCriteria: 1,
      totalCriteria: 10,
      passesWithoutBrowserUse: 1,
    });
    expect(isDeadJudgeRun(verifier)).toBe(false);
  });

  it("flags a run where the judge graded nothing, whatever the error text", () => {
    const ungraded = [
      row("a", "openai/gpt-5.4-mini", { verifierError: DEAD }),
      row("b", "openai/gpt-5.4-mini", {
        verifierError:
          "Verifier returned an uncertainty result; no trustworthy grade was produced.",
      }),
    ];
    expect(isDeadJudgeRun(summarizeVerifier(ungraded))).toBe(true);
    expect(isDeadJudgeRun(summarizeVerifier([]))).toBe(false);
    // One graded row is enough signal: partial failures stay report-only.
    expect(isDeadJudgeRun(summarizeVerifier([...ungraded, rows[0]]))).toBe(false);
  });
});

describe("collectFailures", () => {
  it("orders sdk_error → max_turns → ungraded → fail and carries reason + session URL", () => {
    const failures = collectFailures(rows, "codex");
    expect(failures.map((f) => [f.kind, f.task])).toEqual([
      ["sdk_error", "u1"],
      ["max_turns", "t3"],
      ["ungraded", "u2"],
    ]);
    expect(failures[0]).toEqual({
      kind: "sdk_error",
      harness: "codex",
      task: "u1",
      model: "openai/gpt-5.4-mini",
      reason: "rate_limit_exceeded (429)",
      sessionUrl: "https://www.browserbase.com/sessions/9ab0",
    });
    expect(failures[2].reason).toBe(DEAD);
  });

  it("carries the row's log file into failures and the --json summary", () => {
    const logged = row("l1", "openai/gpt-5.4-mini", {
      harnessStatus: "sdk_error",
      harnessStopReason: "stream closed",
      logPath: "/tmp/run/logs/l1__openai-gpt-5.4-mini.log",
    });
    expect(collectFailures([logged], "codex")[0].logPath).toBe(
      "/tmp/run/logs/l1__openai-gpt-5.4-mini.log",
    );
    const json = buildRunSummaryJson({ results: [logged], harness: "codex", experimentName: "x" });
    expect(json.failures[0].logPath).toBe("/tmp/run/logs/l1__openai-gpt-5.4-mini.log");
  });

  it("classifies plain rubric fails and reads error when no stop reason", () => {
    const [failure] = collectFailures(
      [row("z", "openai/gpt-5.4-mini", { error: "wrong answer", criterionCount: 2 })],
      "codex",
    );
    expect(failure).toMatchObject({ kind: "fail", reason: "wrong answer" });
    expect(failure.sessionUrl).toBeUndefined();
  });
});

describe("buildRunSummaryJson", () => {
  it("assembles the CI payload", () => {
    const json = buildRunSummaryJson({
      results: rows,
      harness: "claude_code",
      experimentName: "agent/hardbenchmark-a1b2",
      experimentUrl: "https://www.braintrust.dev/app/x",
      judgeModel: "google/gemini-3.5-flash",
      trajectoryGroup: "agent_hardbenchmark__x",
    });
    expect(json.summary).toEqual({ passed: 3, failed: 3, total: 6, passRate: 50 });
    expect(json.cells).toHaveLength(2);
    expect(json.failures).toHaveLength(3);
    expect(json.deadJudge).toBe(false);
    expect(json.experimentUrl).toBe("https://www.braintrust.dev/app/x");
    expect(json.judgeModel).toBe("google/gemini-3.5-flash");
    expect(json.trajectoryGroup).toBe("agent_hardbenchmark__x");
  });

  it("drops optional fields it does not have and handles empty runs", () => {
    const json = buildRunSummaryJson({ results: [], harness: "codex", experimentName: "empty" });
    expect(json).toEqual({
      experimentName: "empty",
      summary: { passed: 0, failed: 0, total: 0, passRate: 0 },
      usage: { totalTokens: 0, costRows: 0 },
      gates: {},
      cells: [],
      verifier: {
        attempted: 0,
        graded: 0,
        ungraded: 0,
        unverifiableCriteria: 0,
        totalCriteria: 0,
        passesWithoutBrowserUse: 0,
      },
      failures: [],
      deadJudge: false,
    });
  });
});

describe("case identity and gated rows", () => {
  it("names suite failures by case id + site, not the shared suite name", () => {
    const failures = collectFailures(
      [
        {
          name: "agent/hardbenchmark",
          input: {
            name: "agent/hardbenchmark",
            modelName: "openai/gpt-5.4-mini",
            params: { id: "47e314cc452c540524ffb7cf520285a3", web: "https://www.recreation.gov/" },
          } as SummaryRow["input"],
          output: { _success: false, harnessStatus: "max_turns" },
        },
      ],
      "codex",
    );
    expect(failures[0].task).toBe("47e314cc recreation.gov");
  });

  it("classifies judge-passed, gate-failed rows as gated", () => {
    expect(
      classifyRowOutcome({
        _success: false,
        judgeOutcomeSuccess: true,
        outcomeGates: ["no_browser_use"],
      }),
    ).toBe("gated");
    expect(
      classifyRowOutcome({ _success: false, judgeOutcomeSuccess: false, outcomeGates: [] }),
    ).toBe("fail");
    expect(classifyRowOutcome({ _success: true })).toBe("pass");
    const [gated, rubric] = collectFailures(
      [
        row("r", "openai/gpt-5.4-mini", { error: "wrong" }),
        row("g", "openai/gpt-5.4-mini", {
          judgeOutcomeSuccess: true,
          outcomeGates: ["no_final_answer"],
        }),
      ],
      "codex",
    );
    expect([gated.kind, rubric.kind]).toEqual(["gated", "fail"]);
  });
});

describe("usage and gates", () => {
  it("sums tokens, and cost only over the rows that report it", () => {
    const usage = summarizeUsage([
      row("a", "openai/gpt-5.4-mini", {
        metrics: { harness_total_tokens: { count: 1, value: 1200 } },
      }),
      row("b", "anthropic/claude-sonnet-4-6", {
        metrics: {
          harness_total_tokens: { count: 1, value: 800 },
          harness_cost_usd: { count: 1, value: 0.42 },
        },
      }),
    ]);
    expect(usage).toEqual({ totalTokens: 2000, costUsd: 0.42, costRows: 1 });
    expect(summarizeUsage([row("c", "openai/gpt-5.4-mini", {})])).toEqual({
      totalTokens: 0,
      costRows: 0,
    });
  });

  it("counts gated rows per gate and in the cell table", () => {
    const gated = [
      row("g1", "openai/gpt-5.4-mini", {
        judgeOutcomeSuccess: true,
        outcomeGates: ["no_browser_use"],
      }),
      row("g2", "openai/gpt-5.4-mini", {
        judgeOutcomeSuccess: true,
        outcomeGates: ["no_browser_use", "ungrounded_answer"],
      }),
      row("r", "openai/gpt-5.4-mini", { providerThrottled: { retried: true } }),
    ];
    expect(summarizeGates(gated)).toEqual({ no_browser_use: 2, ungrounded_answer: 1 });
    expect(summarizeCells(gated, "codex")[0]).toMatchObject({ gated: 2, retried: 1 });
  });
});
