import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCoreTool, listCoreRunnableTools, listCoreTools } from "../../core/tools/registry.js";
import {
  buildStagehandFacadeEnv,
  buildStagehandFacadeServerSpec,
  StagehandFacadeTool,
  StagehandFacadeToolError,
} from "../../core/tools/stagehand_facade.js";
import { buildCodexMcpServers } from "../../framework/codexToolAdapter.js";
import { claudeCodeHarness, codexHarness } from "../../framework/benchHarness.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";
import type { EvalLogger } from "../../logger.js";

const ORIGINAL_ENV = { ...process.env };
const MINIMAL_FACADE_SOURCE = String.raw`
let carry = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  carry += chunk;
  const lines = carry.split("\n");
  carry = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { protocolVersion: request.params.protocolVersion, capabilities: {}, serverInfo: { name: "fake" } },
      }) + "\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/u.test(key)) delete process.env[key];
  }
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("stagehand facade tool surface", () => {
  it("is registered as agent-mount-only", () => {
    expect(listCoreTools()).toContain("stagehand_facade");
    // Never selectable for core-tier runs: its CoreSession throws on every
    // page operation.
    expect(listCoreRunnableTools()).not.toContain("stagehand_facade");
    expect(getCoreTool("stagehand_facade")).toBeInstanceOf(StagehandFacadeTool);
  });

  it("uses typed, sanitized errors for invalid lifecycle operations", async () => {
    const tool = new StagehandFacadeTool();
    await expect(
      tool.start({
        logger: {} as EvalLogger,
        environment: "LOCAL",
        startupProfile: "tool_create_browserbase",
      }),
    ).rejects.toEqual(
      new StagehandFacadeToolError(
        "stagehand_facade received an invalid startup profile for the selected environment.",
      ),
    );

    const running = await tool.start({
      logger: {} as EvalLogger,
      environment: "LOCAL",
      startupProfile: "tool_launch_local",
    });
    await expect(running.session.activePage()).rejects.toEqual(
      new StagehandFacadeToolError(
        "stagehand_facade is available only through its agent MCP mount.",
      ),
    );
    await running.cleanup();
  });

  it("preserves facade MCP timeouts in the Codex config", () => {
    const server = { command: "node", args: ["stdio-server.mjs"] };
    expect(buildCodexMcpServers("stagehand_facade", { stagehand: server })).toEqual({
      stagehand: {
        ...server,
        startup_timeout_sec: 60,
        tool_timeout_sec: 300,
      },
    });
    expect(buildCodexMcpServers("playwright_mcp", { playwright: server })).toEqual({
      playwright: server,
    });
  });

  it("builds the shipped facade MCP mount", async () => {
    process.env.STAGEHAND_MODEL_NAME = "openai/gpt-5-mini";
    process.env.BROWSERBASE_API_KEY = "browserbase-secret";
    process.env.OPENAI_API_KEY = "must-not-cross-the-mount";

    const running = await new StagehandFacadeTool({
      serverSpec: (environment) => ({
        command: process.execPath,
        args: ["-e", MINIMAL_FACADE_SOURCE],
        env: buildStagehandFacadeEnv(environment),
      }),
    }).start({
      logger: {} as EvalLogger,
      environment: "LOCAL",
      startupProfile: "tool_launch_local",
    });

    try {
      expect(running.agentMount?.via).toBe("mcp");
      if (running.agentMount?.via !== "mcp") throw new Error("expected MCP mount");
      expect(running.agentMount.promptInstructions).toBe(FACADE_AGENT_INSTRUCTIONS);
      expect(Object.keys(running.agentMount.mcpServers)).toEqual(["stagehand"]);
      expect(running.agentMount.mcpServers.stagehand).toMatchObject({
        command: process.execPath,
        args: ["-e", expect.stringContaining("STAGEHAND_EVALS_FACADE_BRIDGE_PORT")],
        env: {
          STAGEHAND_EVALS_FACADE_BRIDGE_PORT: expect.stringMatching(/^\d+$/u),
        },
      });
      const relayEnv = (
        running.agentMount.mcpServers.stagehand as {
          env: Record<string, string>;
        }
      ).env;
      expect(relayEnv).not.toHaveProperty("BROWSERBASE_API_KEY");
      expect(relayEnv).not.toHaveProperty("STAGEHAND_MODEL_NAME");
      expect(relayEnv).not.toHaveProperty("OPENAI_API_KEY");
      expect(running.captureEvidence).toBeTypeOf("function");
      await expect(running.captureEvidence?.()).resolves.toEqual({});
      expect(running.metadata.facadeBridgePort).toEqual(expect.any(Number));
    } finally {
      await running.cleanup();
    }
  });

  it("builds the default facade server spec with the shipped entrypoint", () => {
    process.env.STAGEHAND_MODEL_NAME = "openai/gpt-5-mini";
    process.env.BROWSERBASE_API_KEY = "browserbase-secret";
    process.env.OPENAI_API_KEY = "must-not-cross-the-facade";

    expect(buildStagehandFacadeServerSpec("BROWSERBASE")).toMatchObject({
      command: process.execPath,
      args: [expect.stringMatching(/facade[/\\]stdio-server\.mjs$/u)],
      env: {
        STAGEHAND_BROWSER: "browserbase",
        STAGEHAND_MODEL_NAME: "openai/gpt-5-mini",
        BROWSERBASE_API_KEY: "browserbase-secret",
      },
    });
    expect(buildStagehandFacadeServerSpec("BROWSERBASE").env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("filters host env and overrides browser selection for each eval environment", () => {
    process.env.STAGEHAND_BROWSER = "browserbase";
    process.env.STAGEHAND_MODEL_API_KEY = "model-secret";
    process.env.BROWSERBASE_PROJECT_ID = "project-id";
    process.env.ANTHROPIC_API_KEY = "must-not-cross-the-mount";

    expect(buildStagehandFacadeEnv("LOCAL")).toEqual({
      STAGEHAND_BROWSER: "local",
      STAGEHAND_MODEL_API_KEY: "model-secret",
      BROWSERBASE_PROJECT_ID: "project-id",
    });
    expect(buildStagehandFacadeEnv("BROWSERBASE")).toEqual({
      STAGEHAND_BROWSER: "browserbase",
      STAGEHAND_MODEL_API_KEY: "model-secret",
      BROWSERBASE_PROJECT_ID: "project-id",
    });
  });

  it("is supported by both agent harnesses with tool-owned startup profiles", () => {
    expect(resolveToolSurface(claudeCodeHarness, "stagehand_facade")).toBe("stagehand_facade");
    expect(resolveStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(resolveToolSurface(codexHarness, "stagehand_facade")).toBe("stagehand_facade");
    expect(resolveStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
  });
});
