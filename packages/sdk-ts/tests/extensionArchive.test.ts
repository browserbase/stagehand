import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getExtensionArchive } from "../src/index.js";

describe("getExtensionArchive", () => {
  it("returns the bundled ZIP through the public SDK entry point", async () => {
    const archive = await getExtensionArchive();
    const bundledArchive = await readFile(
      new URL("../dist/assets/stagehand-extension.zip", import.meta.url),
    );

    expect(Buffer.isBuffer(archive)).toBe(true);
    expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(archive).toEqual(bundledArchive);
  });

  it("returns independent buffers so callers cannot corrupt subsequent archives", async () => {
    const original = await getExtensionArchive();
    const modified = await getExtensionArchive();
    modified.fill(0);

    expect(await getExtensionArchive()).toEqual(original);
  });
});
