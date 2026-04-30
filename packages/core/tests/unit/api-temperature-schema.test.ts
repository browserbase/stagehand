import { describe, expect, it } from "vitest";
import {
  ModelConfigObjectSchema,
  SessionStartRequestSchema,
} from "../../lib/v3/types/public/api.js";

describe("v3 API temperature schemas", () => {
  it("accepts null or numeric temperature in model config objects", () => {
    expect(
      ModelConfigObjectSchema.safeParse({
        modelName: "openai/gpt-5-mini",
        temperature: null,
      }).success,
    ).toBe(true);
    expect(
      ModelConfigObjectSchema.safeParse({
        modelName: "openai/gpt-4.1-mini",
        temperature: 0.2,
      }).success,
    ).toBe(true);
  });

  it("accepts null or numeric temperature on session start", () => {
    expect(
      SessionStartRequestSchema.safeParse({
        modelName: "openai/gpt-5-mini",
        temperature: null,
      }).success,
    ).toBe(true);
    expect(
      SessionStartRequestSchema.safeParse({
        modelName: "openai/gpt-4.1-mini",
        temperature: 0.2,
      }).success,
    ).toBe(true);
  });
});
