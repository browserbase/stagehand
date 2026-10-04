import { describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { CursorSdkAgentFactory } from "@browserbasehq/stagehand-integrations-cursor-sdk";
import { buildCursorPrompt } from "../../framework/cursorRunner.js";
import { runCursorAgent, parseCursorResult } from "../../framework/cursorRunner.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import type { PreparedCursorToolAdapter } from "../../framework/cursorToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { listBenchHarnesses } from "../../framework/benchHarness.js";
import { EvalLogger } from "../../logger.js";

describe("Cursor SDK under the public cursor harness", () => {
  it("has one public cursor implementation while historical SDK records stay decodable", () => {
    expect(listBenchHarnesses()).toContain("cursor");
    expect(listBenchHarnesses()).not.toContain("cursor_sdk");
  });
  it("continues to parse historical marked and bare results", () => {
    for (const answer of [
      '{"success":true,"finalAnswer":"old"}',
      'EVAL_RESULT: {"success":true,"finalAnswer":"old"}',
    ]) {
      expect(parseCursorResult(answer)).toMatchObject({ success: true, finalAnswer: "old" });
    }
  });
  it("uses the supplied shared mount and prompt, observes the concrete tool, and counts it once", async () => {
    const plan: ExternalHarnessTaskPlan = {
      dataset: "webvoyager",
      taskId: "cursor-parity",
      startUrl: "https://example.com",
      instruction: "Report the heading",
    };
    const mcpServers = {
      stagehand: { command: "node", args: ["shared-relay.js"], env: { PORT: "1234" } },
    };
    const onToolResult = vi.fn();
    const toolAdapter: PreparedCursorToolAdapter = {
      toolSurface: "stagehand_facade",
      startupProfile: "tool_launch_local",
      cwd: "/tmp/cursor-runner-parity",
      mcpServerNames: ["stagehand"],
      mcpServers,
      promptInstructions: "Use the shared facade tools.",
      onToolResult,
      cleanup: async () => {},
    };
    const send = vi.fn(async (_prompt: string) => ({
      stream: async function* () {
        for (const status of ["running", "completed"]) {
          yield {
            type: "tool_call",
            call_id: "snapshot-1",
            name: "mcp",
            status,
            args: { providerIdentifier: "stagehand", toolName: "snapshot", args: {} },
            ...(status === "completed" && {
              result: { content: [{ type: "text", text: '[1] heading "Example"' }] },
            }),
          };
        }
      },
      wait: async () => ({
        status: "finished",
        result: 'EVAL_RESULT: {"success":true,"summary":"found heading","finalAnswer":"Example"}',
      }),
    }));
    const close = vi.fn();
    const createAgent = vi.fn<CursorSdkAgentFactory>(async () => ({ send, close }));

    const result = await runCursorAgent({
      plan,
      model: "grok-4.6" as AvailableModel,
      toolAdapter,
      logger: new EvalLogger(false),
      createAgent,
    });

    expect(createAgent.mock.calls[0][0].mcpServers).toBe(mcpServers);
    expect(createAgent.mock.calls[0][0]).toMatchObject({
      tools: ["mcp"],
      local: { cwd: toolAdapter.cwd, settingSources: [] },
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      `${EVAL_SYSTEM_PROMPT}\n\n${buildCursorPrompt(plan, toolAdapter.promptInstructions)}`,
    );
    expect(send.mock.calls[0][0].split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
    expect(onToolResult).toHaveBeenCalledExactlyOnceWith("stagehand.snapshot");
    expect(close).toHaveBeenCalledOnce();
    expect(createAgent.mock.calls[0][0]).not.toHaveProperty("systemPrompt");
    expect(result.harnessImplementation).toMatchObject({
      name: "sdk",
      version: 1,
      sdkVersion: "1.0.31",
    });
    expect(result).toMatchObject({
      _success: true,
      harnessStatus: "completed",
      finalAnswer: "Example",
    });
    expect(result.metrics).toMatchObject({ cursor_tool_steps: { count: 1, value: 1 } });
  });
});
