import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { runClaudeCodeAgent } from "../../framework/claudeCodeRunner.js";
import { installBrowseSkill } from "../../framework/claudeCodeToolAdapter.js";
import { runClaudeCuaAgent } from "../../framework/claudeCuaRunner.js";
import { CLAUDE_CUA_TOOL_INSTRUCTIONS } from "../../framework/claudeCuaToolAdapter.js";
import { runCursorAgent } from "../../framework/cursorRunner.js";
import { runGeminiCuaAgent } from "../../framework/geminiCuaRunner.js";
import { GEMINI_CUA_TOOL_INSTRUCTIONS } from "../../framework/geminiCuaToolAdapter.js";
import {
  readResultContract,
  runExternalHarnessTask,
} from "../../framework/harnesses/externalRunner.js";
import { runPiAgent } from "../../framework/piRunner.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

const MARKER_TAIL = "print exactly one line beginning with EVAL_RESULT:";
const JSON_TAIL = "At the end, return compact JSON matching this schema:";

const ANSWER = '{"success":true,"summary":"done","finalAnswer":"ok"}';
const logger = () => new EvalLogger(false);
const noTools = {
  execute: async () => {
    throw new Error("This fake model does not request tools.");
  },
};

/**
 * Each entry runs one harness's real run path against a fake model and returns
 * everything that harness sent to it: task prompt and system prompt alike.
 */
const oneLineHarnessRuns: Record<string, () => Promise<string>> = {
  claude_code: async () => {
    const sent: unknown[] = [];
    await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-5" as AvailableModel,
      logger: logger(),
      sdk: {
        query: async function* (input) {
          sent.push(input);
          yield { type: "result", subtype: "success", result: ANSWER };
        },
      },
    });
    return JSON.stringify(sent);
  },
  claude_cua: async () => {
    const sent: unknown[] = [];
    await runClaudeCuaAgent({
      plan,
      model: "anthropic/claude-sonnet-5" as AvailableModel,
      logger: logger(),
      client: {
        create: async (params) => {
          sent.push(params);
          return {
            content: [{ type: "text", text: ANSWER }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
      toolAdapter: {
        toolSurface: "anthropic_browser_toolset",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
        promptInstructions: CLAUDE_CUA_TOOL_INSTRUCTIONS,
        executor: noTools,
        observedToolMatcher: () => true,
        drainObservationsByToolUse: () => new Map(),
        cleanup: async () => {},
      },
    });
    return JSON.stringify(sent);
  },
  cursor: async () => {
    const sent: unknown[] = [];
    await runCursorAgent({
      plan,
      model: "grok-4.6" as AvailableModel,
      logger: logger(),
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/tmp/result-contract",
        mcpServerNames: ["stagehand"],
        mcpServers: { stagehand: { command: "node", args: ["relay.js"] } },
        promptInstructions: "Use the facade tools.",
        onToolResult: () => {},
        cleanup: async () => {},
      },
      createAgent: async (options) => {
        sent.push(options);
        return {
          send: async (prompt: string) => {
            sent.push(prompt);
            return {
              stream: async function* () {},
              wait: async () => ({ status: "finished", result: ANSWER }),
            };
          },
          close: () => {},
        };
      },
    });
    return JSON.stringify(sent);
  },
  gemini_cua: async () => {
    const sent: unknown[] = [];
    await runGeminiCuaAgent({
      plan,
      model: "google/gemini-3.8-flash" as AvailableModel,
      logger: logger(),
      client: {
        generateContent: async (params) => {
          sent.push(params);
          return {
            candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          };
        },
      },
      toolAdapter: {
        toolSurface: "google_computer_use",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
        promptInstructions: GEMINI_CUA_TOOL_INSTRUCTIONS,
        executor: noTools,
        facade: {
          run: async () => "",
          screenshot: async () => ({ data: "png", mimeType: "image/png" }),
        },
        observedToolMatcher: () => true,
        cleanup: async () => {},
      },
    });
    return JSON.stringify(sent);
  },
  pi: async () => {
    const sent: unknown[] = [];
    await runPiAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: logger(),
      sdk: {
        async createSession(options) {
          sent.push(options);
          let listener: (event: Record<string, unknown>) => void = () => {};
          return {
            agent: { state: {} },
            subscribe(next) {
              listener = next;
              return () => {};
            },
            async prompt(prompt) {
              sent.push(prompt);
              listener({
                type: "message_end",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: ANSWER }],
                  stopReason: "stop",
                  usage: { input: 1, output: 1, totalTokens: 2 },
                },
              });
              listener({ type: "turn_end" });
            },
            async abort() {},
            dispose() {},
          };
        },
      },
    });
    return JSON.stringify(sent);
  },
};

// Default-path assertions must not inherit a contract from the shell running the tests.
beforeEach(() => {
  vi.stubEnv("EVAL_RESULT_CONTRACT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EVAL_RESULT_CONTRACT", () => {
  it("keeps each harness's own answer format when unset", () => {
    expect(readResultContract("marker", {})).toBe("marker");
    expect(readResultContract("structured_output", {})).toBe("structured_output");
  });

  it("gives every harness the JSON answer format when set to structured_output", () => {
    const env = { EVAL_RESULT_CONTRACT: "structured_output" };
    expect(readResultContract("marker", env)).toBe("structured_output");
    expect(readResultContract("structured_output", env)).toBe("structured_output");
  });

  it("rejects any other value instead of silently running the default", () => {
    expect(() => readResultContract("marker", { EVAL_RESULT_CONTRACT: "json" })).toThrow(
      /EVAL_RESULT_CONTRACT/,
    );
  });

  it.each(Object.entries(oneLineHarnessRuns))(
    "%s asks for one line by default and only for JSON when the switch is set",
    async (_harness, run) => {
      expect(await run()).toContain(MARKER_TAIL);
      vi.stubEnv("EVAL_RESULT_CONTRACT", "structured_output");
      const sent = await run();
      expect(sent).toContain(JSON_TAIL);
      // Neither the task prompt nor the system prompt may still ask for the marker line.
      expect(sent).not.toContain("EVAL_RESULT");
    },
  );

  it("tells Claude Code's browse skill which answer format the run uses", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "result-contract-"));
    const skill = () => readFile(path.join(cwd, ".claude", "skills", "browse", "SKILL.md"), "utf8");
    try {
      await installBrowseSkill(cwd);
      expect(await skill()).toContain("`EVAL_RESULT` format");
      vi.stubEnv("EVAL_RESULT_CONTRACT", "structured_output");
      await installBrowseSkill(cwd);
      expect(await skill()).not.toContain("EVAL_RESULT");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records the JSON answer format on runs that use it", async () => {
    vi.stubEnv("VERIFIER_PERSIST_TRAJECTORIES", "0");
    const run = () =>
      runExternalHarnessTask({
        harness: "example",
        plan,
        logger: new EvalLogger(false),
        resultContract: readResultContract("marker"),
        fallbackErrorMessage: "missing result",
        runSession: async () => ({
          raw: {},
          resultText: '{"success":true,"finalAnswer":"done"}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
          metrics: {},
        }),
        toTrajectory: () => {
          throw new Error("no verifier");
        },
      });
    expect((await run()).harnessConfiguration).not.toHaveProperty("resultContract");
    vi.stubEnv("EVAL_RESULT_CONTRACT", "structured_output");
    expect((await run()).harnessConfiguration).toMatchObject({
      resultContract: "structured_output",
    });
  });
});
