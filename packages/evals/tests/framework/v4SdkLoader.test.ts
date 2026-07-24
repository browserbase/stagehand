import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STAGEHAND_V4_SDK_PATH_ENV,
  loadV4Sdk,
  resolveV4SdkPath,
} from "../../v4SdkLoader.js";
import { getRepoRootDir } from "../../runtimePaths.js";

/** A real file that exists in every checkout — the linked SDK's entry. */
const REAL_SDK_ENTRY = path.join(
  getRepoRootDir(),
  "v4-spike",
  "packages",
  "sdk-ts",
  "src",
  "index.ts",
);

describe("resolveV4SdkPath", () => {
  it("returns undefined when the env var is unset or blank", () => {
    expect(resolveV4SdkPath({})).toBeUndefined();
    expect(
      resolveV4SdkPath({ [STAGEHAND_V4_SDK_PATH_ENV]: "  " }),
    ).toBeUndefined();
  });

  it("resolves a real entry file", () => {
    expect(
      resolveV4SdkPath({ [STAGEHAND_V4_SDK_PATH_ENV]: REAL_SDK_ENTRY }),
    ).toBe(REAL_SDK_ENTRY);
  });

  it("throws loudly on a missing path instead of silently falling back", () => {
    expect(() =>
      resolveV4SdkPath({
        [STAGEHAND_V4_SDK_PATH_ENV]: "/definitely/not/a/real/sdk.ts",
      }),
    ).toThrow(/does not point to a file/);
  });

  it("throws on a directory (must be the entry file)", () => {
    expect(() =>
      resolveV4SdkPath({
        [STAGEHAND_V4_SDK_PATH_ENV]: path.dirname(REAL_SDK_ENTRY),
      }),
    ).toThrow(/does not point to a file/);
  });
});

describe("loadV4Sdk", () => {
  it("throws naming the env var when unset (no package fallback)", async () => {
    await expect(loadV4Sdk(async () => ({}), {})).rejects.toThrow(
      /STAGEHAND_V4_SDK_PATH is required/,
    );
  });

  it("imports the configured entry file as a file:// URL when set", async () => {
    const seen: string[] = [];
    await loadV4Sdk(
      async (specifier) => {
        seen.push(specifier);
        return { Stagehand: class {} };
      },
      { [STAGEHAND_V4_SDK_PATH_ENV]: REAL_SDK_ENTRY },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^file:\/\//);
    expect(seen[0]).toContain("v4-spike/packages/sdk-ts/src/index.ts");
  });

  it("returns the imported module verbatim", async () => {
    const fake = { Stagehand: class {}, marker: 42 };
    const loaded = await loadV4Sdk(async () => fake, {
      [STAGEHAND_V4_SDK_PATH_ENV]: REAL_SDK_ENTRY,
    });
    expect(loaded).toBe(fake);
  });
});
