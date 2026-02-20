import { describe, expect, it } from "vitest";
import {
  UnderstudyCommandException,
  StagehandError,
} from "../lib/v3/types/public/sdkErrors.js";

describe("UnderstudyCommandException", () => {
  it("extends StagehandError", () => {
    const err = new UnderstudyCommandException("test");
    expect(err).toBeInstanceOf(StagehandError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new UnderstudyCommandException("test");
    expect(err.name).toBe("UnderstudyCommandException");
  });

  it("preserves the message", () => {
    const err = new UnderstudyCommandException("something broke");
    expect(err.message).toBe("something broke");
  });

  it("stores the original error as cause when provided", () => {
    const original = new Error("root cause");
    const err = new UnderstudyCommandException("wrapper message", original);

    expect(err.cause).toBe(original);
    expect((err.cause as Error).message).toBe("root cause");
    expect((err.cause as Error).stack).toBeDefined();
  });

  it("stores non-Error cause values", () => {
    const err = new UnderstudyCommandException("failed", "string cause");
    expect(err.cause).toBe("string cause");
  });

  it("has undefined cause when none is provided", () => {
    const err = new UnderstudyCommandException("no cause");
    expect(err.cause).toBeUndefined();
  });

  it("generates its own stack trace", () => {
    const err = new UnderstudyCommandException("test");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("UnderstudyCommandException");
  });

  it("preserves the original stack via cause for debugging", () => {
    function deepFunction() {
      throw new Error("deep error");
    }

    let original: Error;
    try {
      deepFunction();
    } catch (e) {
      original = e as Error;
    }

    const wrapped = new UnderstudyCommandException(original!.message, original);

    // The wrapper has its own stack
    expect(wrapped.stack).toBeDefined();
    // The original stack is accessible via cause
    expect((wrapped.cause as Error).stack).toContain("deepFunction");
  });
});
