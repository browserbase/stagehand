import { describe, expect, it } from "vitest";
import { OPENCODE_SDK_VERSION } from "../src/version.js";

describe("OPENCODE_SDK_VERSION", () => {
  it("reports the resolved @opencode/sdk version", () => {
    expect(OPENCODE_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
