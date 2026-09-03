import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { cursorAdapter } from "../../framework/harnesses/cursorAdapter.js";

const taskSpec: TaskSpec = { id: "cursor-test", instruction: "do the task" };

describe("cursor trajectory adapter", () => {
  it("maps assistant reasoning, read calls, and result text", () => {
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [
          assistant("I will read it."),
          toolCall("started", "c1", "readToolCall", { path: "file.txt" }),
          toolCall("completed", "c1", "readToolCall", { path: "file.txt" }, { success: "ok" }),
          { type: "result", result: "finished" },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "read",
      reasoning: "I will read it.",
      toolOutput: { ok: true, result: "ok" },
    });
    expect(trajectory.finalAnswer).toBe("finished");
  });

  it("decodes MCP content images and uses the last image as final observation", () => {
    const firstBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const lastBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const args = {
      providerIdentifier: "stagehand",
      name: "screenshot",
      args: { fullPage: false },
    };
    const success = {
      content: [
        { type: "text", text: "captured" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: firstBytes.toString("base64"),
          },
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: lastBytes.toString("base64"),
          },
        },
      ],
    };
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [
          toolCall("started", "m1", "mcpToolCall", args),
          toolCall("completed", "m1", "mcpToolCall", args, { success }),
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].actionName).toBe("stagehand.screenshot");
    expect(
      trajectory.steps[0].agentEvidence.modalities.filter((m) => m.type === "image"),
    ).toHaveLength(2);
    expect(trajectory.finalObservation?.screenshot?.equals(lastBytes)).toBe(true);
  });

  it("maps completed error envelopes", () => {
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [toolCall("completed", "c1", "writeToolCall", { path: "x" }, { error: "denied" })],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput).toMatchObject({ ok: false, error: "denied" });
  });

  it("attaches observations only when observed-call ordinals match", () => {
    const events = [
      toolCall("completed", "r1", "readToolCall", { path: "x" }, { success: "ok" }),
      toolCall(
        "completed",
        "m1",
        "mcpToolCall",
        { server: "stagehand", tool: "run", args: {} },
        { success: "one" },
      ),
      toolCall(
        "completed",
        "m2",
        "mcpToolCall",
        { server: "stagehand", tool: "snapshot", args: {} },
        { success: "two" },
      ),
    ];
    const matched = cursorAdapter.fromHarnessResult(
      {
        events,
        observedToolName: (name) => name.startsWith("stagehand."),
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 1, evidence: { url: "https://example.com/b" } },
        ],
      },
      taskSpec,
    );
    expect(matched.steps.map((step) => step.probeEvidence.url)).toEqual([
      undefined,
      "https://example.com/a",
      "https://example.com/b",
    ]);

    const mismatched = cursorAdapter.fromHarnessResult(
      {
        events,
        observedToolName: (name) => name.startsWith("stagehand."),
        stepObservations: [
          { runIndex: 0, evidence: { url: "https://example.com/a" } },
          { runIndex: 2, evidence: { url: "https://example.com/c" } },
        ],
      },
      taskSpec,
    );
    expect(mismatched.steps.every((step) => step.probeEvidence.url === undefined)).toBe(true);
  });

  it("passes status through", () => {
    const trajectory = cursorAdapter.fromHarnessResult({ events: [], status: "error" }, taskSpec);
    expect(trajectory.status).toBe("error");
  });
});

function assistant(text: string): Record<string, unknown> {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}

function toolCall(
  subtype: "started" | "completed",
  callId: string,
  kind: string,
  args: Record<string, unknown>,
  result?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "tool_call",
    subtype,
    call_id: callId,
    tool_call: { [kind]: { args, ...(result && { result }) } },
  };
}
