import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// A ZIP containing a root manifest.json, independent of SDK build artifacts.
const archiveFixture = Buffer.from(
  "UEsDBBQAAAAAAAAAIQBQrEnpQAAAAEAAAAANAAAAbWFuaWZlc3QuanNvbnsibWFuaWZlc3RfdmVyc2lvbiI6MywibmFtZSI6IlRlc3QgZXh0ZW5zaW9uIiwidmVyc2lvbiI6IjEuMC4wIn1QSwECFAMUAAAAAAAAACEAUKxJ6UAAAABAAAAADQAAAAAAAAAAAAAAgAEAAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAQABADsAAABrAAAAAAA=",
  "base64",
);

describe("getExtensionArchive", () => {
  let directory: string | undefined;
  let getExtensionArchive: typeof import("../src/index.js").getExtensionArchive;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "stagehand-archive-test-"));
    const archivePath = path.join(directory, "extension.zip");
    await writeFile(archivePath, archiveFixture);
    vi.stubEnv("STAGEHAND_EXTENSION_ARCHIVE_PATH", archivePath);
    vi.resetModules();
    ({ getExtensionArchive } = await import("../src/index.js"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("returns the configured ZIP through the public SDK entry point", async () => {
    const archive = await getExtensionArchive();

    expectTypeOf(getExtensionArchive).returns.toEqualTypeOf<Promise<Uint8Array>>();
    expect(archive).toBeInstanceOf(Uint8Array);
    expect(Uint8Array.from(archive)).toEqual(Uint8Array.from(archiveFixture));
  });

  it("returns independent byte arrays so callers cannot corrupt subsequent archives", async () => {
    const original = Uint8Array.from(await getExtensionArchive());
    const modified = await getExtensionArchive();
    modified.fill(0);

    expect(Uint8Array.from(await getExtensionArchive())).toEqual(original);
  });
});
