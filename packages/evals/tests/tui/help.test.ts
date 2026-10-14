import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { printRunHelp } from "../../tui/commands/help.js";
import { stripAnsi } from "../../tui/format.js";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
afterEach(() => logSpy.mockClear());

// The harness registry is imported lazily by the code under test; its first
// cold import can take seconds when the whole suite runs in parallel.
beforeAll(async () => {
  await import("../../framework/benchHarness.js");
}, 60_000);

describe("printRunHelp", () => {
  it("lists per-harness tool surfaces with the default starred and names the facade", async () => {
    await printRunHelp();
    const text = logSpy.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(text).toContain("Tool surface the harness mounts (default marked *)");
    expect(text).toMatch(/claude_code: browse_cli\*.*stagehand_facade/);
    expect(text).toMatch(/codex: browse_cli\*.*stagehand_facade/);
    expect(text).toContain("stagehand_facade — Playwright-batch MCP surface (agent mount only)");
    expect(text).toContain(
      "Suites: webvoyager, onlineMind2Web, webtailbench, hardbenchmark, odysseysbench",
    );
    expect(text).toContain("-v, --verbose");
    expect(text).toContain("--follow <id>");
    expect(text).toMatch(/esc stop · v logs off → all → one · \? help/);
    // stagehand mounts nothing and gets no row.
    expect(text).not.toMatch(/\n\s+stagehand:/);
  });
});
