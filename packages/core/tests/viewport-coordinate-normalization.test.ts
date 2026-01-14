import { describe, expect, it } from "vitest";
import {
  normalizeGoogleCoordinates,
  processCoordinates,
  isGoogleProvider,
} from "../lib/v3/agent/utils/coordinateNormalization";

/**
 * BUG-015 Regression Test: Hardcoded Viewport in Hybrid Mode Coordinate Normalization
 *
 * This test verifies that coordinate normalization for Google providers correctly
 * uses the actual viewport dimensions instead of a hardcoded 1288x711 default.
 *
 * Bug location: /packages/core/lib/v3/agent/utils/coordinateNormalization.ts
 *
 * Without the fix:
 * - normalizeGoogleCoordinates() uses hardcoded DEFAULT_VIEWPORT (1288x711)
 * - Custom viewports are ignored
 * - Clicks land at wrong coordinates when viewport differs from default
 *
 * With the fix:
 * - normalizeGoogleCoordinates() accepts optional viewport parameter
 * - processCoordinates() passes viewport to normalization
 * - Coordinates are correctly mapped to actual viewport dimensions
 *
 * Example of the bug:
 * - Google returns (500, 500) meaning "center of screen"
 * - With 1920x1080 viewport:
 *   - BUG: Code calculates (644, 355) using hardcoded 1288x711
 *   - FIXED: Code calculates (960, 540) using actual viewport
 *   - Result: Click misses target by 316px horizontal, 185px vertical
 */

describe("Viewport coordinate normalization (BUG-015)", () => {
  describe("isGoogleProvider", () => {
    it("returns true for Google providers", () => {
      expect(isGoogleProvider("google/gemini-2.0-flash")).toBe(true);
      expect(isGoogleProvider("google/gemini-pro")).toBe(true);
      expect(isGoogleProvider("GOOGLE/GEMINI")).toBe(true);
    });

    it("returns false for non-Google providers", () => {
      expect(isGoogleProvider("anthropic/claude-3")).toBe(false);
      expect(isGoogleProvider("openai/gpt-4")).toBe(false);
      expect(isGoogleProvider(undefined)).toBe(false);
      expect(isGoogleProvider("")).toBe(false);
    });
  });

  describe("normalizeGoogleCoordinates", () => {
    it("uses default viewport (1288x711) when no viewport provided", () => {
      // Google returns 0-1000 range, so (500, 500) = center
      const result = normalizeGoogleCoordinates(500, 500);

      // With default 1288x711: center = (644, 355)
      expect(result.x).toBe(644);
      expect(result.y).toBe(355);
    });

    it("uses provided viewport dimensions for coordinate calculation", () => {
      // Google returns 0-1000 range, so (500, 500) = center
      const viewport = { width: 1920, height: 1080 };
      const result = normalizeGoogleCoordinates(500, 500, viewport);

      // With 1920x1080: center = (960, 540)
      expect(result.x).toBe(960);
      expect(result.y).toBe(540);
    });

    it("correctly calculates coordinates for custom viewport - BUG-015 regression", () => {
      // This is the core regression test for BUG-015
      // Before fix: would return (644, 355) regardless of viewport
      // After fix: correctly returns (960, 540) for 1920x1080

      const viewport = { width: 1920, height: 1080 };
      const result = normalizeGoogleCoordinates(500, 500, viewport);

      // CRITICAL: These assertions would FAIL on the buggy code
      // The buggy code returns (644, 355) instead of (960, 540)
      expect(result.x).not.toBe(644); // Would be 644 with hardcoded viewport
      expect(result.y).not.toBe(355); // Would be 355 with hardcoded viewport

      // Expected correct values
      expect(result.x).toBe(960);
      expect(result.y).toBe(540);
    });

    it("handles corner coordinates with custom viewport", () => {
      const viewport = { width: 1920, height: 1080 };

      // Top-left (0, 0)
      const topLeft = normalizeGoogleCoordinates(0, 0, viewport);
      expect(topLeft.x).toBe(0);
      expect(topLeft.y).toBe(0);

      // Bottom-right (999, 999) - max value in Google's 0-999 range
      const bottomRight = normalizeGoogleCoordinates(999, 999, viewport);
      // 999/1000 * 1920 = 1918.08 -> floor = 1918
      // 999/1000 * 1080 = 1078.92 -> floor = 1078
      expect(bottomRight.x).toBe(1918);
      expect(bottomRight.y).toBe(1078);
    });

    it("clamps out-of-range coordinates", () => {
      const viewport = { width: 1920, height: 1080 };

      // Values > 999 should be clamped to 999
      const overRange = normalizeGoogleCoordinates(1500, 2000, viewport);
      expect(overRange.x).toBe(1918); // 999/1000 * 1920
      expect(overRange.y).toBe(1078); // 999/1000 * 1080

      // Negative values should be clamped to 0
      const underRange = normalizeGoogleCoordinates(-100, -50, viewport);
      expect(underRange.x).toBe(0);
      expect(underRange.y).toBe(0);
    });

    it("handles small viewports", () => {
      const smallViewport = { width: 800, height: 600 };
      const result = normalizeGoogleCoordinates(500, 500, smallViewport);

      // Center of 800x600 = (400, 300)
      expect(result.x).toBe(400);
      expect(result.y).toBe(300);
    });
  });

  describe("processCoordinates", () => {
    it("normalizes coordinates for Google provider with viewport", () => {
      const viewport = { width: 1920, height: 1080 };
      const result = processCoordinates(500, 500, "google/gemini-2.0-flash", viewport);

      expect(result.x).toBe(960);
      expect(result.y).toBe(540);
    });

    it("passes through coordinates for non-Google providers", () => {
      const viewport = { width: 1920, height: 1080 };

      // Non-Google providers return absolute coordinates, no transformation
      const anthropicResult = processCoordinates(500, 500, "anthropic/claude-3", viewport);
      expect(anthropicResult.x).toBe(500);
      expect(anthropicResult.y).toBe(500);

      const openaiResult = processCoordinates(800, 600, "openai/gpt-4", viewport);
      expect(openaiResult.x).toBe(800);
      expect(openaiResult.y).toBe(600);
    });

    it("passes through coordinates when no provider specified", () => {
      const viewport = { width: 1920, height: 1080 };
      const result = processCoordinates(500, 500, undefined, viewport);

      expect(result.x).toBe(500);
      expect(result.y).toBe(500);
    });

    it("uses default viewport for Google provider when viewport not provided", () => {
      // Backward compatibility - uses DEFAULT_VIEWPORT (1288x711)
      const result = processCoordinates(500, 500, "google/gemini-2.0-flash");

      expect(result.x).toBe(644);
      expect(result.y).toBe(355);
    });
  });

  describe("BUG-015 specific scenarios", () => {
    it("demonstrates click offset bug when using wrong viewport", () => {
      // This demonstrates the exact bug scenario from MASTER_BUG_REPORT.md
      //
      // User sets viewport to 1920x1080, Google returns (500, 500) for center button
      //
      // BUG (hardcoded 1288x711):
      //   - Calculated: (644, 355)
      //   - Actual center: (960, 540)
      //   - Miss by: 316px horizontal, 185px vertical
      //
      // FIX (using actual viewport):
      //   - Calculated: (960, 540)
      //   - Actual center: (960, 540)
      //   - Perfect hit

      const actualViewport = { width: 1920, height: 1080 };
      const hardcodedViewport = { width: 1288, height: 711 };

      const withBug = normalizeGoogleCoordinates(500, 500, hardcodedViewport);
      const withFix = normalizeGoogleCoordinates(500, 500, actualViewport);

      // Calculate expected miss distance
      const horizontalMiss = Math.abs(withFix.x - withBug.x);
      const verticalMiss = Math.abs(withFix.y - withBug.y);

      // The bug causes a significant miss
      expect(horizontalMiss).toBe(316); // 960 - 644 = 316
      expect(verticalMiss).toBe(185); // 540 - 355 = 185

      // With the fix applied (using actual viewport), coordinates are correct
      expect(withFix.x).toBe(960);
      expect(withFix.y).toBe(540);
    });

    it("works correctly with default viewport (no change in behavior)", () => {
      // When using default 1288x711 viewport, behavior should be unchanged
      const defaultViewport = { width: 1288, height: 711 };

      const withoutViewportArg = normalizeGoogleCoordinates(500, 500);
      const withDefaultViewport = normalizeGoogleCoordinates(500, 500, defaultViewport);

      expect(withoutViewportArg.x).toBe(withDefaultViewport.x);
      expect(withoutViewportArg.y).toBe(withDefaultViewport.y);
    });
  });
});
