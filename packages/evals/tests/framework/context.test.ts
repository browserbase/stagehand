import { describe, expect, it } from "vitest";
import { resolveDefaultCoreStartupProfile } from "../../framework/context.js";
import { prepareCoreBrowserTarget } from "../../core/targets/index.js";

describe("resolveDefaultCoreStartupProfile", () => {
  it("uses runner-provided local CDP for code surfaces in LOCAL", () => {
    expect(resolveDefaultCoreStartupProfile("understudy_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("playwright_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("cdp_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDefaultCoreStartupProfile("playwright_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(
      resolveDefaultCoreStartupProfile("chrome_devtools_mcp", "LOCAL"),
    ).toBe("runner_provided_local_cdp");
  });

  it("uses tool launch for browse_cli in LOCAL", () => {
    expect(resolveDefaultCoreStartupProfile("browse_cli", "LOCAL")).toBe(
      "tool_launch_local",
    );
  });

  it("uses runner-provided Browserbase CDP for code surfaces in BROWSERBASE", () => {
    expect(
      resolveDefaultCoreStartupProfile("understudy_code", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
    expect(
      resolveDefaultCoreStartupProfile("playwright_code", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
    expect(resolveDefaultCoreStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(
      resolveDefaultCoreStartupProfile("playwright_mcp", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
    expect(
      resolveDefaultCoreStartupProfile("chrome_devtools_mcp", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
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
