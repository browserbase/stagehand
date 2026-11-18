import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fingerprintFiles, readDirectoryFiles } from "../../extension/buildFingerprint.ts";

describe("getExtensionFingerprint", () => {
  let directory: string | undefined;

  async function readerWithBuildFile(contents?: string) {
    directory = await mkdtemp(path.join(tmpdir(), "stagehand-build-info-test-"));
    const buildInfo = path.join(directory, "extension-build.json");
    if (contents !== undefined) await writeFile(buildInfo, contents);
    vi.stubEnv("STAGEHAND_EXTENSION_BUILD_INFO_PATH", buildInfo);
    vi.resetModules();
    return (await import("../src/extensionAssets.js")).getExtensionFingerprint;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("matches the extension packaged with the SDK", async () => {
    const { getExtensionFingerprint } = await import("../src/extensionAssets.js");
    const packaged = fingerprintFiles(
      await readDirectoryFiles(fileURLToPath(new URL("../dist/extension/", import.meta.url))),
    );

    expect(await getExtensionFingerprint()).toBe(packaged);
  });

  it("reads the build file named by STAGEHAND_EXTENSION_BUILD_INFO_PATH", async () => {
    const read = await readerWithBuildFile(JSON.stringify({ fingerprint: "a".repeat(64) }));
    expect(await read()).toBe("a".repeat(64));
  });

  it.each([
    "",
    "null",
    "[]",
    '{"fingerprint":1}',
    ...["", "a".repeat(63), "A".repeat(64), "g".repeat(64)].map((fingerprint) =>
      JSON.stringify({ fingerprint }),
    ),
  ])("rejects a malformed build file (%j)", async (contents) => {
    const read = await readerWithBuildFile(contents);
    await expect(read()).rejects.toThrow("does not contain an extension fingerprint");
  });

  it("rejects a missing build file", async () => {
    const read = await readerWithBuildFile();
    await expect(read()).rejects.toThrow("Stagehand extension build file could not be read at");
  });
});
