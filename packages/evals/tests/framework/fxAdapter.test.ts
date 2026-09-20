import { describe, expect, it } from "vitest";
import type { FxEvent } from "@browserbasehq/stagehand-integrations-fx-sdk";
import type { TaskSpec } from "stagehand-v3";
import { fxAdapter } from "../../framework/harnesses/fxAdapter.js";

const taskSpec = {
  id: "fx-test",
  instruction: "Inspect the page",
} as TaskSpec;

describe("fx trajectory adapter", () => {
  it("normalizes calls, failures, reasoning, images, and the latest assistant", () => {
    const imageData = Buffer.from("pixels").toString("base64");
    const events: FxEvent[] = [
      {
        type: "tool_step",
        assistant: "I will inspect and then click.",
        tool_calls: [
          {
            id: "call-1",
            name: "mcp_stagehand_snapshot",
            arguments_json: '{"depth":2}',
          },
          {
            id: "call-2",
            name: "mcp_stagehand_run",
            arguments_json: "not-json",
          },
        ],
        tool_results: [
          {
            tool_call_id: "call-1",
            status: "success",
            output: JSON.stringify({
              content: [
                { type: "text", text: "snapshot" },
                { type: "image", data: imageData, mimeType: "image/jpeg" },
              ],
            }),
          },
          {
            tool_call_id: "call-2",
            status: "failure",
            output: "click failed",
          },
        ],
      },
      { type: "assistant", text: "first" },
      { type: "assistant", text: "last" },
    ];

    const trajectory = fxAdapter.fromHarnessResult(
      {
        events,
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cached_input_tokens: 3,
          reasoning_tokens: 2,
        },
      },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "mcp_stagehand_snapshot",
      actionArgs: { depth: 2 },
      reasoning: "I will inspect and then click.",
      toolOutput: { ok: true },
    });
    expect(trajectory.steps[0]?.toolOutput.result).toEqual({
      content: [{ type: "text", text: "snapshot" }, "[image]"],
    });
    expect(trajectory.steps[0]?.agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "json" }),
        expect.objectContaining({ type: "image", mediaType: "image/jpeg" }),
      ]),
    );
    expect(trajectory.steps[1]).toMatchObject({
      actionName: "mcp_stagehand_run",
      actionArgs: { raw: "not-json" },
      reasoning: "",
      toolOutput: { ok: false, result: "click failed", error: "click failed" },
    });
    expect(trajectory.finalAnswer).toBe("last");
    expect(trajectory.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 4,
      cached_input_tokens: 3,
      reasoning_tokens: 2,
    });
  });

  it("pairs step observations only when observed call counts align", () => {
    const events: FxEvent[] = [
      {
        type: "tool_step",
        assistant: "",
        tool_calls: [
          { id: "one", name: "mcp_stagehand_run", arguments_json: "{}" },
          { id: "two", name: "read_file", arguments_json: "{}" },
          { id: "three", name: "mcp_stagehand_snapshot", arguments_json: "{}" },
        ],
        tool_results: [
          { tool_call_id: "one", status: "success", output: "one" },
          { tool_call_id: "two", status: "success", output: "two" },
          { tool_call_id: "three", status: "success", output: "three" },
        ],
      },
    ];
    const trajectory = fxAdapter.fromHarnessResult(
      {
        events,
        observedToolName: (name) => name.startsWith("mcp_stagehand_"),
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/one" } },
          { runIndex: 1, evidence: { url: "https://example.com/two" } },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0]?.probeEvidence).toEqual({ url: "https://example.com/one" });
    expect(trajectory.steps[1]?.probeEvidence).toEqual({});
    expect(trajectory.steps[2]?.probeEvidence).toEqual({ url: "https://example.com/two" });
  });

  it("pairs observations by live call key when counts do not align", () => {
    const events: FxEvent[] = [
      {
        type: "tool_step",
        assistant: "",
        tool_calls: [
          { id: "one", name: "mcp_stagehand_run", arguments_json: "{}" },
          { id: "two", name: "mcp_stagehand_snapshot", arguments_json: "{}" },
          { id: "three", name: "mcp_stagehand_screenshot", arguments_json: "{}" },
        ],
        tool_results: [],
      },
    ];
    const trajectory = fxAdapter.fromHarnessResult(
      {
        events,
        observedToolCallKeys: ["two"],
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/live" } },
          { runIndex: 1, evidence: { url: "https://example.com/unmatched" } },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0]?.probeEvidence).toEqual({});
    expect(trajectory.steps[1]?.probeEvidence).toEqual({ url: "https://example.com/live" });
    expect(trajectory.steps[2]?.probeEvidence).toEqual({});
  });

  it("includes a final observation only when it has a screenshot", () => {
    const withoutScreenshot = fxAdapter.fromHarnessResult(
      { events: [], finalObservation: { url: "https://example.com" } },
      taskSpec,
    );
    const screenshot = Buffer.from("png");
    const withScreenshot = fxAdapter.fromHarnessResult(
      { events: [], finalObservation: { url: "https://example.com", screenshot } },
      taskSpec,
    );
    expect(withoutScreenshot.finalObservation).toBeUndefined();
    expect(withScreenshot.finalObservation).toEqual({
      url: "https://example.com",
      screenshot,
    });
  });
});
