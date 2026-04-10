import { describe, expect, it } from "vitest";
import { generateExperimentName } from "../../utils.js";

describe("generateExperimentName", () => {
  it("returns evalName when provided", () => {
    expect(
      generateExperimentName({
        evalName: "navigation/open",
        environment: "LOCAL",
        toolSurface: "playwright_code",
        startupProfile: "runner_provided_local_cdp",
      }),
    ).toBe("navigation/open");
  });

  it("returns category when no evalName", () => {
    expect(
      generateExperimentName({
        category: "agent",
        environment: "BROWSERBASE",
      }),
    ).toBe("agent");
  });

  it("returns 'all' when neither evalName nor category", () => {
    expect(
      generateExperimentName({ environment: "LOCAL" }),
    ).toBe("all");
  });
});
