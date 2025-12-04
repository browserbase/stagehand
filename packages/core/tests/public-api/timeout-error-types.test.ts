import { describe, expect, it } from "vitest";
import * as Stagehand from "../../dist";

// ============================================================================
// Public Timeout Error Types Runtime Tests
// ============================================================================
// These tests verify the runtime behavior of exported timeout error types,
// complementing the type-level tests in public-error-types.test.ts

describe("Public timeout error types runtime behavior", () => {
  describe("ActTimeoutError", () => {
    it("is exported and extends Error", () => {
      const error = new Stagehand.ActTimeoutError(1000);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(Stagehand.ActTimeoutError);
      expect(error.name).toBe("ActTimeoutError");
    });

    it("contains timeout value in milliseconds in message", () => {
      const error = new Stagehand.ActTimeoutError(500);
      expect(error.message).toContain("500ms");
    });

    it("contains operation name in message", () => {
      const error = new Stagehand.ActTimeoutError(100);
      expect(error.message).toContain("act()");
    });

    it("extends TimeoutError", () => {
      const error = new Stagehand.ActTimeoutError(1000);
      expect(error).toBeInstanceOf(Stagehand.TimeoutError);
    });
  });

  describe("ExtractTimeoutError", () => {
    it("is exported and extends Error", () => {
      const error = new Stagehand.ExtractTimeoutError(1000);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(Stagehand.ExtractTimeoutError);
      expect(error.name).toBe("ExtractTimeoutError");
    });

    it("contains timeout value in milliseconds in message", () => {
      const error = new Stagehand.ExtractTimeoutError(1000);
      expect(error.message).toContain("1000ms");
    });

    it("contains operation name in message", () => {
      const error = new Stagehand.ExtractTimeoutError(100);
      expect(error.message).toContain("extract()");
    });

    it("extends TimeoutError", () => {
      const error = new Stagehand.ExtractTimeoutError(1000);
      expect(error).toBeInstanceOf(Stagehand.TimeoutError);
    });
  });

  describe("ObserveTimeoutError", () => {
    it("is exported and extends Error", () => {
      const error = new Stagehand.ObserveTimeoutError(1000);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(Stagehand.ObserveTimeoutError);
      expect(error.name).toBe("ObserveTimeoutError");
    });

    it("contains timeout value in milliseconds in message", () => {
      const error = new Stagehand.ObserveTimeoutError(1500);
      expect(error.message).toContain("1500ms");
    });

    it("contains operation name in message", () => {
      const error = new Stagehand.ObserveTimeoutError(100);
      expect(error.message).toContain("observe()");
    });

    it("extends TimeoutError", () => {
      const error = new Stagehand.ObserveTimeoutError(1000);
      expect(error).toBeInstanceOf(Stagehand.TimeoutError);
    });
  });

  describe("TimeoutError (base class)", () => {
    it("is exported and extends Error", () => {
      const error = new Stagehand.TimeoutError("custom operation", 2000);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(Stagehand.TimeoutError);
    });

    it("contains operation name and timeout in message", () => {
      const error = new Stagehand.TimeoutError("custom operation", 2000);
      expect(error.message).toContain("custom operation");
      expect(error.message).toContain("2000ms");
    });

    it("extends StagehandError", () => {
      const error = new Stagehand.TimeoutError("operation", 1000);
      expect(error).toBeInstanceOf(Stagehand.StagehandError);
    });
  });
});
