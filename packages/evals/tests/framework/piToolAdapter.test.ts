import fsp from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_RUN_TOOL_NAME, type AgentMount } from "../../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  buildPiMountConfig,
  PI_TOOL_SURFACES,
  preparePiToolAdapter,
} from "../../framework/piToolAdapter.js";
import { EvalLogger } from "../../logger.js";

const runtimeMock = vi.hoisted(() => vi.fn());
vi.mock("../../framework/agentToolRuntime.js", () => ({
  startAgentToolRuntime: runtimeMock,
}));

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Inspect",
};

const logger = new EvalLogger(false);

function mcpMount(): AgentMount {
  return {
    via: "mcp",
    promptInstructions: "Use MCP",
    mcpServers: { stagehand: { command: "node", args: ["server.js"] } },
  };
}

afterEach(() => {
  runtimeMock.mockReset();
});

describe("pi tool adapter", () => {
  it("publishes the supported surfaces in default order", () => {
    expect(PI_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
      "stagehand_code",
      "playwright_code",
      "cdp_code",
    ]);
  });

  it("maps and validates MCP mounts", () => {
    const config = buildPiMountConfig({ mount: mcpMount(), plan, logger });
    expect(config.mcpServers).toEqual({
      stagehand: { command: "node", args: ["server.js"] },
    });
    expect(config.observedToolMatcher("mcp__stagehand__run")).toBe(true);
    expect(config.observedToolMatcher("mcp__other__run")).toBe(false);
    expect(() =>
      buildPiMountConfig({
        mount: {
          via: "mcp",
          promptInstructions: "bad",
          mcpServers: { broken: { args: [] } },
        },
        plan,
        logger,
      }),
    ).toThrow(/requires a string command/);
  });

  it("runs handle snippets and awaits observation capture", async () => {
    let observed = false;
    const config = buildPiMountConfig({
      mount: {
        via: "handles",
        promptInstructions: `Use ${AGENT_RUN_TOOL_NAME}`,
        handles: { page: { title: async () => "Example" } },
        runTool: {
          description: "run browser code",
          codeParamDescription: "code",
          denyMessage: "no",
        },
      },
      plan,
      logger,
      recordObservation: async () => {
        await Promise.resolve();
        observed = true;
      },
    });
    expect(config.customTools).toHaveLength(1);
    expect(config.customTools?.[0].name).toBe(AGENT_RUN_TOOL_NAME);
    const result = await config.customTools![0].execute(
      "id",
      { code: "return await page.title();" },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content).toEqual([{ type: "text", text: "Example" }]);
    expect(observed).toBe(true);
  });

  it("does not start a handle snippet for an already-aborted signal", async () => {
    const touched = vi.fn();
    const config = buildPiMountConfig({
      mount: handlesMount({ page: { touch: touched } }),
      plan,
      logger,
    });
    const controller = new AbortController();
    controller.abort(new Error("row cancelled"));

    await expect(
      config.customTools![0].execute(
        "id",
        { code: "await page.touch(); throw new Error('must not run')" },
        controller.signal,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow(/aborted before start/);
    expect(touched).not.toHaveBeenCalled();
  });

  it("aborts a running handle snippet and swallows a late rejection", async () => {
    let rejectPending: (error: Error) => void = () => {};
    const pending = new Promise<never>((_, reject) => {
      rejectPending = reject;
    });
    const config = buildPiMountConfig({
      mount: handlesMount({ page: { wait: vi.fn(() => pending) } }),
      plan,
      logger,
    });
    const controller = new AbortController();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const startedAt = Date.now();
      const execution = config.customTools![0].execute(
        "id",
        { code: "return await page.wait();" },
        controller.signal,
        undefined,
        {} as never,
      );
      controller.abort(new Error("row cancelled"));
      await expect(execution).rejects.toThrow(/row cancelled|aborted/);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      rejectPending(new Error("late failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }
  });

  it("times out a running handle snippet", async () => {
    const previous = process.env.EVAL_PI_RUN_TOOL_TIMEOUT_MS;
    process.env.EVAL_PI_RUN_TOOL_TIMEOUT_MS = "20";
    try {
      const config = buildPiMountConfig({
        mount: handlesMount({
          page: { wait: vi.fn(() => new Promise(() => {})) },
        }),
        plan,
        logger,
      });
      await expect(
        config.customTools![0].execute(
          "id",
          { code: "return await page.wait();" },
          undefined,
          undefined,
          {} as never,
        ),
      ).rejects.toThrow("pi adapter operation timed out after 20ms");
    } finally {
      if (previous === undefined) delete process.env.EVAL_PI_RUN_TOOL_TIMEOUT_MS;
      else process.env.EVAL_PI_RUN_TOOL_TIMEOUT_MS = previous;
    }
  });

  it("stringifies values that JSON.stringify cannot represent", async () => {
    const config = buildPiMountConfig({
      mount: handlesMount({ page: {} }),
      plan,
      logger,
    });

    await expect(
      config.customTools![0].execute(
        "id",
        { code: "return Symbol('result');" },
        undefined,
        undefined,
        {} as never,
      ),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "Symbol(result)" }] });
  });

  it("rejects CLI mounts", () => {
    expect(() =>
      buildPiMountConfig({
        mount: {
          via: "cli",
          promptInstructions: "cli",
          command: { bin: "browser" },
        },
        plan,
        logger,
      }),
    ).toThrow(/does not support agent mounts delivered via "cli"/);
  });

  it("prepares, observes, and idempotently cleans an MCP runtime", async () => {
    let cleanupCount = 0;
    runtimeMock.mockResolvedValue({
      running: {
        agentMount: mcpMount(),
        captureEvidence: async () => ({ url: "https://after" }),
      },
      cleanup: async () => {
        cleanupCount += 1;
      },
    });
    const adapter = await preparePiToolAdapter({
      toolSurface: "stagehand_facade",
      environment: "LOCAL",
      plan,
      logger,
    });
    expect(adapter.cwd.startsWith(os.tmpdir())).toBe(true);
    await expect(fsp.stat(adapter.cwd)).resolves.toBeDefined();
    adapter.onToolResult?.("mcp__stagehand__run");
    const observations = await adapter.drainStepObservations?.();
    expect(observations).toEqual([{ runIndex: 0, evidence: { url: "https://after" } }]);
    await adapter.cleanup();
    await adapter.cleanup();
    expect(cleanupCount).toBe(1);
    await expect(fsp.stat(adapter.cwd)).rejects.toThrow();
  });

  it("cleans runtime and temp directory after setup failure", async () => {
    let cleanupCount = 0;
    runtimeMock.mockResolvedValue({
      running: {
        agentMount: {
          via: "cli",
          promptInstructions: "cli",
          command: { bin: "browser" },
        },
      },
      cleanup: async () => {
        cleanupCount += 1;
      },
    });
    const before = new Set(
      (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith("stagehand-evals-pi-")),
    );
    await expect(
      preparePiToolAdapter({
        toolSurface: "stagehand_facade",
        environment: "LOCAL",
        plan,
        logger,
      }),
    ).rejects.toThrow(/via "cli"/);
    expect(cleanupCount).toBe(1);
    const after = (await fsp.readdir(os.tmpdir())).filter(
      (name) => name.startsWith("stagehand-evals-pi-") && !before.has(name),
    );
    expect(after).toEqual([]);
  });

  it("rejects browse_cli before starting a runtime", async () => {
    await expect(
      preparePiToolAdapter({
        toolSurface: "browse_cli",
        environment: "LOCAL",
        plan,
        logger,
      }),
    ).rejects.toThrow(/Harness "pi" supports --tool/);
    expect(runtimeMock).not.toHaveBeenCalled();
  });
});

function handlesMount(handles: Record<string, unknown>): AgentMount {
  return {
    via: "handles",
    promptInstructions: `Use ${AGENT_RUN_TOOL_NAME}`,
    handles,
    runTool: {
      description: "run browser code",
      codeParamDescription: "code",
      denyMessage: "no",
    },
  };
}
