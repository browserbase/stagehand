import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Python facade bundle", () => {
  it("is the built bundle", async () => {
    const [built, vendored] = await Promise.all([
      fs.readFile(new URL("../dist/facade-bundle.json", import.meta.url), "utf8"),
      fs.readFile(
        new URL("../python/src/stagehand_middleware/facade/_bundle.json", import.meta.url),
        "utf8",
      ),
    ]);
    const withoutVersion = (text: string) =>
      JSON.stringify({ ...JSON.parse(text), packageVersion: 0 });
    expect(
      withoutVersion(vendored) === withoutVersion(built),
      "stale copy; run pnpm run sync:python",
    ).toBe(true);
  });
});
