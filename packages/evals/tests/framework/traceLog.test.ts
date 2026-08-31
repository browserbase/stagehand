import { describe, expect, it } from "vitest";
import type { Trajectory } from "stagehand-v3";
import {
  buildTrajectoryTraceLines,
  emitTrajectoryTrace,
  shortToolName,
  TRACE_AUXILIARY_MAX_CHARS,
  type TrajectoryTraceInput,
} from "../../framework/harnesses/traceLog.js";
import { buildTrajectory } from "../../framework/harnesses/trajectoryAdapter.js";

const taskSpec = { id: "wv-1", instruction: "Find the title", initUrl: "https://example.com" };

function threeStepTrajectory(): Trajectory {
  return buildTrajectory({
    taskSpec,
    toolCalls: [
      {
        name: "mcp__stagehand__run",
        args: { code: "await page.goto('https://example.com');\n  return page.title();" },
        result: "Example Domain",
        ok: true,
        reasoning: "I should open the start URL first\nand read the title.",
      },
      {
        name: "stagehand.screenshot",
        args: {},
        result: "Screenshot captured.",
        ok: true,
        images: [{ bytes: Buffer.alloc(42 * 1024), mediaType: "image/png" }],
      },
      {
        name: "stagehand_run",
        args: { code: "await page.click('#nope')" },
        result: undefined,
        ok: false,
        error: "Timeout 30000ms exceeded waiting for #nope",
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  });
}

const outcome: TrajectoryTraceInput["outcome"] = {
  status: "completed",
  stopReason: undefined,
  usage: { inputTokens: 12345, outputTokens: 678, cachedInputTokens: 9000, totalTokens: 13023 },
};

describe("trajectory trace log", () => {
  it("emits one identical-shape line per step plus a result line", () => {
    const lines = buildTrajectoryTraceLines({
      trajectory: threeStepTrajectory(),
      outcome,
      isFacadeTool: (name) => /run|screenshot/u.test(name),
    });

    expect(lines.map((line) => line.message)).toEqual([
      "step 1 · think · I should open the start URL first and read the title.",
      "step 1 · run · ok · await page.goto('https://example.com'); return page.title();  →  Example Domain",
      "step 2 · screenshot · ok  →  [image 42 KB]",
      "step 3 · run · ERR · await page.click('#nope')  →  Timeout 30000ms exceeded waiting for #nope",
      "answer · (none — agent reported none)",
      "result · completed · steps=3 · facade_calls=3 · in=12345 out=678 cached=9000",
    ]);
    expect(lines.every((line) => line.category === "trace")).toBe(true);
    expect(lines.map((line) => line.level)).toEqual([1, 1, 1, 0, 1, 1]);
  });

  it("traces the agent's summary and final answer before the result line", () => {
    const lines = buildTrajectoryTraceLines({
      trajectory: threeStepTrajectory(),
      outcome,
      report: {
        success: true,
        summary: "Opened the site and read the title.",
        finalAnswer: "Example Domain\nsecond line " + "x".repeat(300),
      },
    });
    const tail = lines.slice(-3).map((line) => line.message);
    expect(tail[0]).toBe("summary · Opened the site and read the title.");
    expect(tail[1].startsWith("answer · Example Domain second line xxx")).toBe(true);
    expect(tail[1].length).toBeLessThanOrEqual("answer · ".length + 200 + 1);
    expect(lines.at(-2)?.auxiliary?.answer?.value).toContain("x".repeat(300));
    expect(tail[2].startsWith("result · completed")).toBe(true);
  });

  it("states a missing answer with the stop status, as an error line", () => {
    const lines = buildTrajectoryTraceLines({
      trajectory: threeStepTrajectory(),
      outcome: { ...outcome, status: "max_turns", stopReason: "turn budget exhausted" },
      report: { success: false, summary: "", finalAnswer: "" },
    });
    const answer = lines.at(-2)!;
    expect(answer.message).toBe("answer · (none — max_turns)");
    expect(answer.level).toBe(0);
  });

  it("keeps the full code and result in auxiliary", () => {
    const [, run, , failed, , result] = buildTrajectoryTraceLines({
      trajectory: threeStepTrajectory(),
      outcome,
    });
    expect(run.auxiliary).toEqual({
      tool: { value: "mcp__stagehand__run", type: "string" },
      code: {
        value: "await page.goto('https://example.com'); return page.title();",
        type: "string",
      },
      result: { value: "Example Domain", type: "string" },
    });
    expect(failed.auxiliary?.error).toEqual({
      value: "Timeout 30000ms exceeded waiting for #nope",
      type: "string",
    });
    expect(failed.auxiliary?.result).toBeUndefined();
    expect(result.auxiliary?.usage).toEqual({
      value: JSON.stringify(outcome.usage),
      type: "object",
    });
    expect(result.message).not.toContain("facade_calls");
  });

  it("clips long code and results to a single line while capping auxiliary", () => {
    const longCode = "await page.locator('x').click();\n".repeat(40);
    const hugeResult = "y".repeat(TRACE_AUXILIARY_MAX_CHARS + 500);
    const [line] = buildTrajectoryTraceLines({
      trajectory: buildTrajectory({
        taskSpec,
        toolCalls: [{ name: "run", args: { code: longCode }, result: hugeResult, ok: true }],
      }),
      outcome,
    });
    expect(line.message).not.toContain("\n");
    expect(line.message.length).toBeLessThan(450);
    expect(line.message).toMatch(/…  →  y+…$/u);
    expect(line.auxiliary?.result?.value).toHaveLength(
      TRACE_AUXILIARY_MAX_CHARS + "…[truncated 500 chars]".length,
    );
  });

  it("summarizes snapshots by node count, object results as JSON, and stop reasons", () => {
    const lines = buildTrajectoryTraceLines({
      trajectory: buildTrajectory({
        taskSpec,
        toolCalls: [
          {
            name: "stagehand.snapshot",
            args: { includeIframes: true },
            result: "[1-1] RootWebArea: Example\n  [1-2] link: More\n  [1-3] button: Go",
            ok: true,
          },
          {
            name: "mcp__stagehand__run",
            args: { code: "return {a: 1}" },
            result: { a: 1 },
            ok: true,
          },
          { name: "bash", args: { command: "ls -la" }, result: "total 0", ok: true },
        ],
      }),
      outcome: { ...outcome, status: "sdk_error", stopReason: "max turns\nreached" },
    });
    expect(lines.map((line) => line.message)).toEqual([
      'step 1 · snapshot · ok · {"includeIframes":true}  →  [snapshot 3 nodes] [1-1] RootWebArea: Example',
      'step 2 · run · ok · return {a: 1}  →  {"a":1}',
      "step 3 · bash · ok · ls -la  →  total 0",
      "answer · (none — sdk_error)",
      "result · sdk_error · max turns reached · steps=3 · in=12345 out=678 cached=9000",
    ]);
  });

  it("emits through an EvalLogger-compatible sink", () => {
    const logged: string[] = [];
    emitTrajectoryTrace(
      { log: (line) => void logged.push(line.message) },
      { trajectory: threeStepTrajectory(), outcome },
    );
    expect(logged).toHaveLength(6);
    expect(logged.at(-1)).toMatch(/^result · completed/u);
  });

  it("collapses harness-specific tool names onto the surface tool", () => {
    expect(shortToolName("mcp__stagehand__run")).toBe("run");
    expect(shortToolName("mcp__stagehand_browser__run")).toBe("run");
    expect(shortToolName("stagehand.snapshot")).toBe("snapshot");
    expect(shortToolName("stagehand_screenshot")).toBe("screenshot");
    expect(shortToolName("stagehand_run")).toBe("run");
    expect(shortToolName("Bash")).toBe("Bash");
    expect(shortToolName("web_search")).toBe("web_search");
    expect(shortToolName("")).toBe("tool");
  });
});
