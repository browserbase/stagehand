import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { MCPClient } from "@mastra/mcp";
import { afterEach, describe, expect, it } from "vitest";

import { facadeMcpServer } from "../src/facade.js";

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
