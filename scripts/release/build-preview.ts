import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  parsePreviewManifest,
  previewTag,
  pythonPreviewVersion,
  releaseAssetUrl,
  sha256,
  typescriptPreviewVersion,
  verifyPreviewBundle,
} from "./preview-contract.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const outputDirectory = path.join(repositoryRoot, "dist", "preview");
const commitSha = process.argv[2];
const pullRequest = Number.parseInt(process.env.STAGEHAND_PREVIEW_PULL_REQUEST ?? "", 10);

if (commitSha === undefined || !/^[0-9a-f]{40}$/u.test(commitSha)) {
  throw new Error("Pass the full 40-character preview commit SHA");
}
if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
  throw new Error("Set STAGEHAND_PREVIEW_PULL_REQUEST to the pull request number");
}

const resolvedCommit = await capture("git", ["rev-parse", "--verify", `${commitSha}^{commit}`]);
const currentCommit = await capture("git", ["rev-parse", "HEAD"]);
if (resolvedCommit !== commitSha || currentCommit !== commitSha) {
  throw new Error(
    `Preview identity must match the checked-out commit: requested=${commitSha} HEAD=${currentCommit}`,
  );
}

const rootManifest = await readPackageManifest(path.join(repositoryRoot, "package.json"));
const repository = githubRepository(rootManifest.repositoryUrl);
const tag = previewTag(pullRequest, commitSha);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "stagehand-preview-"));
const checkout = path.join(temporaryRoot, "checkout");
let worktreeAdded = false;
let completed = false;
let failure: unknown;

await rm(outputDirectory, { force: true, recursive: true });

try {
  await run("git", ["worktree", "add", "--detach", checkout, commitSha]);
  worktreeAdded = true;

  const typescriptManifestPath = path.join(checkout, "packages/sdk-ts/package.json");
  const pythonProxyManifestPath = path.join(checkout, "packages/sdk-python/package.json");
  const pythonProjectPath = path.join(checkout, "packages/sdk-python/pyproject.toml");
  const serverManifestPath = path.join(checkout, "packages/server/package.json");
  const protocolManifestPath = path.join(checkout, "packages/protocol/package.json");

  const typescriptManifest = await readPackageManifest(typescriptManifestPath);
  const pythonProxyManifest = await readPackageManifest(pythonProxyManifestPath);
  const serverManifest = await readPackageManifest(serverManifestPath);
  const protocolManifest = await readPackageManifest(protocolManifestPath);
  const pythonProject = await readPythonProject(pythonProjectPath);

  if (pythonProxyManifest.version !== pythonProject.version) {
    throw new Error(
      `Python package versions are out of sync: package.json=${pythonProxyManifest.version} pyproject.toml=${pythonProject.version}`,
    );
  }

  const typescriptVersion = typescriptPreviewVersion(typescriptManifest.version, commitSha);
  const pythonVersion = pythonPreviewVersion(pythonProxyManifest.version, commitSha);
  await writePackageVersion(typescriptManifestPath, typescriptManifest.contents, typescriptVersion);
  await writePackageVersion(pythonProxyManifestPath, pythonProxyManifest.contents, pythonVersion);
  await writeFile(
    pythonProjectPath,
    pythonProject.contents.replace(pythonProject.versionLine, `version = "${pythonVersion}"`),
  );

  await run("uv", ["--directory", "packages/sdk-python", "lock"], checkout);
  await run("just", ["install"], checkout);
  await run("just", ["build"], checkout);
  await mkdir(outputDirectory, { recursive: true });

  const typescriptFile = `stagehand-typescript-${commitSha}.tgz`;
  const typescriptPath = path.join(outputDirectory, typescriptFile);
  await run("vp", ["pm", "pack", "--out", typescriptPath], path.join(checkout, "packages/sdk-ts"));

  const pythonDist = path.join(checkout, "packages/sdk-python/dist");
  const pythonWheels = (await readdir(pythonDist)).filter((file) => file.endsWith(".whl"));
  if (pythonWheels.length !== 1) {
    throw new Error(`Expected one Python wheel; found ${pythonWheels.length}`);
  }
  const pythonFile = pythonWheels[0]!;
  const pythonPath = path.join(outputDirectory, pythonFile);
  await cp(path.join(pythonDist, pythonFile), pythonPath);

  const extensionFile = `stagehand-extension-${commitSha}.zip`;
  const extensionPath = path.join(outputDirectory, extensionFile);
  await cp(path.join(checkout, "packages/server/artifacts/stagehand-extension.zip"), extensionPath);

  const typescriptUrl = releaseAssetUrl(repository, tag, typescriptFile);
  const pythonUrl = releaseAssetUrl(repository, tag, pythonFile);
  const extensionUrl = releaseAssetUrl(repository, tag, extensionFile);
  const manifest = parsePreviewManifest({
    schemaVersion: 1,
    repository,
    commitSha,
    pullRequest,
    tag,
    protocol: {
      package: protocolManifest.name,
      version: protocolManifest.version,
    },
    artifacts: {
      typescript: {
        package: typescriptManifest.name,
        version: typescriptVersion,
        file: typescriptFile,
        url: typescriptUrl,
        sha256: sha256(await readFile(typescriptPath)),
        install: `npm install ${typescriptUrl}`,
      },
      python: {
        package: pythonProject.name,
        version: pythonVersion,
        file: pythonFile,
        url: pythonUrl,
        sha256: sha256(await readFile(pythonPath)),
        install: `uv add ${pythonUrl}`,
      },
      extension: {
        package: serverManifest.name,
        version: serverManifest.version,
        file: extensionFile,
        url: extensionUrl,
        sha256: sha256(await readFile(extensionPath)),
      },
    },
  });

  await writeFile(
    path.join(outputDirectory, `stagehand-preview-${commitSha}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await verifyPreviewBundle(outputDirectory);
  completed = true;
  process.stdout.write(`Built Stagehand preview ${commitSha} in ${outputDirectory}\n`);
} catch (error) {
  failure = error;
} finally {
  if (worktreeAdded) {
    try {
      await run("git", ["worktree", "remove", "--force", checkout]);
    } catch (error) {
      failure ??= error;
    }
  }
  await rm(temporaryRoot, { force: true, recursive: true });
  if (!completed) {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}

if (failure !== undefined) {
  throw failure;
}

type PackageManifest = {
  contents: Record<string, unknown>;
  name: string;
  repositoryUrl?: string;
  version: string;
};

async function readPackageManifest(file: string): Promise<PackageManifest> {
  const contents = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  if (typeof contents.name !== "string" || typeof contents.version !== "string") {
    throw new Error(`${file} must define string name and version fields`);
  }

  const repository = contents.repository;
  const repositoryUrl =
    typeof repository === "object" &&
    repository !== null &&
    "url" in repository &&
    typeof repository.url === "string"
      ? repository.url
      : undefined;
  return {
    contents,
    name: contents.name,
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    version: contents.version,
  };
}

async function writePackageVersion(
  file: string,
  contents: Record<string, unknown>,
  version: string,
): Promise<void> {
  await writeFile(file, `${JSON.stringify({ ...contents, version }, null, 2)}\n`);
}

async function readPythonProject(file: string): Promise<{
  contents: string;
  name: string;
  version: string;
  versionLine: string;
}> {
  const contents = await readFile(file, "utf8");
  const projectStart = contents.indexOf("[project]\n");
  if (projectStart === -1) {
    throw new Error(`${file} does not contain a [project] section`);
  }
  const projectContents = contents.slice(projectStart + "[project]\n".length);
  const nextSection = projectContents.search(/^\[/mu);
  const projectSection =
    nextSection === -1 ? projectContents : projectContents.slice(0, nextSection);
  const name = projectSection?.match(/^name = "(?<value>[^"]+)"$/mu)?.groups?.value;
  const versionLine = projectSection?.match(/^version = "[^"]+"$/mu)?.[0];
  const version = versionLine?.match(/^version = "(?<value>[^"]+)"$/u)?.groups?.value;
  if (name === undefined || version === undefined || versionLine === undefined) {
    throw new Error(`${file} must define project name and version fields`);
  }
  return { contents, name, version, versionLine };
}

function githubRepository(repositoryUrl: string | undefined): string {
  const repository = repositoryUrl?.match(
    /github\.com[/:](?<repository>[^/\s]+\/[^/\s]+?)(?:\.git)?$/u,
  )?.groups?.repository;
  if (repository === undefined) {
    throw new Error(`Root package.json has an invalid GitHub repository URL: ${repositoryUrl}`);
  }
  return repository;
}

async function capture(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function run(command: string, args: string[], cwd = repositoryRoot): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal === null ? `exit code ${String(code)}` : `signal ${signal}`}`,
        ),
      );
    });
  });
}
