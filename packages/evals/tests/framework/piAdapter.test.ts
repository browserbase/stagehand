import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { piAdapter } from "../../framework/harnesses/piAdapter.js";

const taskSpec: TaskSpec = {
  id: "pi-test",
  instruction: "Do it",
  initUrl: "https://example.com",
};

describe("pi trajectory adapter", () => {
  it("maps reasoning, tool args/results/errors/images, and final answer", () => {
    const image = Buffer.from("png");
    const trajectory = piAdapter.fromHarnessResult(
      {
        events: [
          {
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Inspecting" },
                { type: "thinking", thinking: "carefully" },
                { type: "toolCall", id: "one", name: "mcp__stagehand__run", arguments: { x: 1 } },
              ],
            },
          },
          { type: "tool_execution_start", toolCallId: "one", toolName: "ignored", args: { x: 2 } },
          {
            type: "tool_execution_end",
            toolCallId: "one",
            toolName: "mcp__stagehand__run",
            result: {
              content: [
                { type: "text", text: "ok" },
                { type: "image", data: image.toString("base64"), mimeType: "image/png" },
              ],
            },
            isError: false,
          },
          {
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "toolCall", id: "two", name: "fallback" }],
            },
          },
          { type: "tool_execution_start", toolCallId: "two", args: { y: 2 } },
          {
            type: "tool_execution_end",
            toolCallId: "two",
            toolName: "fallback",
            result: { content: [{ type: "text", text: "failed" }] },
            isError: true,
          },
          {
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: "all done" }] },
          },
        ],
        status: "error",
        usage: { input_tokens: 10, output_tokens: 2 },
      },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "mcp__stagehand__run",
      actionArgs: { x: 1 },
      reasoning: "Inspecting\ncarefully",
      toolOutput: { ok: true, result: "ok" },
    });
    const imageModality = trajectory.steps[0].agentEvidence.modalities.find(
      (modality) => modality.type === "image",
    ) as { bytes: Buffer; mediaType: string };
    expect(imageModality.bytes.equals(image)).toBe(true);
    expect(imageModality.mediaType).toBe("image/png");
    expect(trajectory.steps[1]).toMatchObject({
      actionArgs: { y: 2 },
      toolOutput: { ok: false, error: "failed" },
    });
    expect(trajectory.finalAnswer).toBe("all done");
    expect(trajectory.status).toBe("error");
    expect(trajectory.usage).toMatchObject({ input_tokens: 10, output_tokens: 2 });
  });

  it("pairs observations only when observed call counts align", () => {
    const events = [
      { type: "tool_execution_start", toolCallId: "1", args: {} },
      { type: "tool_execution_end", toolCallId: "1", toolName: "mcp__s__a", result: "a" },
    ];
    const aligned = piAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [{ runIndex: 0, evidence: { url: "https://after" } }],
      },
      taskSpec,
    );
    expect(aligned.steps[0].probeEvidence.url).toBe("https://after");

    const misaligned = piAdapter.fromHarnessResult(
      {
        events,
        stepObservations: [{ runIndex: 1, evidence: { url: "https://wrong" } }],
      },
      taskSpec,
    );
    expect(misaligned.steps[0].probeEvidence).toEqual({});
  });

  it("prefers non-empty structured details over display text", () => {
    const trajectory = piAdapter.fromHarnessResult(
      {
        events: [
          { type: "tool_execution_start", toolCallId: "1", args: {} },
          {
            type: "tool_execution_end",
            toolCallId: "1",
            toolName: "mcp__s__verify",
            result: {
              content: [{ type: "text", text: "human-readable summary" }],
              details: { passed: false, score: 0 },
            },
          },
        ],
      },
      taskSpec,
    );

    expect(trajectory.steps[0].toolOutput).toEqual({
      ok: true,
      result: { passed: false, score: 0 },
    });
  });
});
