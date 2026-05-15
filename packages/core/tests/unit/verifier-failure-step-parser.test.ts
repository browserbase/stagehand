import { describe, expect, it } from "vitest";

import { parseFailureStepNumbers } from "../../lib/v3/verifier/prompts/firstPointOfFailure.js";

describe("parseFailureStepNumbers", () => {
  it("parses singleton, range, and comma-separated step references", () => {
    expect(parseFailureStepNumbers("5,7-9,12")).toEqual([5, 7, 8, 9, 12]);
  });

  it("caps expanded ranges from malformed model output", () => {
    const steps = parseFailureStepNumbers("0-2147483647");

    expect(steps).toHaveLength(1000);
    expect(steps[0]).toBe(0);
    expect(steps[999]).toBe(999);
  });

  it("honors the caller's trajectory step bound", () => {
    expect(
      parseFailureStepNumbers("0-2147483647", {
        maxExpandedSteps: 1000,
        maxStep: 3,
      }),
    ).toEqual([0, 1, 2, 3]);
  });
});
