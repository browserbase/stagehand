import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../../framework/harnesses/claudeCodeAdapter.js";
import type { TaskSpec } from "@browserbasehq/stagehand";

const taskSpec: TaskSpec = {
  id: "test/terminal-artifact",
  instruction: "Do the task",
  initUrl: "https://example.com",
};

const HARNESS_SHOT = Buffer.from("harness-observed-screenshot");
const AGENT_SHOT = Buffer.from("agent-returned-screenshot");

function messagesWithAgentImage() {
  return [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "run",
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
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: AGENT_SHOT.toString("base64"),
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

describe("artifact-grounded final observation", () => {
  it("prefers the harness-observed terminal artifact over agent-returned images", () => {
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      {
        messages: messagesWithAgentImage(),
        finalAnswer: "done",
        terminalArtifact: {
          screenshot: HARNESS_SHOT,
          url: "https://example.com/final",
        },
      },
      taskSpec,
    );
    expect(trajectory.finalObservation?.screenshot).toBe(HARNESS_SHOT);
    expect(trajectory.finalObservation?.url).toBe("https://example.com/final");
  });

  it("falls back to the last agent-returned image when no artifact was captured", () => {
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages: messagesWithAgentImage(), finalAnswer: "done" },
      taskSpec,
    );
    expect(trajectory.finalObservation?.screenshot?.equals(AGENT_SHOT)).toBe(
      true,
    );
  });

  it("omits the anchor entirely when neither source exists", () => {
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      { messages: [], finalAnswer: "done" },
      taskSpec,
    );
    expect(trajectory.finalObservation).toBeUndefined();
  });

  it("ignores an empty artifact (no screenshot) and still falls back", () => {
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      {
        messages: messagesWithAgentImage(),
        finalAnswer: "done",
        terminalArtifact: {},
      },
      taskSpec,
    );
    expect(trajectory.finalObservation?.screenshot?.equals(AGENT_SHOT)).toBe(
      true,
    );
  });
});
