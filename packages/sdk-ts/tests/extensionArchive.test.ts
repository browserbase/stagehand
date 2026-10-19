import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import { getExtensionArchive } from "../src/index.js";

describe("getExtensionArchive", () => {
  it("returns the bundled ZIP through the public SDK entry point", async () => {
    const archive = await getExtensionArchive();
    const bundledArchive = await readFile(
      new URL("../dist/assets/stagehand-extension.zip", import.meta.url),
    );

    expectTypeOf(getExtensionArchive).returns.toEqualTypeOf<Promise<Uint8Array>>();
    expect(archive).toBeInstanceOf(Uint8Array);
    expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Uint8Array.from(archive)).toEqual(Uint8Array.from(bundledArchive));
  });

  it("returns independent byte arrays so callers cannot corrupt subsequent archives", async () => {
    const original = await getExtensionArchive();
    const modified = await getExtensionArchive();
    modified.fill(0);

    expect(await getExtensionArchive()).toEqual(original);
  });
});
