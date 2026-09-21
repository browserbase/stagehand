import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowseCliSessionName } from "../browseCliPaths.js";

describe("Browse CLI session names", () => {
  afterEach(() => vi.restoreAllMocks());

  it("includes the PID and stays short with socket-safe characters", () => {
    const name = createBrowseCliSessionName();

    expect(name).toMatch(new RegExp(`^eval-${process.pid}-[A-Za-z0-9_-]+$`));
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(32);
  });

  it("keeps repeated calls distinct at the same timestamp without Math.random entropy", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const names = Array.from({ length: 1_000 }, () => createBrowseCliSessionName());

    expect(new Set(names).size).toBe(names.length);
  });
});
