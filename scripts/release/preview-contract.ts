import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type PreviewPackageArtifact = {
  package: string;
  version: string;
  file: string;
  url: string;
  sha256: string;
  install: string;
};

export type PreviewExtensionArtifact = Omit<PreviewPackageArtifact, "install">;

export type PreviewManifest = {
  schemaVersion: 1;
  repository: string;
  commitSha: string;
  pullRequest: number;
  tag: string;
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

export function previewTag(pullRequest: number, commitSha: string): string {
  if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
    throw new Error(`Invalid pull request number: ${pullRequest}`);
  }
  assertGitSha(commitSha);
  return `preview-pr-${pullRequest}-${commitSha}`;
}

export function releaseAssetUrl(repository: string, tag: string, file: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  assertAssetFile(file);
  return `https://github.com/${repository}/releases/download/${tag}/${file}`;
}

export function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function parsePreviewManifest(value: unknown): PreviewManifest {
  const manifest = record(value, "preview manifest");
  exactKeys(
    manifest,
    ["schemaVersion", "repository", "commitSha", "pullRequest", "tag", "protocol", "artifacts"],
    "preview manifest",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Preview manifest schemaVersion must be 1");
  }

  const repository = nonemptyString(manifest.repository, "repository");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
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
    repository,
    commitSha,
    pullRequest: manifest.pullRequest,
    tag: nonemptyString(manifest.tag, "tag"),
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
    (file) => file.startsWith("stagehand-preview-") && file.endsWith(".json"),
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

    const urlFile = decodeURIComponent(new URL(artifact.url).pathname.split("/").at(-1) ?? "");
    if (urlFile !== artifact.file) {
      throw new Error(`${artifact.file} does not match its download URL: ${artifact.url}`);
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

function downloadArtifact(value: unknown, label: string): PreviewExtensionArtifact {
  const artifact = record(value, label);
  const file = nonemptyString(artifact.file, `${label}.file`);
  assertAssetFile(file);
  const url = nonemptyString(artifact.url, `${label}.url`);
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(`${label}.url must use HTTPS`);
  }
  const digest = nonemptyString(artifact.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
  return {
    package: nonemptyString(artifact.package, `${label}.package`),
    version: nonemptyString(artifact.version, `${label}.version`),
    file,
    url,
    sha256: digest,
  };
}

function extensionArtifact(value: unknown, label: string): PreviewExtensionArtifact {
  const artifact = record(value, label);
  exactKeys(artifact, ["package", "version", "file", "url", "sha256"], label);
  return downloadArtifact(artifact, label);
}

function packageArtifact(value: unknown, label: string): PreviewPackageArtifact {
  const artifact = record(value, label);
  exactKeys(artifact, ["package", "version", "file", "url", "sha256", "install"], label);
  return {
    ...downloadArtifact(artifact, label),
    install: nonemptyString(artifact.install, `${label}.install`),
  };
}
