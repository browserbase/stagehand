import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentMount, ToolStartResult } from "../../core/contracts/tool.js";
import type { startAgentToolRuntime } from "../../framework/agentToolRuntime.js";
import { mastracodeHarness } from "../../framework/benchHarness.js";
import { resolveToolSurface } from "../../framework/harnesses/toolSurfaceResolution.js";
import {
  MASTRACODE_TOOL_SURFACES,
  buildMastracodeDriverEnv,
  buildMastracodeMcpServers,
  cleanupRuntime,
  prepareMastracodeToolAdapter,
  resolveMastracodeRuntimePaths,
} from "../../framework/mastracodeToolAdapter.js";
import { EvalLogger } from "../../logger.js";

const plan = {
  dataset: "webvoyager" as const,
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Do it",
};

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
      metadata: { environment: "LOCAL", browserOwnership: "tool", connectionMode: "launch" },
    },
    browserSession: { provider: "local" },
    cleanup,
  })) as unknown as typeof startAgentToolRuntime;
}

describe("mastracode tool adapter", () => {
  it("offers only the Stagehand facade, per the harness contract", () => {
    expect(MASTRACODE_TOOL_SURFACES).toEqual(["stagehand_facade"]);
    expect(resolveToolSurface(mastracodeHarness)).toBe("stagehand_facade");
    expect(() => resolveToolSurface(mastracodeHarness, "playwright_mcp")).toThrow(
      'Harness "mastracode" supports --tool stagehand_facade; received "playwright_mcp".',
    );
    expect(() => resolveToolSurface(mastracodeHarness, "browse_cli")).toThrow(
      /Harness "mastracode" supports --tool stagehand_facade/u,
    );
  });

  it("translates stdio MCP specs with an allowlisted child environment", () => {
    const servers = buildMastracodeMcpServers(
      {
        stagehand: {
          command: "/usr/bin/node",
          args: ["bridge.mjs", "--port", "1"],
          env: { STAGEHAND_BRIDGE_TOKEN: "t" },
        },
      },
      {
        PATH: "/usr/bin:/bin",
        HOME: "/runner/home",
        PNPM_HOME: "/runner/pnpm",
        ANTHROPIC_API_KEY: "sk-ant-must-not-leak",
        OPENAI_API_KEY: "sk-must-not-leak",
        MASTRA_GATEWAY_API_KEY: "must-not-leak",
      },
    );
    expect(servers).toEqual({
      stagehand: {
        command: "/usr/bin/node",
        args: ["bridge.mjs", "--port", "1"],
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/runner/home",
          PNPM_HOME: "/runner/pnpm",
          STAGEHAND_BRIDGE_TOKEN: "t",
        },
      },
    });
    expect(JSON.stringify(servers)).not.toContain("must-not-leak");
    expect(() => buildMastracodeMcpServers({ remote: { url: "https://x/mcp" } }, {})).toThrow(
      /remote.*stdio/u,
    );
    expect(() => buildMastracodeMcpServers({ "bad name": { command: "node" } }, {})).toThrow(
      /Invalid mastracode MCP server name/u,
    );
  });

  it("gives the driver only allowlisted keys and throwaway directories", () => {
    const paths = resolveMastracodeRuntimePaths("/tmp/mc-root");
    expect(paths).toEqual({
      root: "/tmp/mc-root",
      home: "/tmp/mc-root/home",
      appDataDir: "/tmp/mc-root/appdata",
      workspace: "/tmp/mc-root/workspace",
    });
    const env = buildMastracodeDriverEnv(paths, {
      PATH: "/bin",
      HOME: "/Users/real",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_BASE_URL: "https://proxy.example/v1",
      OPENAI_API_KEY: "sk-oai",
      MASTRA_GATEWAY_API_KEY: "gateway",
      TAVILY_API_KEY: "tavily",
      PARALLEL_API_KEY: "parallel",
      MASTRA_DB_URL: "libsql://elsewhere",
      MASTRA_APP_DATA_DIR: "/Users/real/.mastra",
      VITEST: "true",
      BROWSERBASE_API_KEY: "bb",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/tmp/mc-root/home",
      MASTRA_APP_DATA_DIR: "/tmp/mc-root/appdata",
      MASTRA_TELEMETRY_DISABLED: "1",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_BASE_URL: "https://proxy.example/v1",
      OPENAI_API_KEY: "sk-oai",
    });
  });

  it("prepares a facade mount in empty per-task directories and cleans up once", async () => {
    const cleanup = vi.fn(async () => {});
    const adapter = await prepareMastracodeToolAdapter({
      environment: "LOCAL",
      plan,
      logger: new EvalLogger(false),
      startRuntime: fakeStartRuntime(
        {
          via: "mcp",
          promptInstructions: "Use stagehand_run.",
          mcpServers: { stagehand: { command: "node", args: ["s.mjs"] } },
        },
        cleanup,
        async () => ({ url: "https://x" }),
      ),
    });
    expect(adapter.paths.root.startsWith(os.tmpdir())).toBe(true);
    expect(adapter.facadeToolNames).toEqual([
      "stagehand_run",
      "stagehand_snapshot",
      "stagehand_screenshot",
    ]);
    expect(adapter.promptInstructions).toBe("Use stagehand_run.");
    expect(adapter.env.HOME).toBe(adapter.paths.home);
    expect(adapter.env.MASTRA_APP_DATA_DIR).toBe(adapter.paths.appDataDir);
    expect(await fsp.readdir(adapter.paths.workspace)).toEqual([]);
    expect(adapter.observedToolMatcher("stagehand_snapshot")).toBe(true);
    expect(adapter.observedToolMatcher("execute_command")).toBe(false);
    adapter.recordObservation?.();
    expect(await adapter.drainStepObservations?.()).toHaveLength(1);
    await adapter.cleanup();
    await adapter.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(fsp.access(adapter.paths.root)).rejects.toThrow();
  });

  it("rejects non-MCP mounts and releases the runtime", async () => {
    const cleanup = vi.fn(async () => {});
    await expect(
      prepareMastracodeToolAdapter({
        environment: "LOCAL",
        plan,
        logger: new EvalLogger(false),
        startRuntime: fakeStartRuntime(
          { via: "cli", promptInstructions: "p", command: { bin: "browse" } },
          cleanup,
        ),
      }),
    ).rejects.toThrow(/hosts MCP servers only/u);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("redacts secrets from cleanup failures", async () => {
    const logger = new EvalLogger(false);
    const warn = vi.spyOn(logger, "warn");
    await cleanupRuntime(async () => {
      throw new Error("close failed: https://x?apiKey=sk-secret-123");
    }, logger);
    const message = String(warn.mock.calls[0]?.[0]?.message);
    expect(message).toContain("mastracode adapter cleanup failed");
    expect(message).not.toContain("sk-secret-123");
  });

  it("keeps per-task directories under the temp root", () => {
    const paths = resolveMastracodeRuntimePaths(path.join(os.tmpdir(), "x"));
    expect(path.dirname(paths.workspace)).toBe(paths.root);
  });
});
