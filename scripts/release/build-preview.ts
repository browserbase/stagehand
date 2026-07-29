import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  parsePreviewManifest,
  pythonPreviewVersion,
  sha256,
  typescriptPreviewVersion,
  verifyPreviewBundle,
} from "./preview-contract.js";
import {
  parsePreviewPythonProject,
  updatePreviewPythonProjectVersion,
} from "./preview-python-project.js";

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
  const pythonProjectContents = await readFile(pythonProjectPath, "utf8");
  const pythonProject = parsePreviewPythonProject(pythonProjectContents);

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
    updatePreviewPythonProjectVersion(pythonProjectContents, pythonVersion),
  );

  await run("uv", ["--directory", "packages/sdk-python", "lock"], checkout);
  await run("just", ["install"], checkout);
  await run("just", ["build"], checkout);
  await mkdir(outputDirectory, { recursive: true });

  const typescriptFile = "stagehand-typescript.tgz";
  const typescriptPath = path.join(outputDirectory, typescriptFile);
  await run("pnpm", ["pack", "--out", typescriptPath], path.join(checkout, "packages/sdk-ts"));

  const pythonDist = path.join(checkout, "packages/sdk-python/dist");
  const pythonWheels = (await readdir(pythonDist)).filter((file) => file.endsWith(".whl"));
  if (pythonWheels.length !== 1) {
    throw new Error(`Expected one Python wheel; found ${pythonWheels.length}`);
  }
  const builtPythonFile = pythonWheels[0]!;
  const pythonFile = "stagehand-python.whl";
  const pythonPath = path.join(outputDirectory, pythonFile);
  await cp(path.join(pythonDist, builtPythonFile), pythonPath);

  const extensionFile = "stagehand-extension.zip";
  const extensionPath = path.join(outputDirectory, extensionFile);
  await cp(path.join(checkout, "packages/server/artifacts/stagehand-extension.zip"), extensionPath);

  const manifest = parsePreviewManifest({
    schemaVersion: 1,
    commitSha,
    pullRequest,
    protocol: {
      package: protocolManifest.name,
      version: protocolManifest.version,
    },
    artifacts: {
      typescript: {
        package: typescriptManifest.name,
        version: typescriptVersion,
        file: typescriptFile,
        sha256: sha256(await readFile(typescriptPath)),
        install: `pnpm add ./${typescriptFile}`,
      },
      python: {
        package: pythonProject.name,
        version: pythonVersion,
        file: pythonFile,
        sha256: sha256(await readFile(pythonPath)),
        install: `uv add ./${pythonFile}`,
      },
      extension: {
        package: serverManifest.name,
        version: serverManifest.version,
        file: extensionFile,
        sha256: sha256(await readFile(extensionPath)),
      },
    },
  });

  await writeFile(
    path.join(outputDirectory, "stagehand-preview.json"),
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
  version: string;
};

async function readPackageManifest(file: string): Promise<PackageManifest> {
  const contents = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  if (typeof contents.name !== "string" || typeof contents.version !== "string") {
    throw new Error(`${file} must define string name and version fields`);
  }

  return {
    contents,
    name: contents.name,
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
