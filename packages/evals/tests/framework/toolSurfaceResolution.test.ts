import { describe, expect, it } from "vitest";
import type { StartupProfile, ToolSurface } from "../../core/contracts/tool.js";
import { claudeCodeHarness, stagehandHarness } from "../../framework/benchHarness.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

describe("tool surface resolution", () => {
  it("passes requested surfaces through for harnesses without mounted surfaces", () => {
    expect(resolveToolSurface(stagehandHarness)).toBeUndefined();
    expect(resolveToolSurface(stagehandHarness, "understudy_code")).toBe("understudy_code");
  });

  it("defaults to the first supported surface and accepts supported requests", () => {
    expect(resolveToolSurface(claudeCodeHarness)).toBe("browse_cli");
    expect(resolveToolSurface(claudeCodeHarness, "cdp_code")).toBe("cdp_code");
  });

  it("rejects unsupported surfaces with the full supported list", () => {
    expect(() => resolveToolSurface(claudeCodeHarness, "understudy_code")).toThrow(
      /Harness "claude_code" supports --tool browse_cli, playwright_code, cdp_code, stagehand_code, playwright_mcp, chrome_devtools_mcp, or stagehand_facade; received "understudy_code"/,
    );
  });
});

describe("startup profile resolution", () => {
  const toolOwned: ToolSurface[] = ["browse_cli", "stagehand_code", "stagehand_facade"];
  const runnerProvided: ToolSurface[] = [
    "understudy_code",
    "playwright_code",
    "cdp_code",
    "playwright_mcp",
    "chrome_devtools_mcp",
  ];

  it.each(toolOwned)("uses tool-owned profiles for %s", (toolSurface) => {
    expect(resolveStartupProfile(toolSurface, "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile(toolSurface, "BROWSERBASE")).toBe("tool_create_browserbase");
  });

  it.each(runnerProvided)("uses runner-provided profiles for %s", (toolSurface) => {
    expect(resolveStartupProfile(toolSurface, "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveStartupProfile(toolSurface, "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("honors an explicitly requested profile first", () => {
    const requested: StartupProfile = "tool_attach_browserbase";
    expect(resolveStartupProfile("browse_cli", "LOCAL", requested)).toBe(requested);
  });
});
