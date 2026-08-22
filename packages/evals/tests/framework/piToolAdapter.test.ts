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
    expect(PI_TOOL_SURFACES[0]).toBe("stagehand_facade");
    expect(PI_TOOL_SURFACES).not.toContain("browse_cli");
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
