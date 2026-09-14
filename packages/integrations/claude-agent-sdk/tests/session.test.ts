/* eslint-disable require-yield */
import { describe, expect, it } from "vitest";
import {
  isClaudeCodeMaxTurnsError,
  normalizeClaudeModel,
  runClaudeAgentSession,
  type ClaudeAgentSdk,
} from "../src/index.js";

const logger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

describe("Claude Agent SDK session", () => {
  it("normalizes provider-prefixed models", () => {
    expect(normalizeClaudeModel("anthropic/claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-20250514",
    );
    expect(normalizeClaudeModel("claude-opus-4-1")).toBe("claude-opus-4-1");
  });

  it("classifies max-turn iteration errors without discarding streamed messages", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
        throw new Error("Reached maximum number of turns (20)");
      },
    };
    const result = await runClaudeAgentSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-20250514",
      logger,
      sdk,
      session: {},
    });

    expect(result.status).toBe("max_turns");
    expect(result.messages).toHaveLength(1);
    expect(result.stopReason).toContain("maximum number of turns");
    expect(isClaudeCodeMaxTurnsError(result.iterationError)).toBe(true);
  });

  it("classifies the SDK's structured error_max_turns result subtype", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield { type: "result", subtype: "error_max_turns", errors: [], usage: {} };
      },
    };
    const result = await runClaudeAgentSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-20250514",
      logger,
      sdk,
      session: {},
    });

    expect(result.status).toBe("max_turns");
  });

  it("does not misclassify a successful result whose text mentions a turn limit", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "result",
          subtype: "success",
          result: "The site enforces a turn limit of 3 rounds per player.",
          usage: {},
        };
      },
    };
    const result = await runClaudeAgentSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-20250514",
      logger,
      sdk,
      session: {},
    });

    expect(result.status).toBe("completed");
  });

  it("defaults allowedTools to an empty list", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const sdk: ClaudeAgentSdk = {
      query: async function* (input) {
        capturedOptions = input.options;
        yield { type: "result", subtype: "success", result: "ok", usage: {} };
      },
    };
    await runClaudeAgentSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-20250514",
      logger,
      sdk,
      session: {},
    });

    expect(capturedOptions?.allowedTools).toEqual([]);
  });

  it("forwards explicit session options and extracts result usage", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const mcpServers = { stagehand: { command: "node", args: ["server.mjs"] } };
    const sdk: ClaudeAgentSdk = {
      query: async function* (input) {
        capturedOptions = input.options;
        yield {
          type: "result",
          subtype: "success",
          result: "complete",
          usage: { input_tokens: 10, output_tokens: 4 },
        };
      },
    };
    const result = await runClaudeAgentSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-20250514",
      logger,
      sdk,
      session: {
        allowedTools: ["mcp__stagehand"],
        maxTurns: 7,
        mcpServers,
        systemPromptPreset: "Use Stagehand.",
      },
    });

    expect(capturedOptions).toMatchObject({
      model: "claude-sonnet-4-20250514",
      allowedTools: ["mcp__stagehand"],
      maxTurns: 7,
      mcpServers,
      systemPrompt: "Use Stagehand.",
    });
    expect(result.resultText).toBe("complete");
    expect(result.tokenUsage.totalTokens).toBe(14);
  });

  it("attributes tool results to their tool-use names", async () => {
    const completed: string[] = [];
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "tool-1", name: "mcp__stagehand__run" }] },
        };
        yield {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
        };
      },
    };
    await runClaudeAgentSession({
      prompt: "task",
      model: "claude-sonnet-4-1",
      logger,
      sdk,
      session: {},
      onToolResult: async (toolName) => {
        completed.push(toolName);
      },
    });
    expect(completed).toEqual(["mcp__stagehand__run"]);
  });

  it("redacts secrets from stop reasons and detaches the abort forwarder", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield { type: "assistant", message: { content: [] } };
        throw new Error(
          "connect failed: wss://c.example?signingKey=top-secret with sk-abcdef1234567890",
        );
      },
    };
    const added: string[] = [];
    const removed: string[] = [];
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (type: string) => added.push(type),
      removeEventListener: (type: string) => removed.push(type),
    } as unknown as AbortSignal;
    const result = await runClaudeAgentSession({
      prompt: "task",
      model: "claude-sonnet-4-5",
      sdk,
      signal,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("signingKey=[redacted]");
    expect(result.stopReason).toContain("sk-abcdef[redacted]");
    expect(result.stopReason).not.toContain("top-secret");
    expect(added).toEqual(["abort"]);
    expect(removed).toEqual(["abort"]);
  });
});
