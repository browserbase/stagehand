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

const zeroUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 0,
};

const disabledCache = { status: "DISABLED" as const };

describe("Stagehand result usage", () => {
  it("defaults omitted counters to zero and validates explicit aggregates", () => {
    expect(StagehandResultUsageSchema.parse({})).toStrictEqual(zeroUsage);
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
    expect(StagehandResultUsageSchema.parse({ inputTokens: 1 })).toStrictEqual({
      ...zeroUsage,
      inputTokens: 1,
    });
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
        metadata: { usage, cache: disabledCache },
      }).metadata.usage,
    ).toStrictEqual(usage);
    expect(
      ObserveResultSchema.parse({
        data: [],
        metadata: { usage, cache: disabledCache },
      }).metadata.usage,
    ).toStrictEqual(usage);
    expect(
      ExtractResultSchema.parse({
        data: { heading: "Example" },
        metadata: { usage, cache: disabledCache },
      }).metadata.usage,
    ).toStrictEqual(usage);
  });

  it("requires a zeroed usage aggregate for operations without inference", () => {
    expect(
      ActResultSchema.safeParse({
        data: {
          success: true,
          message: "Clicked submit",
          actionDescription: "Click submit",
          actions: [],
        },
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      ObserveResultSchema.parse({ data: [], metadata: { usage: {}, cache: disabledCache } })
        .metadata.usage,
    ).toStrictEqual(zeroUsage);
    expect(
      ExtractResultSchema.parse({
        data: { heading: "Cached" },
        metadata: { usage: zeroUsage, cache: disabledCache },
      }).metadata.usage,
    ).toStrictEqual(zeroUsage);
  });
});
