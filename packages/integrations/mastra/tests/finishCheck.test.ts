/* eslint-disable require-yield */
import { describe, expect, it } from "vitest";
import { runMastraSession, type MastraEvent, type MastraSdk } from "../src/index.js";

const CHECK = "Re-read the task before you finish.";
const STARTED = new Date("2026-01-01T00:00:10Z");
/** What the first call produced, in Mastra's stored message format. */
const FIRST_HISTORY = [
  {
    id: "assistant-1",
    role: "assistant",
    createdAt: STARTED,
    content: {
      format: 2,
      parts: [
        { type: "tool-invocation", toolInvocation: { toolCallId: "1", toolName: "stagehand_run" } },
        { type: "step-start" },
        { type: "text", text: "first answer" },
      ],
    },
  },
];

type Pass = { events?: MastraEvent[]; throws?: Error; history?: unknown[] };

const finish = (reason: string, inputTokens = 0): MastraEvent => ({
  type: "finish",
  payload: {
    stepResult: { reason },
    output: { usage: { inputTokens, outputTokens: 1, cachedInputTokens: inputTokens / 2 } },
  },
});
const step: MastraEvent = { type: "step-finish", payload: { output: {} } };
const text = (value: string): MastraEvent => ({ type: "text-delta", payload: { text: value } });
const toolCall: MastraEvent = {
  type: "tool-call",
  payload: { toolCallId: "2", toolName: "stagehand_run", args: {} },
};

const firstPass: Pass = {
  events: [toolCall, step, text("first answer"), step, finish("stop", 100)],
  history: FIRST_HISTORY,
};

/** Each `agent.stream` call plays the next pass and records what it was called with. */
function passSdk(passes: Pass[]) {
  const calls: Array<{ prompt: string | unknown[]; options?: Record<string, unknown> }> = [];
  const sdk: MastraSdk = {
    createAgent: () => ({
      stream: async (prompt, options) => {
        const pass = passes[calls.length] ?? {};
        calls.push({ prompt, options });
        if (pass.throws) throw pass.throws;
        return {
          fullStream: (async function* () {
            yield* pass.events ?? [];
          })(),
          text: Promise.resolve(""),
          response: Promise.resolve({ dbMessages: pass.history }),
        };
      },
    }),
    createMcpClient: () => ({
      listToolsWithErrors: async () => ({ tools: {}, errors: {} }),
      disconnect: async () => {},
    }),
    createTool: (options) => options,
  };
  return { sdk, calls };
}

function run(passes: Pass[], session: Record<string, unknown> = {}) {
  const { sdk, calls } = passSdk(passes);
  const warnings: string[] = [];
  const logger = {
    log: () => {},
    error: () => {},
    warn: (line: { message?: string }) => warnings.push(String(line.message)),
  };
  return runMastraSession({
    prompt: "the task",
    model: "openai/gpt-5.4",
    logger,
    sdk,
    session: { maxSteps: 10, finishCheckPrompt: CHECK, ...session },
  }).then((result) => ({ result, calls, warnings }));
}

describe("Mastra finish check", () => {
  it("continues the same conversation once and reports the new answer", async () => {
    const { result, calls } = await run([
      firstPass,
      { events: [toolCall, step, text("checked answer"), step, finish("stop", 300)] },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt).toBe("the task");
    expect(calls[0].options).toMatchObject({ maxSteps: 10 });
    // The task, everything the first call produced, then the check, all in Mastra's stored
    // format and dated in that order; the step budget is shared.
    const userTurn = (text: string) => ({
      id: expect.any(String),
      role: "user",
      createdAt: expect.any(Date),
      content: { format: 2, parts: [{ type: "text", text }] },
    });
    const continued = calls[1].prompt as Array<{ createdAt: Date }>;
    expect(continued).toEqual([userTurn("the task"), ...FIRST_HISTORY, userTurn(CHECK)]);
    expect(continued[0].createdAt.getTime()).toBeLessThan(STARTED.getTime());
    expect(continued[2].createdAt.getTime()).toBeGreaterThan(STARTED.getTime());
    expect(calls[1].options).toMatchObject({ maxSteps: 8 });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("checked answer");
    expect(result.stepCount).toBe(4);
    expect(result.tokenUsage).toMatchObject({
      inputTokens: 400,
      outputTokens: 2,
      cachedInputTokens: 200,
    });
    expect(result.events).toContainEqual({ type: "finish-check", payload: { text: CHECK } });
  });

  it("keeps the first answer when the check pass adds no text, errors, or runs out of steps", async () => {
    const cases: Array<{ checkPass: Pass; warns: boolean }> = [
      // Stopped again without restating: not a failure, nothing to log.
      { checkPass: { events: [step, finish("stop")] }, warns: false },
      {
        checkPass: {
          events: [toolCall, step, { type: "error", payload: { error: "overloaded" } }],
        },
        warns: true,
      },
      { checkPass: { throws: new Error("stream failed") }, warns: true },
      { checkPass: { events: [toolCall, step, finish("tool-calls")] }, warns: true },
    ];
    for (const { checkPass, warns } of cases) {
      const { result, warnings } = await run([firstPass, checkPass]);
      expect(result.status).toBe("completed");
      expect(result.finalText).toBe("first answer");
      expect(result.stopReason).toBeUndefined();
      expect(warnings).toHaveLength(warns ? 1 : 0);
      if (warns) expect(warnings[0]).toContain("keeping the first answer");
    }
  });

  it("is skipped unless the model stopped on its own with steps to spare", async () => {
    const skipped = async (passes: Pass[], session: Record<string, unknown> = {}) =>
      (await run([...passes, { events: [text("unexpected"), finish("stop")] }], session)).calls;

    expect(await skipped([firstPass], { finishCheckPrompt: undefined })).toHaveLength(1);
    expect(await skipped([firstPass], { finishCheckPrompt: "  " })).toHaveLength(1);
    // Ran out of steps mid-task.
    expect(
      await skipped([{ events: [toolCall, step, finish("tool-calls")], history: FIRST_HISTORY }]),
    ).toHaveLength(1);
    // Stream error.
    expect(
      await skipped([
        { events: [{ type: "error", payload: { error: "boom" } }], history: FIRST_HISTORY },
      ]),
    ).toHaveLength(1);
    // Two steps used of four: fewer than three left.
    expect(await skipped([firstPass], { maxSteps: 4 })).toHaveLength(1);
    // Nothing to continue from.
    expect(await skipped([{ ...firstPass, history: [] }])).toHaveLength(1);
  });
});
