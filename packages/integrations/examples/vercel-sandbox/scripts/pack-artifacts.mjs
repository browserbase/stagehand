import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const exampleRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(exampleRoot, "../../../..");
const sdkRoot = path.join(repositoryRoot, "packages", "sdk-ts");
const codeModeRoot = path.join(repositoryRoot, "packages", "integrations");
const artifactRoot = path.join(exampleRoot, ".artifacts");
const packageRoot = path.join(artifactRoot, "packages");
const runtimeRoot = path.join(artifactRoot, "runtime");
const publicRegistry = "https://registry.npmjs.org";

await rm(artifactRoot, { force: true, recursive: true });
await Promise.all([
  mkdir(packageRoot, { recursive: true }),
  mkdir(runtimeRoot, { recursive: true }),
]);
await execFileAsync(
  "pnpm",
  ["exec", "turbo", "run", "build", "--filter", "@browserbasehq/stagehand-codemode"],
  { cwd: repositoryRoot },
);
await execFileAsync("pnpm", ["pack", "--pack-destination", packageRoot], { cwd: sdkRoot });
await execFileAsync("pnpm", ["pack", "--pack-destination", packageRoot], {
  cwd: codeModeRoot,
});

const packed = await readdir(packageRoot);
const stagehandSource = requiredArtifact(packed, /^browserbasehq-stagehand-(?!codemode-).+\.tgz$/);
const codeModeSource = requiredArtifact(packed, /^browserbasehq-stagehand-codemode-.+\.tgz$/);
const stagehandPath = path.join(packageRoot, "stagehand.tgz");
const codeModePath = path.join(packageRoot, "stagehand-codemode.tgz");
await rename(path.join(packageRoot, stagehandSource), stagehandPath);
await rename(path.join(packageRoot, codeModeSource), codeModePath);

const runtimeManifest = {
  name: "stagehand-sandbox-runtime",
  private: true,
  version: "0.0.0",
  dependencies: {
    "@browserbasehq/stagehand": "file:../packages/stagehand.tgz",
    "@browserbasehq/stagehand-codemode": "file:../packages/stagehand-codemode.tgz",
    supergateway: "3.4.3",
  },
};
await writeFile(
  path.join(runtimeRoot, "package.json"),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
);
await execFileAsync(
  "npm",
  [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `--registry=${publicRegistry}`,
  ],
  { cwd: runtimeRoot },
);
await assertPublicLock(path.join(runtimeRoot, "package-lock.json"));

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    artifacts: {
      stagehand: await artifactSummary(stagehandPath),
      codeMode: await artifactSummary(codeModePath),
      runtimeManifest: await artifactSummary(path.join(runtimeRoot, "package.json")),
      runtimeLock: await artifactSummary(path.join(runtimeRoot, "package-lock.json")),
    },
  })}\n`,
);

function requiredArtifact(files, pattern) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one packed artifact matching ${pattern}`);
  }
  return matches[0];
}

async function artifactSummary(artifactPath) {
  const content = await readFile(artifactPath);
  return {
    path: artifactPath,
    bytes: (await stat(artifactPath)).size,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function assertPublicLock(lockPath) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  for (const entry of Object.values(lock.packages ?? {})) {
    const resolved = entry?.resolved;
    if (
      typeof resolved === "string" &&
      !resolved.startsWith("file:") &&
      !resolved.startsWith(`${publicRegistry}/`)
    ) {
      throw new Error(`Sandbox runtime lock contains a non-public source: ${resolved}`);
    }
  }
}
