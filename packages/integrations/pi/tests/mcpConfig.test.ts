import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mcpPath = join(dirname(fileURLToPath(import.meta.url)), "../.pi/mcp.json");

describe("pi project MCP config", () => {
  it("mounts the facade stdio server with direct exposure", () => {
    const config = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<
        string,
        { command?: string; args?: string[]; exposure?: string }
      >;
    };
    const stagehand = config.mcpServers?.stagehand;
    expect(stagehand?.command).toBe("node");
    expect(stagehand?.args).toEqual(["../core/dist/facade/stdio-server.mjs"]);
    expect(stagehand?.exposure).toBe("direct");
  });
});
