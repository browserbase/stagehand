/* eslint-disable require-yield */
import { describe, expect, it } from "vitest";
import { normalizeCodexModel, runCodexSession, type CodexSdk } from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

describe("Codex SDK session", () => {
  it("normalizes provider-prefixed and default models", () => {
    expect(normalizeCodexModel("openai/gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(normalizeCodexModel("gpt-5.4")).toBe("gpt-5.4");
    expect(normalizeCodexModel("codex/default")).toBe("gpt-5.4-mini");
  });

  it("forwards thread options and collects messages and usage", async () => {
    let threadOptions: Record<string, unknown> | undefined;
    let turnOptions: Record<string, unknown> | undefined;
    const sdk: CodexSdk = {
      startThread: (options) => {
        threadOptions = options;
        return {
          runStreamed: async (_prompt, options) => {
            turnOptions = options;
            return {
              events: (async function* () {
                yield {
                  type: "item.completed",
                  item: { type: "agent_message", text: "complete" },
                };
                yield {
                  type: "turn.completed",
                  usage: { input_tokens: 10, output_tokens: 4 },
                };
              })(),
            };
          },
        };
      },
    };
    const outputSchema = { type: "object" };
    const result = await runCodexSession({
      prompt: "task",
      model: "openai/gpt-5.4-mini",
      logger,
      sdk,
      thread: { workingDirectory: "/tmp/work" },
      outputSchema,
    });

    expect(threadOptions).toMatchObject({
      model: "gpt-5.4-mini",
      workingDirectory: "/tmp/work",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled",
      skipGitRepoCheck: true,
    });
    expect(turnOptions?.outputSchema).toBe(outputSchema);
    expect(result.finalMessage).toBe("complete");
    expect(result.status).toBe("completed");
    expect(result.tokenUsage).toMatchObject({ input_tokens: 10, output_tokens: 4 });
  });

  it("reports SDK errors instead of throwing", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => {
          throw new Error("codex failed");
        },
      }),
    };
    const result = await runCodexSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk,
      thread: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(String(result.iterationError)).toContain("codex failed");
  });

  it("aborts when the tool-step budget is exhausted", async () => {
    let signal: AbortSignal | undefined;
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async (_prompt, options) => {
          signal = options?.signal as AbortSignal;
          return {
            events: (async function* () {
              yield { type: "item.completed", item: { type: "command_execution" } };
            })(),
          };
        },
      }),
    };
    const result = await runCodexSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk,
      thread: {},
      maxToolSteps: 1,
    });
    expect(signal?.aborted).toBe(true);
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("tool step budget exhausted (1 steps)");
  });
});
