import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import {
  MASTRACODE_PROTOCOL_VERSION,
  type MastracodeDriverEvent,
} from "@browserbasehq/stagehand-integrations-mastracode-sdk";
import { mastracodeAdapter } from "../../framework/harnesses/mastracodeAdapter.js";

const TASK_SPEC: TaskSpec = { id: "task", instruction: "Do it" };
const v = MASTRACODE_PROTOCOL_VERSION;

function start(
  toolCallId: string,
  toolName: string,
  args: unknown,
  reasoning?: string,
): MastracodeDriverEvent {
  return { v, type: "tool_start", toolCallId, toolName, args, ...(reasoning && { reasoning }) };
}

function end(
  toolCallId: string,
  result: unknown,
  flags: { isError?: boolean; denied?: boolean } = {},
): MastracodeDriverEvent {
  return {
    v,
    type: "tool_end",
    toolCallId,
    result,
    isError: flags.isError ?? false,
    denied: flags.denied ?? false,
  };
}

function step(index: number, text: string): MastracodeDriverEvent {
  return {
    v,
    type: "step",
    index,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    hadToolCalls: false,
    text,
  };
}

describe("mastracode trajectory adapter", () => {
  it("pairs tool starts and ends by id and keeps the driver's reasoning", () => {
    const trajectory = mastracodeAdapter.fromHarnessResult(
      {
        events: [
          start("a", "stagehand_run", { code: "await page.goto(startUrl)" }, "I'll open the page."),
          start("b", "stagehand_snapshot", {}),
          end("b", { content: [{ type: "text", text: "heading" }] }),
          end("a", { content: [{ type: "text", text: "navigated" }] }),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((entry) => entry.actionName)).toEqual([
      "stagehand_run",
      "stagehand_snapshot",
    ]);
    expect(trajectory.steps[0]).toMatchObject({
      actionArgs: { code: "await page.goto(startUrl)" },
      reasoning: "I'll open the page.",
      toolOutput: { ok: true },
    });
    expect(trajectory.steps[1]?.toolOutput.ok).toBe(true);
  });

  it("marks errors, denials, MCP isError results, and unfinished calls as failed", () => {
    const trajectory = mastracodeAdapter.fromHarnessResult(
      {
        events: [
          start("1", "stagehand_run", {}),
          end("1", "Timeout waiting for selector", { isError: true }),
          start("2", "stagehand_run", {}),
          end("2", undefined, { denied: true }),
          start("3", "stagehand_run", {}),
          end("3", { isError: true, content: [{ type: "text", text: "Browser session lost" }] }),
          start("4", "stagehand_snapshot", {}),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((entry) => entry.toolOutput.ok)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(trajectory.steps[0]?.toolOutput.error).toBe("Timeout waiting for selector");
    expect(trajectory.steps[1]?.toolOutput.error).toBe("tool call denied");
    expect(trajectory.steps[2]?.toolOutput.error).toBe("Browser session lost");
  });

  it("extracts screenshot images and uses the last one as the final observation", () => {
    const png = Buffer.from("png-bytes");
    const trajectory = mastracodeAdapter.fromHarnessResult(
      {
        events: [
          start("s", "stagehand_screenshot", {}),
          end("s", {
            content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
          }),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps[0]?.toolOutput.result).toBe("[image]");
    expect(trajectory.finalObservation?.screenshot).toEqual(png);
  });

  it("pairs per-step probe evidence with facade calls by ordinal", () => {
    const trajectory = mastracodeAdapter.fromHarnessResult(
      {
        events: [
          start("1", "stagehand_run", {}),
          end("1", "ok"),
          start("2", "other_tool", {}),
          end("2", "ok"),
          start("3", "stagehand_snapshot", {}),
          end("3", "ok"),
        ],
        observedToolName: (name) => name.startsWith("stagehand_"),
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/one" } },
          { runIndex: 1, evidence: { url: "https://example.com/two" } },
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps[0]?.probeEvidence).toEqual({ url: "https://example.com/one" });
    expect(trajectory.steps[1]?.probeEvidence).toEqual({});
    expect(trajectory.steps[2]?.probeEvidence).toEqual({ url: "https://example.com/two" });
  });

  it("falls back to the last step's text for the final answer", () => {
    const trajectory = mastracodeAdapter.fromHarnessResult(
      {
        events: [
          step(1, "Opening the page."),
          step(2, "The heading is Example Domain."),
          step(3, "  "),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.finalAnswer).toBe("The heading is Example Domain.");
    const explicit = mastracodeAdapter.fromHarnessResult(
      { events: [step(1, "narration")], finalAnswer: "Example Domain", status: "error" },
      TASK_SPEC,
    );
    expect(explicit.finalAnswer).toBe("Example Domain");
    expect(explicit.status).toBe("error");
  });
});
