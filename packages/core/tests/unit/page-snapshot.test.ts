import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import { Page } from "../../lib/v3/understudy/page.js";
import * as snapshotModule from "../../lib/v3/understudy/a11y/snapshot/index.js";
import type { HybridSnapshot } from "../../lib/v3/types/private/index.js";

const baseSnapshot: HybridSnapshot = {
  combinedTree: "tree",
  combinedXpathMap: {},
  combinedUrlMap: {},
  perFrame: [],
};

describe("Page.snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the includeIframes flag to captureHybridSnapshot", async () => {
    vi.spyOn(fs, "writeFile").mockResolvedValue();
    const captureSpy = vi
      .spyOn(snapshotModule, "captureHybridSnapshot")
      .mockResolvedValue(baseSnapshot);

    const fakePage = {} as Page;
    await Page.prototype.snapshot.call(fakePage, { includeIframes: false });

    expect(captureSpy).toHaveBeenCalledWith(fakePage, {
      pierceShadow: true,
      includeIframes: false,
      interactive: undefined,
      maxDepth: undefined,
      focusSelector: undefined,
    });
  });

  it("falls back to default iframe inclusion when option is omitted", async () => {
    vi.spyOn(fs, "writeFile").mockResolvedValue();
    const captureSpy = vi
      .spyOn(snapshotModule, "captureHybridSnapshot")
      .mockResolvedValue(baseSnapshot);

    const fakePage = {} as Page;
    await Page.prototype.snapshot.call(fakePage);

    expect(captureSpy).toHaveBeenCalledWith(fakePage, {
      pierceShadow: true,
      includeIframes: undefined,
      interactive: undefined,
      maxDepth: undefined,
      focusSelector: undefined,
    });
  });

  it("forwards snapshot filtering options and drops maps for absent refs", async () => {
    vi.spyOn(fs, "writeFile").mockResolvedValue();
    const captureSpy = vi
      .spyOn(snapshotModule, "captureHybridSnapshot")
      .mockResolvedValue({
        combinedTree: "[keep] button: Save",
        combinedXpathMap: { keep: "/html/body/button", drop: "/html/body/p" },
        combinedUrlMap: {
          keep: "https://example.com/save",
          drop: "https://example.com",
        },
        perFrame: [],
      });

    const fakePage = {} as Page;
    const snapshot = await Page.prototype.snapshot.call(fakePage, {
      interactive: true,
      maxDepth: 3,
      focusSelector: "#app",
    });

    expect(captureSpy).toHaveBeenCalledWith(fakePage, {
      pierceShadow: true,
      includeIframes: undefined,
      interactive: true,
      maxDepth: 3,
      focusSelector: "#app",
    });
    expect(snapshot.xpathMap).toEqual({ keep: "/html/body/button" });
    expect(snapshot.urlMap).toEqual({ keep: "https://example.com/save" });
  });
});
