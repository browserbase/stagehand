import { describe, expect, it } from "vitest";
import type { FrameContext, FrameDomMaps } from "../lib/v3/types/private";
import type { Page } from "../lib/v3/understudy/page";
import { MockCDPSession } from "./helpers/mockCDPSession";
import {
  computeFramePrefixes,
  mergeFramesIntoSnapshot,
} from "../lib/v3/understudy/a11y/snapshot/capture";

const makePage = (sessions: Record<string, MockCDPSession>): Page =>
  ({
    getSessionForFrame: (frameId: string) => sessions[frameId] ?? sessions.root,
    getOrdinal: (frameId: string) =>
      frameId === "frame-1" ? 0 : frameId === "frame-2" ? 1 : 2,
  }) as unknown as Page;

describe("computeFramePrefixes", () => {
  it("derives prefixes from parent iframe xpaths within the same session", async () => {
    const parentSession = new MockCDPSession({
      "DOM.getFrameOwner": async () => ({ backendNodeId: 200 }),
    });
    const page = makePage({
      "frame-1": parentSession,
      "frame-2": parentSession,
      root: parentSession,
    });

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: { "0-200": "/html[1]/body[1]/iframe[1]" },
        },
      ],
    ]);

    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };

    const { absPrefix, iframeHostEncByChild } = await computeFramePrefixes(
      page,
      context,
      perFrameMaps,
    );

    expect(absPrefix.get("frame-1")).toBe("");
    expect(absPrefix.get("frame-2")).toBe("/html[1]/body[1]/iframe[1]");
    expect(iframeHostEncByChild.get("frame-2")).toBe("0-200");
  });

  it("inherits the parent prefix when frame owner lookups fail (OOPIF)", async () => {
    const parentSession = new MockCDPSession({
      "DOM.getFrameOwner": async (params) => {
        if (params?.frameId === "frame-2") return { backendNodeId: 200 };
        if (params?.frameId === "frame-3") throw new Error("unavailable");
        return {};
      },
    });
    const page = makePage({
      "frame-1": parentSession,
      "frame-2": parentSession,
      "frame-3": parentSession,
      root: parentSession,
    });

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: { "0-200": "/iframe[1]" },
        },
      ],
      [
        "frame-2",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: { "1-300": "/div[1]/iframe[1]" },
        },
      ],
    ]);

    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2", "frame-3"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
        ["frame-3", "frame-2"],
      ]),
    };

    const maps = await computeFramePrefixes(page, context, perFrameMaps);

    expect(maps.absPrefix.get("frame-2")).toBe("/iframe[1]");
    expect(maps.absPrefix.get("frame-3")).toBe("/iframe[1]");
  });

  it("inherits parent prefix when iframe xpath mapping is missing", async () => {
    const session = new MockCDPSession({
      "DOM.getFrameOwner": async () => ({ backendNodeId: 999 }),
    });
    const page = makePage({
      "frame-1": session,
      "frame-2": session,
      root: session,
    });

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: {},
        },
      ],
    ]);

    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };

    const result = await computeFramePrefixes(
      page,
      context,
      perFrameMaps as Map<string, FrameDomMaps>,
    );
    expect(result.absPrefix.get("frame-2")).toBe("");
  });
});

describe("mergeFramesIntoSnapshot", () => {
  it("merges root and child maps, prefixing child xpaths and injecting subtrees", () => {
    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: { "0-10": "https://example.com" },
          xpathMap: { "0-10": "/html[1]/body[1]" },
        },
      ],
      [
        "frame-2",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: { "1-20": "https://child.com" },
          xpathMap: { "1-20": "/div[1]/span[1]" },
        },
      ],
    ]);

    const perFrameOutlines = [
      { frameId: "frame-1", outline: "[0-10] body\n  [0-200] iframe" },
      { frameId: "frame-2", outline: "[1-20] child" },
    ];

    const absPrefix = new Map<string, string>([
      ["frame-1", ""],
      ["frame-2", "/html[1]/body[1]/iframe[1]"],
    ]);
    const iframeHostEncByChild = new Map<string, string>([
      ["frame-2", "0-200"],
    ]);

    const snapshot = mergeFramesIntoSnapshot(
      context,
      perFrameMaps,
      perFrameOutlines,
      absPrefix,
      iframeHostEncByChild,
    );

    expect(snapshot.combinedXpathMap["0-10"]).toBe("/html[1]/body[1]");
    expect(snapshot.combinedXpathMap["1-20"]).toBe(
      "/html[1]/body[1]/iframe[1]/div[1]/span[1]",
    );
    expect(snapshot.combinedUrlMap["1-20"]).toBe("https://child.com");
    expect(snapshot.combinedTree).toContain("[1-20] child");
  });

  it("skips frames without maps and handles missing iframe mappings", () => {
    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: { "0-10": "/html[1]" },
        },
      ],
    ]);

    const perFrameOutlines = [
      { frameId: "frame-1", outline: "[0-10] html" },
      { frameId: "frame-2", outline: "[1-20] orphan" },
    ];

    const absPrefix = new Map<string, string>([
      ["frame-1", ""],
      ["frame-2", "/missing"],
    ]);

    const snapshot = mergeFramesIntoSnapshot(
      context,
      perFrameMaps,
      perFrameOutlines,
      absPrefix,
      new Map(),
    );

    expect(snapshot.combinedXpathMap["1-20"]).toBeUndefined();
    expect(snapshot.combinedTree).toBe("[0-10] html");
  });

  it("falls back to first outline when root frame outline is missing", () => {
    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
      ]),
    };

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-2",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: {},
        },
      ],
    ]);

    const perFrameOutlines = [
      { frameId: "frame-2", outline: "[child] frame2" },
    ];

    const snapshot = mergeFramesIntoSnapshot(
      context,
      perFrameMaps,
      perFrameOutlines,
      new Map([["frame-2", "/iframe[1]"]]),
      new Map(),
    );

    expect(snapshot.combinedTree).toBe("[child] frame2");
  });

  it("overwrites duplicate iframe host entries when multiple children map to the same parent", () => {
    const context: FrameContext = {
      rootId: "frame-1",
      frames: ["frame-1", "frame-2", "frame-3"],
      parentByFrame: new Map([
        ["frame-1", null],
        ["frame-2", "frame-1"],
        ["frame-3", "frame-1"],
      ]),
    };

    const perFrameMaps = new Map<string, FrameDomMaps>([
      [
        "frame-1",
        {
          tagNameMap: {},
          scrollableMap: {},
          urlMap: {},
          xpathMap: {},
        },
      ],
    ]);

    const perFrameOutlines = [
      { frameId: "frame-1", outline: "[root] frame1\n  [0-200] iframe slot" },
      { frameId: "frame-2", outline: "[child] frame2" },
      { frameId: "frame-3", outline: "[child] frame3" },
    ];

    const snapshot = mergeFramesIntoSnapshot(
      context,
      perFrameMaps,
      perFrameOutlines,
      new Map([
        ["frame-1", ""],
        ["frame-2", ""],
        ["frame-3", ""],
      ]),
      new Map([
        ["frame-2", "0-200"],
        ["frame-3", "0-200"],
      ]),
    );

    expect(snapshot.combinedTree).toContain("[child] frame3");
    expect(snapshot.combinedTree).not.toContain("[child] frame2");
  });
});
