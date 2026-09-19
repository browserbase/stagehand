import { describe, expect, it } from "vitest";

import { modelAcceptsImages } from "../extensions/model-capabilities.js";

describe("modelAcceptsImages", () => {
  it("accepts models that declare image input", () => {
    expect(modelAcceptsImages({ input: ["text", "image"] })).toBe(true);
    expect(modelAcceptsImages({ input: ["image"] })).toBe(true);
  });

  it("rejects text-only models", () => {
    expect(modelAcceptsImages({ input: ["text"] })).toBe(false);
    expect(modelAcceptsImages({ input: [] })).toBe(false);
  });

  it("returns undefined when the capability is unknown, so callers fail open", () => {
    expect(modelAcceptsImages(undefined)).toBeUndefined();
    expect(modelAcceptsImages({})).toBeUndefined();
    expect(modelAcceptsImages({ input: "image" })).toBeUndefined();
    expect(modelAcceptsImages({ input: null })).toBeUndefined();
  });
});
