import { describe, expect, it, vi } from "vitest";

vi.mock("@browserbasehq/stagehand-integrations-unreal-agent-sdk", () => ({
  runUnrealSession: async () => ({
    events: [] as unknown[],
    toolCalls: [] as unknown[],
    finalMessage: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"done"}',
    status: "completed",
    tokenUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 },
  }),
}));

import { runUnrealAgent } from "../../framework/unrealAgentRunner.js";

describe("Unreal Agent browser-use gate", () => {
  it("fails a self-reported success without a facade call", async () => {
    const result = await runUnrealAgent({
      plan: { dataset: "test", instruction: "browse", startUrl: "https://example.com" } as never,
      model: "openai/gpt-6-luna" as never,
      logger: { getLogs: (): unknown[] => [] } as never,
      toolAdapter: {
        cwd: "/tmp",
        env: {},
        facadeCalls: [],
        promptInstructions: "",
        cleanup: async () => {},
      } as never,
      verifier: undefined as never,
    });
    expect(result._success).toBe(false);
    expect(result.outcomeGates).toContain("no_browser_use");
  });
});
