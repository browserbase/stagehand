import { describe, expect, it } from "vitest";
import { compactPiEvent } from "@browserbasehq/stagehand-integrations-pi-sdk";
import { piAdapter } from "../../framework/harnesses/piAdapter.js";

describe("Pi screenshot evidence pipeline", () => {
  it("keeps explicit omission evidence without re-decoding an over-budget screenshot", () => {
    const event = compactPiEvent(
      {
        type: "tool_execution_end",
        toolCallId: "oversize",
        toolName: "screenshot",
        result: { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
      },
      { remainingBytes: 0 },
    );
    const trajectory = piAdapter.fromHarnessResult(
      { events: [event], finalAnswer: "done" },
      { id: "omitted-image", instruction: "Capture a screenshot." },
    );
    const modalities = trajectory.steps[0].agentEvidence.modalities;
    expect(modalities.filter((modality) => modality.type === "image")).toEqual([]);
    expect(JSON.stringify(modalities)).toContain("Screenshot omitted");
    expect(JSON.stringify(event)).not.toContain("AAAA");
  });
  it.each([false, true])("retains the screenshot after SDK compaction=%s", (compact) => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZu0AAAAASUVORK5CYII=",
      "base64",
    );
    const event = {
      type: "tool_execution_end",
      toolCallId: "screenshot-1",
      toolName: "mcp__stagehand__screenshot",
      result: {
        content: [
          { type: "text", text: "Screenshot captured." },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
      },
      isError: false,
    };

    const trajectory = piAdapter.fromHarnessResult(
      { events: [compact ? compactPiEvent(event) : event], finalAnswer: "done" },
      {
        id: "pi-screenshot-pipeline",
        instruction: "Capture a screenshot.",
        initUrl: "https://example.invalid",
      },
    );

    expect(trajectory.steps).toHaveLength(1);
    const images = trajectory.steps[0].agentEvidence.modalities.filter(
      (modality) => modality.type === "image",
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ bytes: png, mediaType: "image/png" });
    expect(event.result.content[1].data).toBe(png.toString("base64"));
  });
});
