import { describe, expect, it } from "vitest";
import { resolveDefaultCoreStartupProfile } from "../../framework/context.js";

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
    expect(resolveDefaultCoreStartupProfile("chrome_devtools_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
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
  });
});
