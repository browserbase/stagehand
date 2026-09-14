import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  rejectAgentMountOnlyCoreTool,
  resolveDefaultCoreStartupProfile,
} from "../../framework/context.js";
import { prepareCoreBrowserTarget } from "../../core/targets/index.js";
import {
  formatBenchHarnessFlags,
  listBenchHarnessesForToolSurface,
  registerBenchHarness,
} from "../../framework/benchHarness.js";

describe("resolveDefaultCoreStartupProfile", () => {
  it("rejects agent-mount-only surfaces", () => {
    expect(() => resolveDefaultCoreStartupProfile("stagehand_facade", "LOCAL")).toThrow(
      /available only as an agent harness mount/,
    );
    expect(() => rejectAgentMountOnlyCoreTool("stagehand_facade")).toThrow(
      formatBenchHarnessFlags(listBenchHarnessesForToolSurface("stagehand_facade")),
    );
  });

  it("derives agent-mount guidance from the harness registry", () => {
    const unregister = registerBenchHarness({
      harness: "context_facade_harness",
      supportedTaskKinds: ["suite"],
      supportsApi: false,
      supportedToolSurfaces: ["stagehand_facade"],
      defaultModels: ["openai/x" as AvailableModel],
      execute: async () => ({ _success: true }),
    });

    try {
      const guidance = formatBenchHarnessFlags(
        listBenchHarnessesForToolSurface("stagehand_facade"),
      );
      expect(guidance).toContain("--harness context_facade_harness");
      expect(() => rejectAgentMountOnlyCoreTool("stagehand_facade")).toThrow(guidance);
    } finally {
      unregister();
    }
  });

  it("uses runner-provided local CDP for code surfaces in LOCAL", () => {
    expect(resolveDefaultCoreStartupProfile("understudy_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("playwright_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("cdp_code", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveDefaultCoreStartupProfile("playwright_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("chrome_devtools_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("stagehand_code", "LOCAL")).toBe("tool_launch_local");
  });

  it("uses tool launch for browse_cli in LOCAL", () => {
    expect(resolveDefaultCoreStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
  });

  it("uses runner-provided Browserbase CDP for code surfaces in BROWSERBASE", () => {
    expect(resolveDefaultCoreStartupProfile("understudy_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("playwright_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("playwright_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("stagehand_code", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
  });

  it("uses native Browserbase creation for browse_cli in BROWSERBASE", () => {
    expect(resolveDefaultCoreStartupProfile("browse_cli", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
  });

  it("rejects runner-provided local CDP in Browserbase environment", async () => {
    await expect(
      prepareCoreBrowserTarget({
        environment: "BROWSERBASE",
        toolSurface: "understudy_code",
        startupProfile: "runner_provided_local_cdp",
      }),
    ).rejects.toThrow(/requires LOCAL environment/);
  });

  it("rejects runner-provided Browserbase CDP in local environment", async () => {
    await expect(
      prepareCoreBrowserTarget({
        environment: "LOCAL",
        toolSurface: "understudy_code",
        startupProfile: "runner_provided_browserbase_cdp",
      }),
    ).rejects.toThrow(/requires BROWSERBASE environment/);
  });
});
