import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../../framework/harnesses/claudeCodeAdapter.js";
import type { TaskSpec } from "@browserbasehq/stagehand";

const taskSpec: TaskSpec = {
  id: "test/image-evidence",
  instruction: "Take a screenshot and verify",
  initUrl: "https://example.com",
};

function imageBlock(data: string) {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data },
  };
}

describe("claudeCodeAdapter image evidence", () => {
  it("decodes base64 image blocks from tool_result into AgentEvidence image modalities", () => {
    const fakePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const base64 = fakePng.toString("base64");

    const messages = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Taking screenshot" },
            {
              type: "tool_use",
              id: "tu_1",
              name: "playwright_code",
              input: { code: "await page.screenshot()" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [
                { type: "text", text: "OK" },
                imageBlock(base64),
              ],
            },
          ],
        },
      },
      { type: "result", result: "done" },
    ];

    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages, status: "complete" },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(1);
    const modalities = trajectory.steps[0].agentEvidence.modalities;
    const imageModalities = modalities.filter((m) => m.type === "image");
    expect(imageModalities).toHaveLength(1);
    const img = imageModalities[0] as {
      type: "image";
      bytes: Buffer;
      mediaType: string;
    };
    expect(img.mediaType).toBe("image/png");
    expect(Buffer.isBuffer(img.bytes)).toBe(true);
    expect(img.bytes.equals(fakePng)).toBe(true);
  });

  it("anchors the last tool_result screenshot as trajectory.finalObservation", () => {
    const png1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const png2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);
    const messages = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "playwright_code",
              input: {},
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [imageBlock(png1.toString("base64"))],
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_2",
              name: "playwright_code",
              input: {},
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_2",
              content: [imageBlock(png2.toString("base64"))],
            },
          ],
        },
      },
    ];

    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages, status: "complete" },
      taskSpec,
    );

    expect(trajectory.finalObservation?.screenshot).toBeDefined();
    expect(trajectory.finalObservation!.screenshot!.equals(png2)).toBe(true);
  });

  it("falls back to an earlier screenshot if the last tool_result has no image", () => {
    const png1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03]);
    const messages = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_1", name: "playwright_code", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [imageBlock(png1.toString("base64"))],
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_2", name: "playwright_code", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_2",
              content: [{ type: "text", text: "no screenshot here" }],
            },
          ],
        },
      },
    ];

    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages, status: "complete" },
      taskSpec,
    );

    expect(trajectory.finalObservation?.screenshot?.equals(png1)).toBe(true);
  });

  it("leaves finalObservation undefined when no tool_result carried an image", () => {
    const messages = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_1", name: "playwright_code", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [{ type: "text", text: "ok" }],
            },
          ],
        },
      },
    ];

    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages, status: "complete" },
      taskSpec,
    );

    expect(trajectory.finalObservation).toBeUndefined();
  });

  it("ignores image blocks with malformed source (no bytes leak)", () => {
    const messages = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "playwright_code",
              input: {},
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [
                { type: "text", text: "no screenshot" },
                { type: "image", source: { type: "url", url: "..." } },
              ],
            },
          ],
        },
      },
    ];

    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages, status: "complete" },
      taskSpec,
    );

    const modalities = trajectory.steps[0].agentEvidence.modalities;
    expect(modalities.filter((m) => m.type === "image")).toHaveLength(0);
  });
});
