import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  compareStrings,
  exactMatch,
  normalizeString,
  normalizeTechnicalValue,
  passRate,
} from "../../scoring.js";

describe("core scoring", () => {
  it("reports Pass for successful core outputs", () => {
    const result = passRate({
      input: {
        name: "navigation/open",
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      output: { _success: true },
      expected: true,
    });

    expect(result).toEqual({
      name: "Pass",
      score: 1,
    });
  });

  it("keeps Exact match available for bench-style scoring", () => {
    const result = exactMatch({
      input: {
        name: "bench/task",
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      output: { _success: true },
      expected: true,
    });

    expect(result).toEqual({
      name: "Exact match",
      score: 1,
    });
  });
});

describe("task text scoring", () => {
  it.each([
    ["  Hello---WORLD  ", "helloworld"],
    ["A, B", "a, b"],
    ["semi;colon_and-dash", "semicolonanddash"],
    ["", ""],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeString(input)).toBe(expected);
  });

  it("preserves signs in technical values", () => {
    expect(normalizeTechnicalValue("-40°C to +125°C")).toBe("-40°c to +125°c");
  });

  it("normalizes tildes as separators in technical values", () => {
    expect(normalizeTechnicalValue("-40°C~+125°C")).toBe("-40°c +125°c");
    expect(normalizeTechnicalValue("-40°C~(+125°C)")).toBe("-40°c +125°c");
  });

  it("treats the fuzzy-match threshold as inclusive", () => {
    const { similarity } = compareStrings("MARTHA", "MARHTA");

    expect(compareStrings("MARTHA", "MARHTA", similarity).meetsThreshold).toBe(true);
    expect(compareStrings("MARTHA", "MARHTA", similarity + Number.EPSILON).meetsThreshold).toBe(
      false,
    );
  });
});
