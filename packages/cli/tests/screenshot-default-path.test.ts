import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDefaultPathFromFlags,
  removeIfEmpty,
  reserveDefaultScreenshotPath,
} from "../src/commands/screenshot.js";

/**
 * Coverage for the default screenshot path behavior added in #2246 (browse
 * screenshot now writes a file by default with a collision counter, cleaning up
 * the reserved placeholder on failure). The command shipped without tests.
 */
describe("browse screenshot default-path handling", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), "browse-screenshot-"));
    process.chdir(tmp);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("getDefaultPathFromFlags", () => {
    it("returns undefined when --path is set (driver writes the explicit file)", () => {
      expect(getDefaultPathFromFlags({ path: "out.png" })).toBeUndefined();
    });

    it("returns undefined when --base64 is set (nothing written to disk)", () => {
      expect(getDefaultPathFromFlags({ base64: true })).toBeUndefined();
    });

    it("reserves a default .png path for a bare invocation", () => {
      const reserved = getDefaultPathFromFlags({});
      expect(reserved).toMatch(/screenshot-\d{8}-\d{6}\.png$/);
      // The path is reserved by creating an empty placeholder.
      expect(existsSync(reserved as string)).toBe(true);
    });

    it("uses the .jpeg extension when --type jpeg", () => {
      const reserved = getDefaultPathFromFlags({ type: "jpeg" });
      expect(reserved).toMatch(/screenshot-\d{8}-\d{6}\.jpeg$/);
    });
  });

  describe("reserveDefaultScreenshotPath", () => {
    it("advances the collision counter instead of overwriting an existing file", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 1, 15, 30, 45)); // 2026-07-01 15:30:45 local

      const first = reserveDefaultScreenshotPath(undefined);
      const second = reserveDefaultScreenshotPath(undefined);

      expect(first).toMatch(/screenshot-20260701-153045\.png$/);
      expect(second).toMatch(/screenshot-20260701-153045-2\.png$/);
      expect(first).not.toBe(second);
      expect(existsSync(first)).toBe(true);
      expect(existsSync(second)).toBe(true);
    });
  });

  describe("removeIfEmpty", () => {
    it("removes a zero-byte placeholder left by a failed capture", () => {
      const path = join(tmp, "placeholder.png");
      closeSync(openSync(path, "w")); // 0 bytes
      removeIfEmpty(path);
      expect(existsSync(path)).toBe(false);
    });

    it("keeps a file that already has bytes (a real screenshot)", () => {
      const path = join(tmp, "real.png");
      writeFileSync(path, "not empty");
      removeIfEmpty(path);
      expect(existsSync(path)).toBe(true);
    });

    it("does not throw when the path is already gone", () => {
      expect(() => removeIfEmpty(join(tmp, "missing.png"))).not.toThrow();
    });
  });
});
