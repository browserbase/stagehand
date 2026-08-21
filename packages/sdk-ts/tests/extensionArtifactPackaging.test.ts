import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertExtensionArtifactsMatch,
  assertPublicExtensionArtifact,
  unpackedContentSha256,
} from "../extensionArtifactPackaging.js";

const digest = "a".repeat(64);

describe("extension artifact packaging", () => {
  it("accepts public artifact metadata with valid digests", () => {
    expect(
      assertPublicExtensionArtifact({
        residentGatewayConfigured: false,
        sha256: digest,
        unpackedSha256: digest,
      }),
    ).toStrictEqual({
      residentGatewayConfigured: false,
      sha256: digest,
      unpackedSha256: digest,
    });
  });

  it.each([
    null,
    {},
    { residentGatewayConfigured: true, sha256: digest, unpackedSha256: digest },
    { residentGatewayConfigured: false, unpackedSha256: digest },
    { residentGatewayConfigured: false, sha256: digest },
  ])("rejects private or incomplete metadata %#", (metadata) => {
    expect(() => assertPublicExtensionArtifact(metadata)).toThrow(
      "Refusing to package a privately configured resident extension in the SDK",
    );
  });

  it("hashes unpacked files in code-point path order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-extension-digest-"));
    try {
      await mkdir(path.join(directory, "a"));
      const files = [
        ["b.txt", "lower b"],
        ["a/z.txt", "nested z"],
        ["Z.txt", "upper Z"],
      ] as const;
      for (const [relativePath, contents] of files) {
        await writeFile(path.join(directory, relativePath), contents);
      }
      const expected = createHash("sha256");
      for (const [relativePath, contents] of files.toSorted(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )) {
        expected.update(
          `${relativePath}\n${createHash("sha256").update(contents).digest("hex")}\n`,
        );
      }
      await expect(unpackedContentSha256(directory)).resolves.toBe(expected.digest("hex"));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("detects tampered archives and unpacked files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-extension-match-"));
    const unpacked = path.join(directory, "dist");
    const archive = path.join(directory, "extension.zip");
    try {
      await mkdir(unpacked);
      await writeFile(path.join(unpacked, "manifest.json"), "original");
      await writeFile(archive, "archive");
      const metadata = assertPublicExtensionArtifact({
        residentGatewayConfigured: false,
        sha256: createHash("sha256").update("archive").digest("hex"),
        unpackedSha256: await unpackedContentSha256(unpacked),
      });
      await expect(
        assertExtensionArtifactsMatch(metadata, archive, unpacked),
      ).resolves.toBeUndefined();

      await writeFile(path.join(unpacked, "manifest.json"), "tampered");
      await expect(assertExtensionArtifactsMatch(metadata, archive, unpacked)).rejects.toThrow(
        "unpacked digest mismatched",
      );
      await writeFile(path.join(unpacked, "manifest.json"), "original");
      await writeFile(archive, "tampered");
      await expect(assertExtensionArtifactsMatch(metadata, archive, unpacked)).rejects.toThrow(
        "archive digest mismatched",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
