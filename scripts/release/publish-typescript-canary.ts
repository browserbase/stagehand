import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commit = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (commit === undefined || !/^[0-9a-f]{7,40}$/i.test(commit)) {
  throw new Error("Pass the release commit SHA as the first argument");
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const sdkDirectory = path.join(repositoryRoot, "packages/sdk-ts");
const manifestPath = path.join(sdkDirectory, "package.json");
const originalManifest = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(originalManifest) as {
  name?: unknown;
  version?: unknown;
};
if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
  throw new TypeError("TypeScript package manifest must define a name and version");
}

const canaryVersion = `${manifest.version}-alpha-${commit.slice(0, 7)}`;
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(canaryVersion)}`;
const registryResponse = await fetch(registryUrl);
if (registryResponse.ok) {
  process.stdout.write(`${manifest.name}@${canaryVersion} is already published\n`);
  process.exit(0);
}
if (registryResponse.status !== 404) {
  throw new Error(
    `npm returned ${registryResponse.status} while checking ${manifest.name}@${canaryVersion}`,
  );
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "stagehand-canary-"));
const tarballPath = path.join(temporaryDirectory, "stagehand-canary.tgz");
try {
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, version: canaryVersion }, null, 2)}\n`,
  );
  const { stdout, stderr } = await execFileAsync("vp", ["pm", "pack", "--out", tarballPath], {
    cwd: sdkDirectory,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await writeFile(manifestPath, originalManifest);
}

if (dryRun) {
  process.stdout.write(`Would publish ${manifest.name}@${canaryVersion}\n`);
  await rm(temporaryDirectory, { force: true, recursive: true });
  process.exit(0);
}

try {
  const { stdout, stderr } = await execFileAsync(
    "npm",
    ["publish", tarballPath, "--provenance", "--access", "public", "--tag", "alpha"],
    {
      cwd: temporaryDirectory,
    },
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
