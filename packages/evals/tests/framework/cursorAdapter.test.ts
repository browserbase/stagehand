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

  it("folds stream-json thinking deltas into the next call's reasoning, never the answer", () => {
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [
          { type: "thinking", subtype: "delta", text: "The page needs " },
          { type: "thinking", subtype: "delta", text: "a snapshot first." },
          { type: "thinking", subtype: "completed" },
          assistant("Taking a snapshot."),
          toolCall("started", "c1", "readToolCall", { path: "file.txt" }),
          toolCall("completed", "c1", "readToolCall", { path: "file.txt" }, { success: "ok" }),
          { type: "thinking", subtype: "delta", text: "That settles it." },
          assistant("finished"),
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0]?.reasoning).toBe(
      "The page needs a snapshot first.\nTaking a snapshot.",
    );
    expect(trajectory.finalAnswer).toBe("finished");
  });

  it("decodes MCP content images and uses the last image as final observation", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
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
          source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") },
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
    ).toHaveLength(1);
    expect(trajectory.finalObservation?.screenshot?.equals(bytes)).toBe(true);
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

  it.each([{ success: "ok" }, { error: "denied" }])(
    "coalesces running argument updates into one completed step with one observation: %j",
    (result) => {
      const args = { server: "stagehand", tool: "run", args: { code: "return page.url()" } };
      const trajectory = cursorAdapter.fromHarnessResult(
        {
          events: [
            assistant("Inspect the page."),
            toolCall("started", "m1", "mcpToolCall", {}),
            toolCall("started", "m1", "mcpToolCall", {
              ...args,
              args: { code: "return page." },
            }),
            toolCall("started", "m1", "mcpToolCall", args),
            toolCall("completed", "m1", "mcpToolCall", args, result),
          ],
          stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }],
          observedToolName: (name) => name === "stagehand.run",
        },
        taskSpec,
      );
      expect(trajectory.steps).toHaveLength(1);
      expect(trajectory.steps[0]).toMatchObject({
        actionName: "stagehand.run",
        actionArgs: { code: "return page.url()" },
        reasoning: "Inspect the page.",
        toolOutput: { ok: "success" in result },
        probeEvidence: { url: "https://example.com" },
      });
    },
  );

  it("keeps complete arguments from running updates when the stream aborts", () => {
    const args = { path: "file.txt", options: { encoding: "utf8", limit: 20 } };
    const events = [
      toolCall("started", "c1", "readToolCall", args),
      toolCall("started", "c1", "readToolCall", { path: "file.", options: { limit: 30 } }),
      toolCall("started", "c1", "readToolCall", {}),
    ];
    const trajectory = cursorAdapter.fromHarnessResult({ events }, taskSpec);
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      actionArgs: { path: "file.txt", options: { encoding: "utf8", limit: 30 } },
      toolOutput: { ok: false, error: "no tool result" },
    });
    expect(args.options.limit).toBe(20);
  });

  it("retains separate completed events even when their call ids repeat", () => {
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [
          toolCall("completed", "c1", "readToolCall", { path: "first" }, { success: "one" }),
          toolCall("completed", "c1", "readToolCall", { path: "second" }, { success: "two" }),
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps.map((step) => step.toolOutput?.result)).toEqual(["one", "two"]);
  });

  it("retains observed protobuf MCP text, images, and explicit error flags in trajectory evidence", () => {
    const credentialMessage =
      'BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER="browserbase".';
    const snapshot = '[1] heading "Women’s Shoes"\n[2] button "Size"';
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const args = {
      name: "stagehand-run",
      toolName: "run",
      providerIdentifier: "stagehand",
      serverIdentifier: "stagehand",
    };
    const trajectory = cursorAdapter.fromHarnessResult(
      {
        events: [
          toolCall("completed", "m1", "mcpToolCall", args, {
            success: { content: [{ text: { text: credentialMessage } }], isError: false },
          }),
          toolCall("completed", "m2", "mcpToolCall", args, {
            success: {
              content: [
                { text: { text: snapshot } },
                { image: { data: image.toString("base64"), mimeType: "image/png" } },
              ],
              isError: false,
            },
          }),
          toolCall("completed", "m3", "mcpToolCall", args, {
            success: { content: [{ text: { text: "Tool execution failed" } }], isError: true },
          }),
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps.map((step) => step.toolOutput)).toMatchObject([
      { ok: true, result: credentialMessage },
      { ok: true, result: `${snapshot}\n[image]` },
      { ok: false, result: "Tool execution failed" },
    ]);
    expect(trajectory.finalObservation?.screenshot?.equals(image)).toBe(true);
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
