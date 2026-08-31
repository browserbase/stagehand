import { afterEach, describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { AGENT_RUN_TOOL_NAME } from "../../core/contracts/tool.js";
import { claudeCodeAdapter } from "../../framework/harnesses/claudeCodeAdapter.js";
import { codexAdapter } from "../../framework/harnesses/codexAdapter.js";
import {
  harnessObservationsEnabled,
  ObservationRecorder,
} from "../../framework/observationRecorder.js";
import {
  armsOverLimit,
  armsWithPassesWithoutBrowserUse,
  armsWithUngradedRuns,
  resolveUnverifiableCriteriaLimit,
  summarizeArmVerifiability,
} from "../../framework/verifierGate.js";

const TASK_SPEC: TaskSpec = { id: "t", instruction: "do the thing" };

describe("observation recorder", () => {
  afterEach(() => {
    delete process.env.EVAL_HARNESS_OBSERVATIONS;
    delete process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA;
  });

  it("observes by default and can be disabled per run", () => {
    expect(harnessObservationsEnabled()).toBe(true);
    process.env.EVAL_HARNESS_OBSERVATIONS = "none";
    expect(harnessObservationsEnabled()).toBe(false);
  });

  it("indexes observations by run and leaves gaps on capture failure", async () => {
    let call = 0;
    const recorder = new ObservationRecorder(async () => {
      call += 1;
      if (call === 2) throw new Error("probe failed");
      return { url: `https://example.com/${call}` };
    });
    await recorder.record();
    await recorder.record();
    await recorder.record();
    expect(recorder.drain().map((o) => [o.runIndex, o.evidence.url])).toEqual([
      [0, "https://example.com/1"],
      [2, "https://example.com/3"],
    ]);
    expect(recorder.drain()).toEqual([]);
  });

  it("settle() waits for in-flight captures before drain", async () => {
    let release: (() => void) | undefined;
    const recorder = new ObservationRecorder(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ url: "https://example.com/late" });
        }),
    );
    // Fire-and-forget, as the MCP tool-result stream does.
    void recorder.record();
    expect(recorder.drain()).toEqual([]);
    const settled = recorder.settle();
    release?.();
    await settled;
    expect(recorder.drain().map((o) => o.evidence.url)).toEqual(["https://example.com/late"]);
  });

  it("drops empty artifacts", async () => {
    const recorder = new ObservationRecorder(async () => ({}));
    await recorder.record();
    expect(recorder.drain()).toEqual([]);
  });
});

describe("per-step observations in trajectories", () => {
  it("attaches claude_code observations to run-tool steps only", () => {
    const messages = [
      assistantToolUse("u1", "Bash", { command: "ls" }),
      toolResult("u1", "ok"),
      assistantToolUse("u2", AGENT_RUN_TOOL_NAME, { code: "await page.goto(startUrl)" }),
      toolResult("u2", "done"),
      assistantToolUse("u3", AGENT_RUN_TOOL_NAME, { code: "await page.title()" }),
      toolResult("u3", "Example"),
    ];
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      {
        messages,
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
        finalObservation: {
          url: "https://example.com/final",
          screenshot: Buffer.from("final"),
        },
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((s) => s.probeEvidence.url)).toEqual([
      undefined,
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(trajectory.finalObservation?.url).toBe("https://example.com/final");
  });

  it("attaches codex observations to bridge-run steps only", () => {
    const events = [
      commandExecution("cat notes.txt"),
      commandExecution("node browser_run.mjs snippet.js"),
      commandExecution("node browser_run.mjs snippet2.js"),
    ];
    const trajectory = codexAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [{ runIndex: 1, evidence: { url: "https://example.com/second" } }],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((s) => s.probeEvidence.url)).toEqual([
      undefined,
      undefined,
      "https://example.com/second",
    ]);
  });

  it("maps the Nth codex observation to the Nth bridge run", () => {
    const events = [
      commandExecution("node browser_run.mjs a.js"),
      commandExecution("ls"),
      commandExecution("node browser_run.mjs b.js"),
    ];
    const trajectory = codexAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((s) => s.probeEvidence.url)).toEqual([
      "https://example.com/a",
      undefined,
      "https://example.com/b",
    ]);
  });

  it("attaches claude_code observations to MCP tool steps under an observedToolName matcher", () => {
    const messages = [
      assistantToolUse("u1", "Bash", { command: "ls" }),
      toolResult("u1", "ok"),
      assistantToolUse("u2", "mcp__playwright__browser_navigate", { url: "https://example.com" }),
      toolResult("u2", "navigated"),
      assistantToolUse("u3", "mcp__playwright__browser_click", { selector: "#go" }),
      toolResult("u3", "clicked"),
    ];
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      {
        messages,
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
        observedToolName: (name) => name.startsWith("mcp__playwright__"),
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((s) => s.probeEvidence.url)).toEqual([
      undefined,
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("attaches codex observations to mcp_tool_call steps under an observedToolName matcher", () => {
    const events = [
      commandExecution("ls"),
      mcpToolCall("playwright", "browser_navigate"),
      mcpToolCall("playwright", "browser_click"),
    ];
    const trajectory = codexAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
        observedToolName: (name) => name.startsWith("playwright."),
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((s) => s.probeEvidence.url)).toEqual([
      undefined,
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("attaches no codex observations when bridge runs outnumber matched steps", () => {
    // Two recorded bridge runs but only one command matches the filter —
    // ordinals could be shifted, so misattribution must be refused.
    const events = [commandExecution("node browser_run.mjs a.js"), commandExecution("ls")];
    const trajectory = codexAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.every((s) => s.probeEvidence.url === undefined)).toBe(true);
  });
});

describe("verifiability gate", () => {
  afterEach(() => {
    delete process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA;
  });

  it("aggregates unverifiable criteria per arm and skips ungraded runs", () => {
    const arms = summarizeArmVerifiability(
      [
        row("model-a", "stagehand_code", { criterionCount: 4, evidenceInsufficient: ["c1"] }),
        row("model-a", "stagehand_code", { criterionCount: 3, evidenceInsufficient: [] }),
        row("model-a", "playwright_code", {
          criterionCount: 5,
          evidenceInsufficient: ["c1", "c2"],
        }),
        row("model-a", "stagehand_code", {}),
      ],
      "claude_code",
    );
    expect(arms).toEqual([
      {
        arm: "claude_code × stagehand_code × model-a",
        gradedRuns: 2,
        ungradedRuns: 0,
        unverifiableCriteria: 1,
        totalCriteria: 7,
        passesWithoutBrowserUse: 0,
      },
      {
        arm: "claude_code × playwright_code × model-a",
        gradedRuns: 1,
        ungradedRuns: 0,
        unverifiableCriteria: 2,
        totalCriteria: 5,
        passesWithoutBrowserUse: 0,
      },
    ]);
  });

  it("gates arms over the limit; unset env reports only", () => {
    expect(resolveUnverifiableCriteriaLimit()).toBeUndefined();
    process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA = "1";
    expect(resolveUnverifiableCriteriaLimit()).toBe(1);
    const arms = [
      {
        arm: "a",
        gradedRuns: 1,
        ungradedRuns: 0,
        unverifiableCriteria: 1,
        totalCriteria: 4,
        passesWithoutBrowserUse: 0,
      },
      {
        arm: "b",
        gradedRuns: 1,
        ungradedRuns: 0,
        unverifiableCriteria: 2,
        totalCriteria: 4,
        passesWithoutBrowserUse: 0,
      },
    ];
    expect(armsOverLimit(arms, 1).map((a) => a.arm)).toEqual(["b"]);
  });

  it("counts verifier-failed rows as ungraded runs on their arm", () => {
    const arms = summarizeArmVerifiability(
      [
        {
          input: { name: "agent/webvoyager", modelName: "m" as never },
          output: { criterionCount: 3, evidenceInsufficient: [] },
        },
        {
          input: { name: "agent/webvoyager", modelName: "m" as never },
          output: { verifierError: "rubric generation failed", _success: true },
        },
      ],
      "claude_code",
    );
    expect(arms).toHaveLength(1);
    expect(arms[0].gradedRuns).toBe(1);
    expect(arms[0].ungradedRuns).toBe(1);
    expect(armsWithUngradedRuns(arms).map((a) => a.arm)).toEqual([arms[0].arm]);
  });

  it("counts passes that never called the mounted browser surface", () => {
    const arms = summarizeArmVerifiability(
      [
        row("m", "stagehand_facade", {
          criterionCount: 3,
          evidenceInsufficient: [],
          _success: true,
          metrics: { facade_tool_calls: { count: 1, value: 0 } },
        }),
        row("m", "stagehand_facade", {
          criterionCount: 3,
          evidenceInsufficient: [],
          _success: true,
          metrics: { facade_tool_calls: { count: 1, value: 4 } },
        }),
        row("m", "stagehand_facade", {
          criterionCount: 3,
          evidenceInsufficient: [],
          _success: false,
          metrics: { facade_tool_calls: { count: 1, value: 0 } },
        }),
        // No facade metric at all (older rows): not counted either way.
        row("m", "stagehand_facade", { criterionCount: 3, evidenceInsufficient: [], _success: true }),
      ],
      "codex",
    );
    expect(arms).toHaveLength(1);
    expect(arms[0].gradedRuns).toBe(4);
    expect(arms[0].passesWithoutBrowserUse).toBe(1);
    expect(armsWithPassesWithoutBrowserUse(arms).map((a) => a.arm)).toEqual([arms[0].arm]);
  });

  it("treats malformed limit values as report-only", () => {
    for (const raw of ["1.5", "10foo", "-2", "", " "]) {
      process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA = raw;
      expect(resolveUnverifiableCriteriaLimit()).toBeUndefined();
    }
    process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA = " 3 ";
    expect(resolveUnverifiableCriteriaLimit()).toBe(3);
  });
});

function assistantToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  };
}

function toolResult(toolUseId: string, text: string): Record<string, unknown> {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
    },
  };
}

function mcpToolCall(server: string, tool: string): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server,
      tool,
      arguments: {},
      status: "completed",
    },
  };
}

function commandExecution(command: string): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      type: "command_execution",
      command,
      aggregated_output: "ok",
      exit_code: 0,
      status: "completed",
    },
  };
}

function row(
  modelName: string,
  toolSurface: string,
  output: Record<string, unknown>,
): {
  input: { name: string; modelName: never; params: Record<string, unknown> };
  output: Record<string, unknown>;
} {
  return {
    input: {
      name: "task",
      modelName: modelName as never,
      params: { toolSurface },
    },
    output,
  };
}
