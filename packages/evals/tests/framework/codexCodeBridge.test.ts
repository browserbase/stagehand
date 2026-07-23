import { describe, expect, it, afterEach } from "vitest";
import {
  buildBridgeClientScript,
  startCodeBridge,
  type CodeBridge,
} from "../../framework/codexCodeBridge.js";
import { EvalLogger } from "../../logger.js";
import type { LLMExposure } from "../../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "test-1",
  startUrl: "https://example.com",
  instruction: "do the thing",
};

function exposureWith(handles: Record<string, unknown>): LLMExposure {
  return {
    kind: "code_handles",
    handles,
    promptInstructions: "test",
    runTool: {
      description: "test run tool",
      codeParamDescription: "code",
      denyMessage: "deny",
      task: { instruction: plan.instruction, startUrl: plan.startUrl },
    },
    cleanup: async () => {},
  };
}

async function post(bridge: CodeBridge, code: string) {
  const res = await fetch(`http://127.0.0.1:${bridge.port}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return (await res.json()) as { ok: boolean; result?: string; error?: string };
}

let bridge: CodeBridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

describe("codex code bridge", () => {
  it("executes snippets with handles, startUrl, and task in scope", async () => {
    const page = { url: async () => "https://example.com/live" };
    bridge = await startCodeBridge({
      exposure: exposureWith({ page, marker: 42 }),
      plan,
      logger: new EvalLogger(),
    });
    const out = await post(
      bridge,
      "return { url: await page.url(), marker, startUrl, instruction: task.instruction };",
    );
    expect(out.ok).toBe(true);
    expect(JSON.parse(out.result!)).toEqual({
      url: "https://example.com/live",
      marker: 42,
      startUrl: "https://example.com",
      instruction: "do the thing",
    });
  });

  it("reports snippet errors without killing the bridge", async () => {
    bridge = await startCodeBridge({
      exposure: exposureWith({}),
      plan,
      logger: new EvalLogger(),
    });
    const bad = await post(bridge, "throw new Error('boom');");
    expect(bad).toEqual({ ok: false, error: "boom" });
    const good = await post(bridge, "return 'still alive';");
    expect(good).toEqual({ ok: true, result: "still alive" });
  });

  it("times out runaway snippets", async () => {
    process.env.EVAL_CODEX_RUN_TOOL_TIMEOUT_MS = "150";
    try {
      bridge = await startCodeBridge({
        exposure: exposureWith({}),
        plan,
        logger: new EvalLogger(),
      });
      const out = await post(bridge, "await new Promise(() => {});");
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/timed out after 150ms/);
    } finally {
      delete process.env.EVAL_CODEX_RUN_TOOL_TIMEOUT_MS;
    }
  });

  it("client script embeds the bridge port and pipes code", () => {
    const script = buildBridgeClientScript(45678);
    expect(script).toContain("http://127.0.0.1:45678/run");
    expect(script).toContain("process.argv[2]");
  });
});
