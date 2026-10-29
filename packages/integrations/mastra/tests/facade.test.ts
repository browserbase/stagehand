import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { MCPClient } from "@mastra/mcp";
import { afterEach, describe, expect, it } from "vitest";

import { facadeMcpServer } from "../src/facade.js";
import { loadMastraSdk, runMastraSession, type MastraSdk } from "../src/index.js";

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

/** Real Mastra MCP client, fake agent that records the tools it was given and finishes at once. */
async function toolsSeenByAgent(toolNames?: "bare" | "namespaced"): Promise<string[]> {
  const real = await loadMastraSdk();
  let tools: Record<string, unknown> | undefined;
  const sdk: MastraSdk = {
    ...real,
    createAgent: (config) => {
      tools = config.tools as Record<string, unknown>;
      return {
        stream: async () => ({
          fullStream: (async function* () {
            yield { type: "finish", payload: { stepResult: { reason: "stop" } } };
          })(),
        }),
      };
    },
  };
  const result = await runMastraSession({
    prompt: "noop",
    model: "gpt-5.4-mini",
    logger: silentLogger,
    sdk,
    session: {
      mcpServers: { stagehand: facadeMcpServer() },
      ...(toolNames && { toolNames }),
    },
  });
  expect(result.status).toBe("completed");
  return Object.keys(tools ?? {}).sort();
}

describe("Stagehand facade MCP server for Mastra", () => {
  let client: MCPClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
    delete process.env.STAGEHAND_BROWSER;
    delete process.env.NOT_ALLOWLISTED_SECRET;
  });

  // The contract itself is pinned by core's facade tests; assert against the
  // exported source of truth instead of restating literals, and cover what is
  // unique to this example — Mastra toolset discovery and the env allowlist.
  it("is discovered by Mastra as the facade toolset", async () => {
    process.env.STAGEHAND_BROWSER = "invalid";
    client = new MCPClient({
      id: "stagehand-facade-mastra-test",
      servers: { stagehand: facadeMcpServer() },
    });

    const { toolsets, errors } = await client.listToolsetsWithErrors();

    expect(errors).toEqual({});
    expect(Object.keys(toolsets)).toEqual(["stagehand"]);

    const tools = toolsets.stagehand;
    expect(tools).toBeDefined();
    if (!tools) throw new Error("stagehand toolset is missing");

    const expectedNames = [...FACADE_TOOLS.map((tool) => tool.name)].sort();
    expect(Object.keys(tools).sort()).toEqual(expectedNames);
    for (const tool of FACADE_TOOLS) {
      expect(tools[tool.name]?.description).toBe(tool.description);
    }
  });

  // The example's path: runMastraSession over the real stdio server. The model
  // must see the bare names FACADE_AGENT_INSTRUCTIONS refers to.
  it("hands the example agent the facade's bare tool names", async () => {
    process.env.STAGEHAND_BROWSER = "invalid";
    const expectedNames = FACADE_TOOLS.map((tool) => tool.name).sort();
    expect(await toolsSeenByAgent("bare")).toEqual(expectedNames);
    expect(await toolsSeenByAgent()).toEqual(
      expectedNames.map((name) => `stagehand_${name}`).sort(),
    );
  });

  it("launches the core stdio server with only allowlisted host vars", () => {
    process.env.STAGEHAND_BROWSER = "local";
    process.env.NOT_ALLOWLISTED_SECRET = "must-not-cross";

    const server = facadeMcpServer({ env: { STAGEHAND_MODEL_NAME: "override" } });

    expect(server.command).toBe(process.execPath);
    expect(server.args).toHaveLength(1);
    expect(server.args?.[0]).toMatch(/stdio-server\.m?js$/);
    expect(server.env?.STAGEHAND_BROWSER).toBe("local");
    expect(server.env?.STAGEHAND_MODEL_NAME).toBe("override");
    expect(server.env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
  });
});
