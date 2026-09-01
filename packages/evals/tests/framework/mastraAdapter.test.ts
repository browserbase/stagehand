import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { mastraAdapter } from "../../framework/harnesses/mastraAdapter.js";

const TASK_SPEC: TaskSpec = { id: "task", instruction: "Do it" };

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: "tool-call", payload: { toolCallId: id, toolName: name, args } };
}

function toolResult(id: string, name: string, result: unknown, isError?: boolean) {
  return {
    type: "tool-result",
    payload: { toolCallId: id, toolName: name, result, ...(isError && { isError }) },
  };
}

function textDelta(text: string) {
  return { type: "text-delta", payload: { text } };
}

function reasoningDelta(text: string) {
  return { type: "reasoning-delta", payload: { text } };
}

function toolError(id: string, name: string, error: unknown) {
  return { type: "tool-error", payload: { toolCallId: id, toolName: name, error } };
}

describe("Mastra trajectory adapter", () => {
  it("concatenates streamed token deltas without inserting newlines", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          reasoningDelta("I will"),
          reasoningDelta(" click"),
          reasoningDelta(" checkout"),
          textDelta("Proceeding"),
          textDelta(" now"),
          toolCall("1", "stagehand_run", {}),
          toolResult("1", "stagehand_run", "ok"),
        ],
      },
      TASK_SPEC,
    );
    // Fragments of one block join directly; only the reasoning → text block
    // boundary gets a newline.
    expect(trajectory.steps[0]?.reasoning).toBe("I will click checkout\nProceeding now");
  });

  it("maps arguments, results, and success", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "stagehand_run", { query: "x", __mastraMetadata: { hidden: true } }),
          toolResult("1", "stagehand_run", { value: 42 }),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "stagehand_run",
      actionArgs: { query: "x" },
      toolOutput: { ok: true, result: { value: 42 } },
    });
    expect(trajectory.steps[0]?.actionArgs).not.toHaveProperty("__mastraMetadata");
    expect(trajectory.status).toBe("complete");
  });

  it("extracts MCP content images and uses the last image as final observation", () => {
    const earlierBytes = Buffer.from("earlier screen");
    const bytes = Buffer.from("screen");
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "stagehand_screenshot", {}),
          toolResult("1", "stagehand_screenshot", {
            content: [
              { type: "text", text: "captured" },
              {
                type: "image",
                data: earlierBytes.toString("base64"),
                mimeType: "image/png",
              },
              { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
            ],
          }),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps[0]?.toolOutput.result).toBe("captured\n[image]\n[image]");
    expect(
      trajectory.steps[0]?.agentEvidence.modalities.filter((item) => item.type === "image"),
    ).toHaveLength(2);
    expect(trajectory.finalObservation?.screenshot).toEqual(bytes);
  });

  it("maps explicit error signals and failed structured results", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "one", {}),
          toolResult("1", "one", { content: [{ type: "text", text: "denied" }] }, true),
          toolCall("2", "two", {}),
          toolResult("2", "two", { ok: false, error: "bad result" }),
          toolCall("3", "three", {}),
          toolError("3", "three", { message: "crashed" }),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((step) => step.toolOutput.ok)).toEqual([false, false, false]);
    expect(trajectory.steps.map((step) => step.toolOutput.error)).toEqual([
      "denied",
      "bad result",
      "crashed",
    ]);
  });

  it("sanitizes string results and tool errors", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "one", {}),
          toolResult("1", "one", "bb_live_ABCDEFGHIJKLMNOP"),
          toolCall("2", "two", {}),
          toolError("2", "two", "failed?apiKey=secret123"),
        ],
      },
      TASK_SPEC,
    );
    expect(JSON.stringify(trajectory.steps)).not.toContain("bb_live_ABCDEFGHIJKLMNOP");
    expect(JSON.stringify(trajectory.steps)).not.toContain("secret123");
  });

  it("deeply sanitizes tool arguments and structured results", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "one", {
            nested: { url: "https://x?apiKey=secret123" },
          }),
          toolResult("1", "one", {
            nested: [{ url: "https://x?apiKey=secret123" }],
            count: 1,
            enabled: true,
          }),
        ],
      },
      TASK_SPEC,
    );

    expect(trajectory.steps[0]?.actionArgs).toEqual({
      nested: { url: "https://x?apiKey=[redacted]" },
    });
    expect(trajectory.steps[0]?.toolOutput.result).toEqual({
      nested: [{ url: "https://x?apiKey=[redacted]" }],
      count: 1,
      enabled: true,
    });
  });

  it("folds pre-call reasoning and text while keeping trailing text as the answer", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          reasoningDelta("reason"),
          textDelta("plan"),
          toolCall("1", "run", {}),
          toolResult("1", "run", "ok"),
          textDelta("finished"),
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps[0]?.reasoning).toBe("reason\nplan");
    expect(trajectory.finalAnswer).toBe("finished");

    const explicit = mastraAdapter.fromHarnessResult(
      { events: [textDelta("fallback")], finalAnswer: "explicit" },
      TASK_SPEC,
    );
    expect(explicit.finalAnswer).toBe("explicit");
  });

  it("sanitizes reasoning and explicit or trailing final answers", () => {
    const secretUrl = "https://x.test?apiKey=secret123";
    const trailing = mastraAdapter.fromHarnessResult(
      {
        events: [
          reasoningDelta(`reason ${secretUrl}`),
          toolCall("1", "run", {}),
          toolResult("1", "run", "ok"),
          textDelta(`finished ${secretUrl}`),
        ],
      },
      TASK_SPEC,
    );
    const explicit = mastraAdapter.fromHarnessResult(
      { events: [], finalAnswer: `explicit ${secretUrl}` },
      TASK_SPEC,
    );

    expect(trailing.steps[0]?.reasoning).toBe("reason https://x.test?apiKey=[redacted]");
    expect(trailing.finalAnswer).toBe("finished https://x.test?apiKey=[redacted]");
    expect(explicit.finalAnswer).toBe("explicit https://x.test?apiKey=[redacted]");
  });

  it("attaches observations only to matching tool ordinals", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [
          toolCall("1", "unrelated", {}),
          toolCall("2", "stagehand_one", {}),
          toolCall("3", "stagehand_two", {}),
        ],
        observedToolName: (name) => name.startsWith("stagehand_"),
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/one" } },
          { runIndex: 1, evidence: { url: "https://example.com/two" } },
        ],
      },
      TASK_SPEC,
    );
    expect(trajectory.steps.map((step) => step.probeEvidence.url)).toEqual([
      undefined,
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  it("passes usage and explicit status through", () => {
    const trajectory = mastraAdapter.fromHarnessResult(
      {
        events: [],
        status: "error",
        usage: { input_tokens: 10, output_tokens: 4, reasoning_tokens: 2 },
      },
      TASK_SPEC,
    );
    expect(trajectory.status).toBe("error");
    expect(trajectory.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 4,
      reasoning_tokens: 2,
    });
  });
});
