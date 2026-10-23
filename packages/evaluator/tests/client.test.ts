import { expect, test } from "vitest";
import { resolveCallAttempts } from "../src/client.js";

test("judge call attempts reject non-finite and non-positive values", () => {
  expect(resolveCallAttempts(undefined)).toBe(2);
  expect(resolveCallAttempts("3")).toBe(3);
  expect(resolveCallAttempts("Infinity")).toBe(2);
  expect(resolveCallAttempts("0")).toBe(2);
  expect(resolveCallAttempts("abc")).toBe(2);
});
