import { describe, expect, it } from "vitest";
import type { EveEvent } from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { TaskSpec } from "stagehand-v3";
import { eveAdapter } from "../../framework/harnesses/eveAdapter.js";

const taskSpec: TaskSpec = {
  id: "eve-test",
  instruction: "Use the browser",
  initUrl: "https://example.com",
};

function toolEvents(
  options: {
    status?: string;
    isError?: boolean;
    error?: string;
    output?: unknown;
    name?: string;
  } = {},
): EveEvent[] {
  const name = options.name ?? "stagehand__run";
  return [
    {
      type: "actions.requested",
      data: {
        actions: [{ kind: "tool-call", callId: "call-1", toolName: name, input: { code: "go" } }],
      },
    },
    {
      type: "action.result",
      data: {
        status: options.status ?? "completed",
        ...(options.error && { error: { message: options.error } }),
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: name,
          output: options.output ?? { ok: true },
          ...(options.isError && { isError: true }),
        },
      },
    },
  ];
}

describe("Eve trajectory adapter", () => {
  it("maps a tool request and result into one trajectory step", () => {
    const trajectory = eveAdapter.fromHarnessResult({ events: toolEvents() }, taskSpec);
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "stagehand__run",
      actionArgs: { code: "go" },
      toolOutput: { ok: true, result: { ok: true } },
    });
  });

  it("maps failed results with the event error message", () => {
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events: toolEvents({ status: "failed", isError: true, error: "browser failed" }),
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput).toMatchObject({
      ok: false,
      error: "browser failed",
    });
  });

  it("extracts bridge text and image evidence", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events: toolEvents({
          output: {
            content: [
              { type: "text", text: "screenshot" },
              { type: "image", data: png.toString("base64"), mimeType: "image/png" },
            ],
          },
        }),
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput.result).toBe("screenshot\n[image]");
    const images = trajectory.steps[0].agentEvidence.modalities.filter(
      (modality) => modality.type === "image",
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ mediaType: "image/png" });
    expect((images[0] as { bytes: Buffer }).bytes.equals(png)).toBe(true);
  });

  it("folds completed reasoning into the next tool call", () => {
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events: [
          { type: "reasoning.completed", data: { reasoning: "inspect first" } },
          ...toolEvents(),
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].reasoning).toBe("inspect first");
  });

  it("uses the last completed message as the final answer", () => {
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events: [
          { type: "message.completed", data: { message: "first" } },
          { type: "message.completed", data: { message: "last" } },
        ],
      },
      taskSpec,
    );
    expect(trajectory.finalAnswer).toBe("last");
  });

  it("sums step usage when explicit usage is absent", () => {
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events: [
          {
            type: "step.completed",
            data: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 } },
          },
          {
            type: "step.completed",
            data: { usage: { inputTokens: 5, outputTokens: 4, cacheReadTokens: 1 } },
          },
        ],
      },
      taskSpec,
    );
    expect(trajectory.usage).toMatchObject({
      input_tokens: 15,
      output_tokens: 6,
      cached_input_tokens: 4,
    });
  });

  it("pairs observations only with matching observed tool calls", () => {
    const events = [
      ...toolEvents({ name: "unrelated" }),
      ...toolEvents({ name: "stagehand__run" }).map((event) => {
        const serialized = JSON.stringify(event).replaceAll("call-1", "call-2");
        return JSON.parse(serialized) as EveEvent;
      }),
    ];
    const screenshot = Buffer.from("png");
    const trajectory = eveAdapter.fromHarnessResult(
      {
        events,
        observedToolName: (name) => name.startsWith("stagehand__"),
        stepObservations: [{ runIndex: 0, evidence: { url: "https://done", screenshot } }],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].probeEvidence).toEqual({});
    expect(trajectory.steps[1].probeEvidence).toMatchObject({ url: "https://done" });
  });
});
