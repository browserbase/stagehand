import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fxDirectory = new URL("../../fx/", import.meta.url);

describe("fx integration", () => {
  it("runs the facade with a screenshot response-frame budget", async () => {
    const config = JSON.parse(await readFile(new URL("mcp.json", fxDirectory), "utf8"));
    expect(config.mcp.stagehand.command).toContain("--max-screenshot-base64-bytes=60000");
  });

  it("provides deterministic tool discovery and navigation guidance", async () => {
    const instructions = await readFile(new URL("AGENTS.md", fxDirectory), "utf8");
    expect(instructions).toContain("`mcp_stagehand_run`");
    expect(instructions).toContain("`mcp_stagehand_snapshot`");
    expect(instructions).toContain("`mcp_stagehand_screenshot`");
    expect(instructions).toContain("There is no separate Stagehand `navigate` or `start` tool");
    expect(instructions).toContain('await page.goto("https://example.com")');
    expect(instructions).toContain('{"type":"jpeg","quality":40,"fullPage":false}');
  });
});
