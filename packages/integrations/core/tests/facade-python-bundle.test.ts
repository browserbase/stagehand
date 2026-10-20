import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

// The Python package ships a copy of the bundle; refresh it with
// `pnpm run sync:python` after building.
describe("Python facade bundle", () => {
  it("is the built bundle", async () => {
    const [built, vendored] = await Promise.all([
      fs.readFile(new URL("../dist/facade-bundle.json", import.meta.url), "utf8"),
      fs.readFile(
        new URL("../python/src/stagehand_integrations/facade/_bundle.json", import.meta.url),
        "utf8",
      ),
    ]);
    // Not toBe(built): a diff of two 250 KB strings would bury the fix.
    expect(vendored === built, "stale copy; run pnpm run sync:python").toBe(true);
  });
});
