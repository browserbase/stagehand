import { describe, expect, it } from "vitest";
import * as canonicalScoring from "../../framework/textScoring.js";
import * as referenceScoring from "../../utils.js";

describe("text scoring", () => {
  it.each([
    ["  Hello---WORLD  ", "helloworld"],
    ["A, B", "a, b"],
    ["semi;colon_and-dash", "semicolonanddash"],
    ["", ""],
  ])("normalizes %j identically to the reference helper", (input, expected) => {
    expect(canonicalScoring.normalizeString(input)).toBe(expected);
    expect(canonicalScoring.normalizeString(input)).toBe(referenceScoring.normalizeString(input));
  });

  it.each([
    ["MARTHA", "MARHTA"],
    ["DWAYNE", "DUANE"],
    ["same prefix value", "same prefix values"],
    ["", ""],
    ["", "nonempty"],
  ])("matches the reference Jaro-Winkler result for %j and %j", (actual, expected) => {
    const canonical = canonicalScoring.compareStrings(actual, expected);
    const reference = referenceScoring.compareStrings(actual, expected);

    expect(canonical.similarity).toBeCloseTo(reference.similarity, 12);
    expect(canonical.meetsThreshold).toBe(reference.meetsThreshold);
  });

  it("treats the threshold boundary as inclusive", () => {
    const { similarity } = canonicalScoring.compareStrings("MARTHA", "MARHTA");

    expect(canonicalScoring.compareStrings("MARTHA", "MARHTA", similarity).meetsThreshold).toBe(
      true,
    );
    expect(
      canonicalScoring.compareStrings("MARTHA", "MARHTA", similarity + Number.EPSILON)
        .meetsThreshold,
    ).toBe(false);
  });
});
