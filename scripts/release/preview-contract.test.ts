import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePreviewManifest,
  pythonPreviewVersion,
  sha256,
  typescriptPreviewVersion,
  verifyPreviewBundle,
} from "./preview-contract.ts";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

describe("preview artifact contract", () => {
  it("derives preview identities from stable package versions and a full commit SHA", () => {
    expect(typescriptPreviewVersion("4.0.0", commitSha)).toBe(`4.0.0-preview.${commitSha}`);
    expect(pythonPreviewVersion("4.0.0", commitSha)).toBe(`4.0.0.dev0+g${commitSha}`);
  });

  it("rejects versions and commit identities that are not stable inputs", () => {
    expect(() => typescriptPreviewVersion("4.0.0-beta.1", commitSha)).toThrow(
      "Expected a stable package version",
    );
    expect(() => pythonPreviewVersion("4.0", commitSha)).toThrow(
      "Expected a stable package version",
    );
  });

  it("verifies every artifact against the manifest checksum", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-preview-contract-"));
    const files = {
      "stagehand-typescript.tgz": new TextEncoder().encode("typescript"),
      "stagehand-python.whl": new TextEncoder().encode("python"),
      "stagehand-extension.zip": new TextEncoder().encode("extension"),
    };

    try {
      for (const [file, contents] of Object.entries(files)) {
        await writeFile(path.join(directory, file), contents);
      }

      const manifest = parsePreviewManifest({
        schemaVersion: 1,
        commitSha,
        pullRequest: 123,
        protocol: {
          package: "@browserbasehq/stagehand-protocol",
          version: "1.0.0",
        },
        artifacts: {
          typescript: {
            package: "@browserbasehq/stagehand",
            version: typescriptPreviewVersion("4.0.0", commitSha),
            file: "stagehand-typescript.tgz",
            sha256: sha256(files["stagehand-typescript.tgz"]),
            install: "pnpm add ./stagehand-typescript.tgz",
          },
          python: {
            package: "stagehand",
            version: pythonPreviewVersion("4.0.0", commitSha),
            file: "stagehand-python.whl",
            sha256: sha256(files["stagehand-python.whl"]),
            install: "uv add ./stagehand-python.whl",
          },
          extension: {
            package: "@browserbasehq/stagehand-server",
            version: "4.0.0",
            file: "stagehand-extension.zip",
            sha256: sha256(files["stagehand-extension.zip"]),
          },
        },
      });
      await writeFile(
        path.join(directory, "stagehand-preview.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      await expect(verifyPreviewBundle(directory)).resolves.toStrictEqual(manifest);

      await writeFile(path.join(directory, "stagehand-extension.zip"), "changed");
      await expect(verifyPreviewBundle(directory)).rejects.toThrow(
        "stagehand-extension.zip has SHA-256",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
