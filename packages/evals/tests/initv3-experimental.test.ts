import { describe, expect, it } from "vitest";
import { resolveExperimental } from "../initV3.js";

describe("resolveExperimental", () => {
  it("defaults experimental ON for SDK-path runs", () => {
    expect(resolveExperimental(undefined, false)).toBe(true);
  });

  it("forces experimental OFF under API mode, even when requested", () => {
    // Core rejects `experimental` together with API mode, so the API guard
    // wins over both the default and an explicit opt-in.
    expect(resolveExperimental(undefined, true)).toBe(false);
    expect(resolveExperimental(true, true)).toBe(false);
    expect(resolveExperimental(false, true)).toBe(false);
  });

  it("honors an explicit boolean on the SDK path", () => {
    expect(resolveExperimental(true, false)).toBe(true);
    expect(resolveExperimental(false, false)).toBe(false);
  });

  it("reads USE_API from the environment when not passed explicitly", () => {
    const prev = process.env.USE_API;
    try {
      process.env.USE_API = "true";
      expect(resolveExperimental(undefined)).toBe(false);
      process.env.USE_API = "false";
      expect(resolveExperimental(undefined)).toBe(true);
      delete process.env.USE_API;
      expect(resolveExperimental(undefined)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.USE_API;
      else process.env.USE_API = prev;
    }
  });
});
