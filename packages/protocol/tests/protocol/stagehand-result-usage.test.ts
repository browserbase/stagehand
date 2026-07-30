import { describe, expect, it } from "vitest";
import {
  ActResultSchema,
  ExtractResultSchema,
  ObserveResultSchema,
  StagehandResultUsageSchema,
} from "../../schemas.js";

const usage = {
  inputTokens: 120,
  outputTokens: 30,
  reasoningTokens: 8,
  cachedInputTokens: 40,
  inferenceTimeMs: 275,
};

describe("Stagehand result usage", () => {
  it("validates one complete nonnegative aggregate without totalTokens", () => {
    expect(StagehandResultUsageSchema.parse(usage)).toStrictEqual(usage);
    expect(
      StagehandResultUsageSchema.safeParse({
        ...usage,
        totalTokens: usage.inputTokens + usage.outputTokens,
      }).success,
    ).toBe(false);
    expect(
      StagehandResultUsageSchema.safeParse({
        ...usage,
        reasoningTokens: -1,
      }).success,
    ).toBe(false);
    expect(
      StagehandResultUsageSchema.safeParse({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
      }).success,
    ).toBe(false);
  });

  it("makes the aggregate available to act, observe, and extract results", () => {
    expect(
      ActResultSchema.parse({
        data: {
          success: true,
          message: "Clicked submit",
          actionDescription: "Click submit",
          actions: [],
        },
        metadata: { usage },
      }).metadata.usage,
    ).toStrictEqual(usage);
    expect(
      ObserveResultSchema.parse({
        data: [],
        metadata: { usage },
      }).metadata.usage,
    ).toStrictEqual(usage);
    expect(
      ExtractResultSchema.parse({
        data: { heading: "Example" },
        metadata: { usage },
      }).metadata.usage,
    ).toStrictEqual(usage);
  });

  it("allows operations that did not run inference to omit usage", () => {
    expect(
      ActResultSchema.parse({
        data: {
          success: true,
          message: "Clicked submit",
          actionDescription: "Click submit",
          actions: [],
        },
        metadata: {},
      }).metadata.usage,
    ).toBeUndefined();
    expect(ObserveResultSchema.parse({ data: [], metadata: {} }).metadata.usage).toBeUndefined();
    expect(
      ExtractResultSchema.parse({ data: { heading: "Cached" }, metadata: {} }).metadata.usage,
    ).toBeUndefined();
  });
});
