import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { afterEach, describe, expect, it } from "vitest";

import { createFacadeMCPClient } from "../src/client.js";

type FacadeClient = ReturnType<typeof createFacadeMCPClient>;

describe("Stagehand facade MCP client", () => {
  let client: FacadeClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
    delete process.env.STAGEHAND_BROWSER;
    delete process.env.NOT_ALLOWLISTED_SECRET;
  });

  // The contract itself is pinned by core's facade tests; assert against the
  // exported source of truth instead of restating literals, and cover what is
  // unique to this example — Mastra toolset discovery and the env allowlist.
  it("discovers the facade toolset through the host-env allowlist", async () => {
    process.env.STAGEHAND_BROWSER = "invalid";
    client = createFacadeMCPClient();

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

  it("allowlist excludes non-STAGEHAND/BROWSERBASE host vars", () => {
    process.env.STAGEHAND_BROWSER = "local";
    process.env.NOT_ALLOWLISTED_SECRET = "must-not-cross";
    const env = buildAllowlistedEnv();
    expect(env.STAGEHAND_BROWSER).toBe("local");
    expect(env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
  });
});
