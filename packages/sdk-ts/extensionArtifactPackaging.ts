import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type PublicExtensionArtifactMetadata = {
  residentGatewayConfigured: false;
  sha256: string;
  unpackedSha256: string;
};

const sha256Pattern = /^[0-9a-f]{64}$/u;

export function assertPublicExtensionArtifact(metadata: unknown): PublicExtensionArtifactMetadata {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("residentGatewayConfigured" in metadata) ||
    metadata.residentGatewayConfigured !== false ||
    !("sha256" in metadata) ||
    typeof metadata.sha256 !== "string" ||
    !sha256Pattern.test(metadata.sha256) ||
    !("unpackedSha256" in metadata) ||
    typeof metadata.unpackedSha256 !== "string" ||
    !sha256Pattern.test(metadata.unpackedSha256)
  ) {
    throw new Error("Refusing to package a privately configured resident extension in the SDK");
  }
  return metadata as PublicExtensionArtifactMetadata;
}

export async function unpackedContentSha256(directory: string): Promise<string> {
  const files = await readRegularFiles(directory);
  const digest = createHash("sha256");
  for (const relativePath of Object.keys(files).sort(compareCodePoints)) {
    const fileDigest = createHash("sha256").update(files[relativePath]!).digest("hex");
    digest.update(`${relativePath}\n${fileDigest}\n`);
  }
  return digest.digest("hex");
}

export async function assertExtensionArtifactsMatch(
  metadata: PublicExtensionArtifactMetadata,
  archivePath: string,
  unpackedDirectory: string,
): Promise<void> {
  const archiveDigest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  if (archiveDigest !== metadata.sha256) {
    throw new Error(
      "Stagehand extension artifacts do not match their metadata; rebuild the extension (archive digest mismatched)",
    );
  }
  if ((await unpackedContentSha256(unpackedDirectory)) !== metadata.unpackedSha256) {
    throw new Error(
      "Stagehand extension artifacts do not match their metadata; rebuild the extension (unpacked digest mismatched)",
    );
  }
}

async function readRegularFiles(
  directory: string,
  relativeDirectory = "",
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Stagehand extension cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      Object.assign(files, await readRegularFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files[relativePath.split(path.sep).join("/")] = await readFile(
        path.join(directory, relativePath),
      );
    } else {
      throw new Error(`Stagehand extension contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

// UTF-8 byte order equals Unicode code point order, matching Python's `sorted()` in build.py.
function compareCodePoints(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
