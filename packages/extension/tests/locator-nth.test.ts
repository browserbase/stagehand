import { describe, expect, it } from "vitest";
import { DeepLocatorDelegate } from "../understudy/deepLocator.js";
import { Locator } from "../understudy/locator.js";

/**
 * Regression tests for negative nth() indices (Playwright compatibility).
 * The Locator/DeepLocatorDelegate constructors are safe to build without a
 * live frame for these tests: they only touch selector parsing, and the
 * count-from-end resolution is exercised through resolveActionIndex().
 */
describe("Locator.nth negative indices", () => {
  it("accepts nth(-1) instead of throwing", () => {
    const loc = new Locator(null as never, "/html/body/div");
    expect(() => loc.nth(-1)).not.toThrow();
  });

  it("marks nth(-1) as explicit negative narrowing and leaves the default untouched", () => {
    const loc = new Locator(null as never, "/html/body/div");
    const last = loc.nth(-1);
    expect(last.hasExplicitNth).toBe(true);
    expect(last.nthIndex).toBe(-1);
    expect(loc.hasExplicitNth).toBe(false);
    expect(loc.nthIndex).toBe(-1);
  });

  it("keeps non-negative nth() semantics", () => {
    const loc = new Locator(null as never, "/html/body/div");
    const second = loc.nth(1);
    expect(second.hasExplicitNth).toBe(true);
    expect(second.nthIndex).toBe(1);
  });

  it("still rejects non-finite indices", () => {
    const loc = new Locator(null as never, "/html/body/div");
    expect(() => loc.nth(Number.NaN)).toThrow(RangeError);
    expect(() => loc.nth(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("DeepLocatorDelegate.nth negative indices", () => {
  it("accepts nth(-1) instead of throwing", () => {
    const d = new DeepLocatorDelegate(null as never, null as never, "//li");
    expect(() => d.nth(-1)).not.toThrow();
  });

  it("preserves the explicit last-match flag and the default sentinel", () => {
    const d = new DeepLocatorDelegate(null as never, null as never, "//li");
    const last = d.nth(-1);
    expect(last.hasExplicitNth).toBe(true);
    expect(last.nthIndex).toBe(-1);
    expect(d.hasExplicitNth).toBe(false);
    expect(d.nthIndex).toBe(-1);
  });

  it("returns this when narrowing to the same explicit index", () => {
    const d = new DeepLocatorDelegate(null as never, null as never, "//li");
    const last = d.nth(-1);
    expect(last.nth(-1)).toBe(last);
    const second = d.nth(2);
    expect(second.nth(2)).toBe(second);
  });

  it("keeps the default delegate narrowing-free for masking operations", () => {
    const d = new DeepLocatorDelegate(null as never, null as never, "//li");
    expect(d.hasExplicitNth).toBe(false);
    expect(d.first().hasExplicitNth).toBe(true);
  });
});
