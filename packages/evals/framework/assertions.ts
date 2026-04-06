/**
 * Assertion helpers for core tier (deterministic) tasks.
 *
 * All assertions throw an AssertionError on failure, which the
 * framework catches and converts to a failed task result.
 */

import type { AssertHelpers } from "./types.js";
import { deepStrictEqual } from "node:assert";

export class AssertionError extends Error {
  actual: unknown;
  expected: unknown;

  constructor(message: string, actual?: unknown, expected?: unknown) {
    super(message);
    this.name = "AssertionError";
    this.actual = actual;
    this.expected = expected;
  }
}

export function createAssertHelpers(): AssertHelpers {
  return {
    equals(actual: unknown, expected: unknown, message?: string): void {
      try {
        deepStrictEqual(actual, expected);
      } catch {
        throw new AssertionError(
          message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          actual,
          expected,
        );
      }
    },

    matches(actual: string, pattern: RegExp, message?: string): void {
      if (!pattern.test(actual)) {
        throw new AssertionError(
          message ?? `Expected "${actual}" to match ${pattern}`,
          actual,
          pattern,
        );
      }
    },

    includes(haystack: string, needle: string, message?: string): void {
      if (!haystack.includes(needle)) {
        throw new AssertionError(
          message ?? `Expected "${haystack}" to include "${needle}"`,
          haystack,
          needle,
        );
      }
    },

    truthy(value: unknown, message?: string): void {
      if (!value) {
        throw new AssertionError(
          message ?? `Expected truthy value, got ${JSON.stringify(value)}`,
          value,
          true,
        );
      }
    },

    falsy(value: unknown, message?: string): void {
      if (value) {
        throw new AssertionError(
          message ?? `Expected falsy value, got ${JSON.stringify(value)}`,
          value,
          false,
        );
      }
    },

    lessThan(actual: number, expected: number, message?: string): void {
      if (actual >= expected) {
        throw new AssertionError(
          message ?? `Expected ${actual} < ${expected}`,
          actual,
          expected,
        );
      }
    },

    greaterThan(actual: number, expected: number, message?: string): void {
      if (actual <= expected) {
        throw new AssertionError(
          message ?? `Expected ${actual} > ${expected}`,
          actual,
          expected,
        );
      }
    },
  };
}
