import fsp from "node:fs/promises";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { MastraSdk } from "@browserbasehq/stagehand-integrations-mastra-sdk";
import type { AgentMount, ToolStartResult } from "../../core/contracts/tool.js";
import { AGENT_RUN_TOOL_NAME } from "../../core/contracts/tool.js";
import { EvalsError } from "../../errors.js";
import type { startAgentToolRuntime } from "../../framework/agentToolRuntime.js";
import {
  buildMastraMcpServers,
  executeViaCodeBridge,
  MASTRA_RUN_TOOL_NAME,
  MASTRA_TOOL_SURFACES,
  mastraToolNameMatcher,
  prepareMastraToolAdapter,
} from "../../framework/mastraToolAdapter.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";
import { EvalLogger } from "../../logger.js";

const plan = {
  dataset: "webvoyager" as const,
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Do it",
};

describe("Mastra tool adapter", () => {
  it("lists supported surfaces with stagehand_facade first", () => {
    expect(MASTRA_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
      "stagehand_code",
      "playwright_code",
      "cdp_code",
    ]);
  });

  it("resolves supported surfaces and rejects unsupported ones", () => {
    const harness = { harness: "mastra", supportedToolSurfaces: MASTRA_TOOL_SURFACES };
    expect(resolveToolSurface(harness)).toBe("stagehand_facade");
    for (const surface of MASTRA_TOOL_SURFACES) {
      expect(resolveToolSurface(harness, surface)).toBe(surface);
    }
    expect(() => resolveToolSurface(harness, "browse_cli")).toThrow(
      /Harness "mastra" supports --tool/,
    );
    expect(() => resolveToolSurface(harness, "understudy_code")).toThrow(
      /Harness "mastra" supports --tool/,
    );
  });

  it("resolves startup profiles for each surface and environment", () => {
    for (const surface of ["stagehand_facade", "stagehand_code"] as const) {
      expect(resolveStartupProfile(surface, "LOCAL")).toBe("tool_launch_local");
      expect(resolveStartupProfile(surface, "BROWSERBASE")).toBe("tool_create_browserbase");
    }
    for (const surface of [
      "playwright_mcp",
      "chrome_devtools_mcp",
      "playwright_code",
      "cdp_code",
    ] as const) {
      expect(resolveStartupProfile(surface, "LOCAL")).toBe("runner_provided_local_cdp");
      expect(resolveStartupProfile(surface, "BROWSERBASE")).toBe("runner_provided_browserbase_cdp");
    }
  });

  it("maps stdio MCP definitions and rejects non-stdio definitions", () => {
    expect(
      buildMastraMcpServers(
        { stagehand: { command: "node", args: ["server.mjs"], env: { A: "1" } } },
        "/tmp/work",
      ),
    ).toEqual({
      stagehand: {
        command: "node",
        args: ["server.mjs"],
        env: { A: "1" },
        cwd: "/tmp/work",
      },
    });
    expect(() =>
      buildMastraMcpServers({ remote: { url: "https://example.com/mcp" } }, "/tmp/work"),
    ).toThrow(/remote.*stdio/);
    expect(() => buildMastraMcpServers({ broken: {} }, "/tmp/work")).toThrow(/broken.*command/);
  });

  it("matches Mastra's server-prefixed tool names", () => {
    const matcher = mastraToolNameMatcher(["stagehand", "playwright"]);
    expect(matcher("stagehand_run")).toBe(true);
    expect(matcher("playwright_click")).toBe(true);
    expect(matcher("other_tool")).toBe(false);
  });

  it("prepares an MCP mount, records observations, and cleans up idempotently", async () => {
    const cleanup = vi.fn(async () => {});
    const startRuntime = fakeStartRuntime(
      {
        via: "mcp",
        promptInstructions: "p",
        mcpServers: {
          stagehand: { command: "node", args: ["s.mjs"], env: { A: "1" } },
        },
      },
      cleanup,
      async () => ({ url: "https://x" }),
    );
    const adapter = await prepareMastraToolAdapter({
      environment: "LOCAL",
      plan,
      logger: new EvalLogger(false),
      startRuntime,
    });
    expect(adapter.cwd.startsWith(os.tmpdir())).toBe(true);
    expect(adapter).not.toHaveProperty("env");
    await expect(fsp.access(adapter.cwd)).resolves.toBeUndefined();
    expect(adapter.mcpServers?.stagehand).toMatchObject({
      command: "node",
      args: ["s.mjs"],
      env: { A: "1" },
      cwd: adapter.cwd,
    });
    adapter.onToolResult?.("other_tool");
    adapter.onToolResult?.("stagehand_run");
    expect(await adapter.drainStepObservations?.()).toHaveLength(1);
    await adapter.cleanup();
    await adapter.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(fsp.access(adapter.cwd)).rejects.toThrow();
  });

  it("creates an in-process code tool backed by the real bridge", async () => {
    const cleanup = vi.fn(async () => {});
    const sdk: MastraSdk = {
      createAgent: () => {
        throw new Error("unused");
      },
      createMcpClient: () => {
        throw new Error("unused");
      },
      createTool: (options: Parameters<MastraSdk["createTool"]>[0]) => options,
    };
    const adapter = await prepareMastraToolAdapter({
      toolSurface: "stagehand_code",
      environment: "LOCAL",
      plan,
      logger: new EvalLogger(false),
      sdk,
      startRuntime: fakeStartRuntime(
        {
          via: "handles",
          promptInstructions: `Call ${AGENT_RUN_TOOL_NAME}.`,
          handles: { marker: 42 },
          runTool: {
            description: "Run browser code",
            codeParamDescription: "JavaScript",
            denyMessage: "denied",
          },
        },
        cleanup,
      ),
    });
    const tool = adapter.tools?.[MASTRA_RUN_TOOL_NAME];
    expect(tool).toBeDefined();
    expect(adapter.promptInstructions).not.toContain(AGENT_RUN_TOOL_NAME);
    expect(adapter.promptInstructions).toContain(MASTRA_RUN_TOOL_NAME);
    const execute = readExecute(tool);
    await expect(execute({ code: "return marker" }, {})).resolves.toEqual({
      ok: true,
      result: "42",
    });
    await adapter.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(fsp.access(adapter.cwd)).rejects.toThrow();
  });

  it("removes the temporary workspace when runtime cleanup times out", async () => {
    const previous = process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS;
    process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS = "20";
    try {
      const adapter = await prepareMastraToolAdapter({
        environment: "LOCAL",
        plan,
        logger: new EvalLogger(false),
        startRuntime: fakeStartRuntime(
          {
            via: "mcp",
            promptInstructions: "p",
            mcpServers: { stagehand: { command: "node" } },
          },
          () => new Promise<void>(() => {}),
        ),
      });
      await expect(adapter.cleanup()).resolves.toBeUndefined();
      await expect(fsp.access(adapter.cwd)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS;
      else process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS = previous;
    }
  });

  it("wraps setup failures in a sanitized EvalsError after cleanup", async () => {
    const cleanup = vi.fn(async () => {});
    const cause = new Error("invalid?apiKey=secret123");

    let thrown: unknown;
    try {
      await prepareMastraToolAdapter({
        environment: "LOCAL",
        plan,
        logger: new EvalLogger(false),
        startRuntime: fakeStartRuntime(
          {
            via: "mcp",
            promptInstructions: "p",
            mcpServers: {
              stagehand: {
                get command() {
                  throw cause;
                },
              },
            },
          },
          cleanup,
        ),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EvalsError);
    expect((thrown as Error).message).toBe(
      "mastra tool adapter setup failed: invalid?apiKey=[redacted]",
    );
    expect((thrown as Error).cause).toBe(cause);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("wraps runtime startup failures in a sanitized EvalsError", async () => {
    await expect(
      prepareMastraToolAdapter({
        environment: "LOCAL",
        plan,
        logger: new EvalLogger(false),
        startRuntime: async () => {
          throw new Error("failed https://x.test?apiKey=secret123");
        },
      }),
    ).rejects.toMatchObject({
      name: "EvalsError",
      message: "mastra tool adapter setup failed: failed https://x.test?apiKey=[redacted]",
    });
  });

  it("returns a structured error when the bridge port is closed", async () => {
    await expect(executeViaCodeBridge(1, "return 1")).resolves.toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });
});

function fakeStartRuntime(
  agentMount: AgentMount,
  cleanup: () => Promise<void>,
  captureEvidence?: ToolStartResult["captureEvidence"],
): typeof startAgentToolRuntime {
  return (async () => ({
    running: {
      session: {},
      agentMount,
      captureEvidence,
      cleanup: async () => {},
      metadata: {
        environment: "LOCAL",
        browserOwnership: "tool",
        connectionMode: "launch",
      },
    },
    cleanup,
  })) as unknown as typeof startAgentToolRuntime;
}

function readExecute(
  value: unknown,
): (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown> {
  if (!value || typeof value !== "object" || !("execute" in value)) {
    throw new Error("tool execute missing");
  }
  const execute = value.execute;
  if (typeof execute !== "function") throw new Error("tool execute invalid");
  return execute as (
    input: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<unknown>;
}
