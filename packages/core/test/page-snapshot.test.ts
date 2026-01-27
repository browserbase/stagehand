import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import { Page } from "../lib/v3/understudy/page";
import * as snapshotModule from "../lib/v3/understudy/a11y/snapshot";
import type { HybridSnapshot } from "../lib/v3/types/private";

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
    });
  });
});
