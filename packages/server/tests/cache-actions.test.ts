import { describe, expect, it } from "vitest";
import { normalizeCachedActions } from "../services/cacheService.js";

describe("normalizeCachedActions", () => {
  it("preserves observed target identities when present", () => {
    expect(
      normalizeCachedActions([
        {
          selector: "xpath=/html/body/button",
          description: "Submit",
          method: "click",
          arguments: [],
          target: { frameOrdinal: 0, backendNodeId: 12 },
          argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
        },
      ]),
    ).toStrictEqual([
      {
        selector: "xpath=/html/body/button",
        description: "Submit",
        method: "click",
        arguments: [],
        target: { frameOrdinal: 0, backendNodeId: 12 },
        argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
      },
    ]);
  });

  it("drops malformed target metadata without rejecting the action", () => {
    expect(
      normalizeCachedActions([
        {
          selector: "xpath=/html/body/button",
          description: "Submit",
          method: "click",
          arguments: [],
          target: { frameOrdinal: -1, backendNodeId: 0 },
          argumentTargets: { destination: { frameOrdinal: 0, backendNodeId: 20 } },
        },
      ]),
    ).toStrictEqual([
      {
        selector: "xpath=/html/body/button",
        description: "Submit",
        method: "click",
        arguments: [],
      },
    ]);
  });
});
