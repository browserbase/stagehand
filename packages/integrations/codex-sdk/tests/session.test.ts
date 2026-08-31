/* eslint-disable require-yield */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeCodexModel,
  parseCodexRolloutUsage,
  readCodexRolloutUsage,
  runCodexSession,
  type CodexSdk,
} from "../src/index.js";

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
      sandboxMode: "read-only",
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
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe("tool step budget exhausted (1 steps)");
    expect(result.usageSource).toBe("none");
  });

  it("records where usage came from on a completed turn", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: "thread.started", thread_id: "thread-1" };
            yield { type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } };
          })(),
        }),
      }),
    };
    const result = await runCodexSession({ prompt: "task", model: "m", logger, sdk, thread: {} });
    expect(result.usageSource).toBe("turn_completed");
    expect(result.threadId).toBe("thread-1");
  });

  describe("rollout usage recovery", () => {
    const rolloutBody = [
      JSON.stringify({ type: "session_meta", payload: { id: "thread-abc" } }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 800,
              cache_write_input_tokens: 0,
              output_tokens: 50,
              reasoning_output_tokens: 20,
              total_tokens: 1050,
            },
            last_token_usage: { input_tokens: 1000, output_tokens: 50 },
          },
        },
      }),
      JSON.stringify({ type: "response_item", payload: { type: "function_call" } }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 2_100_000,
              cached_input_tokens: 2_000_000,
              cache_write_input_tokens: 5000,
              output_tokens: 9000,
              reasoning_output_tokens: 4000,
              total_tokens: 2_109_000,
            },
            last_token_usage: { input_tokens: 2_099_000, output_tokens: 8950 },
          },
        },
      }),
      "not json {",
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } }),
      "",
    ].join("\n");

    async function writeRollout(threadId: string, body = rolloutBody): Promise<string> {
      const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
      const dir = path.join(codexHome, "sessions", "2026", "08", "31");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `rollout-2026-08-31T10-00-00-${threadId}.jsonl`), body);
      return codexHome;
    }

    it("takes the last cumulative token_count and ignores malformed lines", () => {
      expect(parseCodexRolloutUsage(rolloutBody)).toEqual({
        input_tokens: 2_100_000,
        cached_input_tokens: 2_000_000,
        output_tokens: 9000,
        reasoning_output_tokens: 4000,
      });
      expect(parseCodexRolloutUsage("")).toBeUndefined();
      expect(
        parseCodexRolloutUsage('{"type":"event_msg","payload":{"type":"agent_message"}}'),
      ).toBeUndefined();
    });

    it("finds the thread's rollout under CODEX_HOME/sessions", async () => {
      const codexHome = await writeRollout("thread-abc");
      await expect(readCodexRolloutUsage(codexHome, "thread-abc")).resolves.toMatchObject({
        input_tokens: 2_100_000,
      });
      await expect(readCodexRolloutUsage(codexHome, "thread-other")).resolves.toBeUndefined();
      await expect(
        readCodexRolloutUsage("/nonexistent/codex-home", "thread-abc"),
      ).resolves.toBeUndefined();
    });

    it("recovers usage from the rollout when the budget abort pre-empts turn.completed", async () => {
      const codexHome = await writeRollout("thread-abc");
      const logged: string[] = [];
      const sdk: CodexSdk = {
        startThread: () => ({
          runStreamed: async () => ({
            events: (async function* () {
              yield { type: "thread.started", thread_id: "thread-abc" };
              yield { type: "item.completed", item: { type: "mcp_tool_call" } };
            })(),
          }),
        }),
      };
      const result = await runCodexSession({
        prompt: "task",
        model: "gpt-5.4-mini",
        logger: { ...logger, log: (line: { message: string }) => logged.push(line.message) },
        sdk,
        thread: {},
        maxToolSteps: 1,
        codexHome,
      });
      expect(result.status).toBe("max_turns");
      expect(result.usageSource).toBe("rollout");
      expect(result.tokenUsage).toEqual({
        input_tokens: 2_100_000,
        cached_input_tokens: 2_000_000,
        output_tokens: 9000,
        reasoning_output_tokens: 4000,
      });
      expect(logged.some((message) => message.includes("recovered from rollout"))).toBe(true);
    });

    it("does not override usage the turn reported itself", async () => {
      const codexHome = await writeRollout("thread-abc");
      const sdk: CodexSdk = {
        startThread: () => ({
          runStreamed: async () => ({
            events: (async function* () {
              yield { type: "thread.started", thread_id: "thread-abc" };
              yield { type: "turn.completed", usage: { input_tokens: 7, output_tokens: 3 } };
            })(),
          }),
        }),
      };
      const result = await runCodexSession({
        prompt: "task",
        model: "m",
        logger,
        sdk,
        thread: {},
        codexHome,
      });
      expect(result.usageSource).toBe("turn_completed");
      expect(result.tokenUsage.input_tokens).toBe(7);
    });

    it("leaves usage at none when the rollout is missing", async () => {
      const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
      const sdk: CodexSdk = {
        startThread: () => ({
          runStreamed: async () => ({
            events: (async function* () {
              yield { type: "thread.started", thread_id: "thread-missing" };
              yield { type: "item.completed", item: { type: "command_execution" } };
            })(),
          }),
        }),
      };
      const result = await runCodexSession({
        prompt: "task",
        model: "m",
        logger,
        sdk,
        thread: {},
        maxToolSteps: 1,
        codexHome,
      });
      expect(result.usageSource).toBe("none");
      expect(result.tokenUsage).toEqual({ input_tokens: 0, output_tokens: 0 });
    });
  });

  it("fails closed to read-only for unknown sandbox modes", async () => {
    let capturedSandbox: unknown;
    const sdk: CodexSdk = {
      startThread: (options) => {
        capturedSandbox = (options as Record<string, unknown>)?.sandboxMode;
        return {
          runStreamed: async () => ({ events: (async function* () {})() }),
        };
      },
    };
    await runCodexSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk,
      thread: { sandboxMode: "yolo" as never },
    });
    expect(capturedSandbox).toBe("read-only");
  });

  it("leaves unreported usage fields absent instead of zero-filling", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: "turn.completed", usage: { input_tokens: 7, output_tokens: 3 } };
          })(),
        }),
      }),
    };
    const result = await runCodexSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk,
      thread: {},
    });
    expect(result.tokenUsage.input_tokens).toBe(7);
    expect(result.tokenUsage.output_tokens).toBe(3);
    expect("reasoning_output_tokens" in result.tokenUsage).toBe(false);
    expect("cached_input_tokens" in result.tokenUsage).toBe(false);
  });
});
