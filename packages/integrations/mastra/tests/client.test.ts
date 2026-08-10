import { afterEach, describe, expect, it } from "vitest";

import { createFacadeMCPClient } from "../src/client.js";

type FacadeClient = ReturnType<typeof createFacadeMCPClient>;

describe("Stagehand facade MCP client", () => {
  let client: FacadeClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
  });

  it("lists the facade tools without initializing a browser", async () => {
    client = createFacadeMCPClient({
      env: { STAGEHAND_BROWSER: "invalid" },
    });

    const { toolsets, errors } = await client.listToolsetsWithErrors();

    expect(errors).toEqual({});
    expect(Object.keys(toolsets)).toEqual(["stagehand"]);

    const tools = toolsets.stagehand;
    expect(tools).toBeDefined();
    if (!tools) throw new Error("stagehand toolset is missing");

    expect(Object.keys(tools).sort()).toEqual(["run", "screenshot", "snapshot"]);
    expect(tools.run?.description).toContain('never "kind"');
  });
});
