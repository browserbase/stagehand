import { describe, expect, it } from "vitest";
import { normalizePydanticAiMcpServers } from "../../framework/pydanticAiToolAdapter.js";
describe("Pydantic AI tool adapter helpers", () => {
  it("normalizes valid MCP server configs", () => {
    expect(
      normalizePydanticAiMcpServers({
        stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
        emptyArgs: { command: "python" },
      }),
    ).toEqual({
      stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
      emptyArgs: { command: "python", args: [] },
    });
  });

  it("rejects MCP servers without commands", () => {
    expect(() => normalizePydanticAiMcpServers({ broken: { args: [] } })).toThrow(
      /server "broken".*command/,
    );
  });
  it("rejects arrays where MCP objects or environment maps are required", () => {
    expect(() => normalizePydanticAiMcpServers({ broken: [] })).toThrow(/must be an object/);
    expect(() => normalizePydanticAiMcpServers({ broken: { command: "node", env: [] } })).toThrow(
      /env must be a string map/,
    );
  });
});
