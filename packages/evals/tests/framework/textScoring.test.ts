import { describe, expect, it } from "vitest";
import {
  compareStrings as compareCanonicalStrings,
  normalizeString as normalizeCanonicalString,
} from "../../framework/textScoring.js";
import {
  compareStrings as compareReferenceStrings,
  normalizeString as normalizeReferenceString,
} from "../../utils.js";

describe("text scoring", () => {
  it.each([
    ["  Hello---WORLD  ", "helloworld"],
    ["A, B", "a, b"],
    ["semi;colon_and-dash", "semicolonanddash"],
    ["", ""],
  ])("normalizes %j identically to the reference helper", (input, expected) => {
    expect(normalizeCanonicalString(input)).toBe(expected);
    expect(normalizeCanonicalString(input)).toBe(normalizeReferenceString(input));
  });

  it.each([
    ["MARTHA", "MARHTA"],
    ["DWAYNE", "DUANE"],
    ["same prefix value", "same prefix values"],
    ["", ""],
    ["", "nonempty"],
  ])("matches the reference Jaro-Winkler result for %j and %j", (actual, expected) => {
    const canonical = compareCanonicalStrings(actual, expected);
    const reference = compareReferenceStrings(actual, expected);

    expect(canonical.similarity).toBeCloseTo(reference.similarity, 12);
    expect(canonical.meetsThreshold).toBe(reference.meetsThreshold);
  });

  it("treats the threshold boundary as inclusive", () => {
    const { similarity } = compareCanonicalStrings("MARTHA", "MARHTA");

    expect(compareCanonicalStrings("MARTHA", "MARHTA", similarity).meetsThreshold).toBe(true);
    expect(
      compareCanonicalStrings("MARTHA", "MARHTA", similarity + Number.EPSILON).meetsThreshold,
    ).toBe(false);
  });
});
