import { describe, expect, it } from "vitest";
import { resolveRunOptions } from "../../tui/commands/parse.js";

describe("resolveRunOptions", () => {
  it("defaults verbose to false", () => {
    const resolved = resolveRunOptions({}, {}, {});
    expect(resolved.verbose).toBe(false);
  });

  it("respects verbose from config defaults", () => {
    const resolved = resolveRunOptions({}, { verbose: true }, {});
    expect(resolved.verbose).toBe(true);
  });
});
