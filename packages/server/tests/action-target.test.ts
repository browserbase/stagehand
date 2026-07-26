import { describe, expect, it } from "vitest";
import {
  actionTargetForSnapshotSelector,
  rebindActionTargetsToSnapshot,
  selectorAndTargetForSnapshotElement,
} from "../actionTarget.js";
import { CachedActionRebindError } from "../errors.js";

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

  it("rebinds drag-and-drop destination argumentTargets from the current snapshot", () => {
    expect(
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/ul/li[1]",
            description: "Drag source onto target",
            method: "dragAndDrop",
            arguments: ["xpath=/html/body/ul/li[2]"],
            target: { frameOrdinal: 0, backendNodeId: 12 },
            argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
          },
        ],
        {
          "0-30": "/html/body/ul/li[1]",
          "0-31": "/html/body/ul/li[2]",
        },
      ),
    ).toStrictEqual([
      {
        selector: "xpath=/html/body/ul/li[1]",
        description: "Drag source onto target",
        method: "dragAndDrop",
        arguments: ["xpath=/html/body/ul/li[2]"],
        target: { frameOrdinal: 0, backendNodeId: 30 },
        argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 31 } },
      },
    ]);
  });

  it("throws a sanitized error when a drag destination no longer resolves", () => {
    expect(() =>
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/ul/li[1]",
            description: "Drag source onto target",
            method: "dragAndDrop",
            arguments: ["xpath=/html/body/ul/li[2]"],
            target: { frameOrdinal: 0, backendNodeId: 12 },
            argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
          },
        ],
        { "0-30": "/html/body/ul/li[1]" },
      ),
    ).toThrow(CachedActionRebindError);

    try {
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/ul/li[1]",
            description: "Drag source onto target",
            method: "dragAndDrop",
            arguments: ["xpath=/html/body/missing"],
            target: { frameOrdinal: 0, backendNodeId: 12 },
          },
        ],
        { "0-30": "/html/body/ul/li[1]" },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CachedActionRebindError);
      expect((error as Error).message).not.toContain("xpath=");
      expect((error as CachedActionRebindError).kind).toBe("argument");
    }
  });

  it("throws a sanitized error when the primary selector no longer resolves", () => {
    expect(() =>
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/gone",
            description: "Missing",
            method: "click",
            arguments: [],
          },
        ],
        { "0-30": "/html/body/ul/li[1]" },
      ),
    ).toThrow(CachedActionRebindError);

    try {
      rebindActionTargetsToSnapshot(
        [
          {
            selector: "xpath=/html/body/gone",
            description: "Missing",
            method: "click",
            arguments: [],
          },
        ],
        { "0-30": "/html/body/ul/li[1]" },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CachedActionRebindError);
      expect((error as Error).message).not.toContain("xpath=");
      expect((error as CachedActionRebindError).kind).toBe("selector");
    }
  });
});
