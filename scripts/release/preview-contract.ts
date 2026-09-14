import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type PreviewPackageArtifact = {
  package: string;
  version: string;
  file: string;
  sha256: string;
  install: string;
};

export type PreviewExtensionArtifact = Omit<PreviewPackageArtifact, "install">;

export type PreviewManifest = {
  schemaVersion: 1;
  commitSha: string;
  pullRequest: number;
  protocol: {
    package: string;
    version: string;
  };
  artifacts: {
    typescript: PreviewPackageArtifact;
    python: PreviewPackageArtifact;
    extension: PreviewExtensionArtifact;
  };
};

export function typescriptPreviewVersion(baseVersion: string, commitSha: string): string {
  assertStableVersion(baseVersion);
  assertGitSha(commitSha);
  return `${baseVersion}-preview.${commitSha}`;
}

export function pythonPreviewVersion(baseVersion: string, commitSha: string): string {
  assertStableVersion(baseVersion);
  assertGitSha(commitSha);
  return `${baseVersion}.dev0+g${commitSha}`;
}

export function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function parsePreviewManifest(value: unknown): PreviewManifest {
  const manifest = record(value, "preview manifest");
  exactKeys(
    manifest,
    ["schemaVersion", "commitSha", "pullRequest", "protocol", "artifacts"],
    "preview manifest",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Preview manifest schemaVersion must be 1");
  }

  const commitSha = nonemptyString(manifest.commitSha, "commitSha");
  assertGitSha(commitSha);
  if (
    typeof manifest.pullRequest !== "number" ||
    !Number.isSafeInteger(manifest.pullRequest) ||
    manifest.pullRequest <= 0
  ) {
    throw new Error("Preview manifest pullRequest must be a positive integer");
  }

  const protocol = record(manifest.protocol, "protocol");
  exactKeys(protocol, ["package", "version"], "protocol");
  const artifacts = record(manifest.artifacts, "artifacts");
  exactKeys(artifacts, ["typescript", "python", "extension"], "artifacts");

  return {
    schemaVersion: 1,
    commitSha,
    pullRequest: manifest.pullRequest,
    protocol: {
      package: nonemptyString(protocol.package, "protocol.package"),
      version: nonemptyString(protocol.version, "protocol.version"),
    },
    artifacts: {
      typescript: packageArtifact(artifacts.typescript, "artifacts.typescript"),
      python: packageArtifact(artifacts.python, "artifacts.python"),
      extension: extensionArtifact(artifacts.extension, "artifacts.extension"),
    },
  };
}

export async function verifyPreviewBundle(directory: string): Promise<PreviewManifest> {
  const manifestFiles = (await readdir(directory)).filter(
    (file) => file === "stagehand-preview.json",
  );
  if (manifestFiles.length !== 1) {
    throw new Error(`Expected one preview manifest in ${directory}; found ${manifestFiles.length}`);
  }

  const manifest = parsePreviewManifest(
    JSON.parse(await readFile(path.join(directory, manifestFiles[0]!), "utf8")),
  );

  for (const artifact of Object.values(manifest.artifacts)) {
    const contents = await readFile(path.join(directory, artifact.file));
    const actualSha256 = sha256(contents);
    if (actualSha256 !== artifact.sha256) {
      throw new Error(`${artifact.file} has SHA-256 ${actualSha256}; expected ${artifact.sha256}`);
    }
  }

  return manifest;
}

function assertStableVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Expected a stable package version, received: ${version}`);
  }
}

function assertGitSha(value: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`Expected a full 40-character Git SHA, received: ${value}`);
  }
}

function assertAssetFile(file: string): void {
  if (file.length === 0 || path.basename(file) !== file) {
    throw new Error(`Preview asset must be a file name: ${file}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = expected.toSorted();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} has unexpected fields: ${actual.join(", ")}`);
  }
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function bundledArtifact(value: unknown, label: string): PreviewExtensionArtifact {
  const artifact = record(value, label);
  const file = nonemptyString(artifact.file, `${label}.file`);
  assertAssetFile(file);
  const digest = nonemptyString(artifact.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
  return {
    package: nonemptyString(artifact.package, `${label}.package`),
    version: nonemptyString(artifact.version, `${label}.version`),
    file,
    sha256: digest,
  };
}

function extensionArtifact(value: unknown, label: string): PreviewExtensionArtifact {
  const artifact = record(value, label);
  exactKeys(artifact, ["package", "version", "file", "sha256"], label);
  return bundledArtifact(artifact, label);
}

function packageArtifact(value: unknown, label: string): PreviewPackageArtifact {
  const artifact = record(value, label);
  exactKeys(artifact, ["package", "version", "file", "sha256", "install"], label);
  return {
    ...bundledArtifact(artifact, label),
    install: nonemptyString(artifact.install, `${label}.install`),
  };
}
