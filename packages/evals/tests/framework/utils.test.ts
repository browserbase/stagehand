import { afterEach, describe, expect, it } from "vitest";
import { generateExperimentName, logLineToString } from "../../utils.js";

const originalColumns = process.stdout.columns;

afterEach(() => {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: originalColumns,
  });
});

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

  it("clips long log lines to terminal width", () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 60,
    });

    const output = logLineToString({
      category: "observation",
      message: "found elements",
      timestamp: "2026-04-19T04:03:59.369Z",
      auxiliary: {
        elements: {
          type: "object",
          value: JSON.stringify({
            selector:
              "xpath=/html/body/div/div/div/div/div/div/div/div/div/div/div/div/div/input",
          }),
        },
      },
    });

    expect(output.split("\n").every((line) => line.length <= 59)).toBe(true);
    expect(output.endsWith("…")).toBe(true);
  });
});
