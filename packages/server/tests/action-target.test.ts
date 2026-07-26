import { describe, expect, it } from "vitest";
import {
  actionTargetForSnapshotSelector,
  rebindActionTargetsToSnapshot,
  selectorAndTargetForSnapshotElement,
} from "../actionTarget.js";

describe("actionTarget helpers", () => {
  it("maps document-root selectors to the HTML element identity", () => {
    const xpathMap = {
      "0-1": "/",
      "0-2": "/html[1]",
    };

    expect(selectorAndTargetForSnapshotElement("0-1", xpathMap)).toStrictEqual({
      selector: "xpath=/html[1]",
      target: { frameOrdinal: 0, backendNodeId: 2 },
    });
    expect(actionTargetForSnapshotSelector("xpath=/", xpathMap)).toStrictEqual({
      frameOrdinal: 0,
      backendNodeId: 2,
    });
  });

  it("rebinds cached action targets from the current snapshot", () => {
    expect(
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/button",
            description: "Submit",
            method: "click",
            arguments: [],
            target: { frameOrdinal: 0, backendNodeId: 12 },
          },
        ],
        { "0-99": "/html/body/button" },
      ),
    ).toStrictEqual([
      {
        selector: "xpath=/html/body/button",
        description: "Submit",
        method: "click",
        arguments: [],
        target: { frameOrdinal: 0, backendNodeId: 99 },
      },
    ]);
  });
});
