import { describe, expect, it } from "vitest";
import { buildPublicApiShape } from "./publicApiManifest";

export function runExportSurfaceSuite<
  M extends Record<string, unknown>,
  D,
>(
  label: string,
  moduleExports: M,
  defaultExport: D,
): void {
  describe(label, () => {
    const publicApiShape = buildPublicApiShape(moduleExports, defaultExport);

    type PublicAPI = {
      [K in keyof typeof publicApiShape]: K extends "default"
        ? D
        : M[K];
    };

    it("public API shape matches module exports", () => {
      const _check: PublicAPI = publicApiShape;
      void _check;
    });

    it("does not expose unexpected top-level exports", () => {
      const expected = Object.keys(publicApiShape).sort();
      const actual = Object.keys(moduleExports)
        // Node injects __esModule / module.exports on ESM/CJS interop; ignore them.
        .filter((key) => key !== "__esModule" && key !== "module.exports")
        .sort();
      expect(actual).toStrictEqual(expected);
    });
  });
}
