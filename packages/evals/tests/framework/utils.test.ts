import { afterEach, describe, expect, it, vi } from "vitest";
import { generateExperimentName } from "../../utils.js";

describe("generateExperimentName", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes core comparison dimensions in snake-case names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T23:47:00-07:00"));

    expect(
      generateExperimentName({
        evalName: "navigation/open",
        environment: "LOCAL",
        toolSurface: "playwright_code",
        startupProfile: "runner_provided_local_cdp",
      }),
    ).toBe(
      "navigation_open_local_playwright_code_runner_provided_local_cdp_apr07_2347",
    );
  });

  it("keeps bench names compact when no core dimensions are present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T23:47:00-07:00"));

    expect(
      generateExperimentName({
        category: "agent",
        environment: "BROWSERBASE",
      }),
    ).toBe("agent_browserbase_apr07_2347");
  });
});
