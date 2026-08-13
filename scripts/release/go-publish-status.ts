import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const moduleBase = "github.com/browserbase/stagehand/packages/sdk-go";
const packageVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const goPackageKeyPattern =
  /^\s*(?:"@browserbasehq\/stagehand-go"|'@browserbasehq\/stagehand-go'|@browserbasehq\/stagehand-go)\s*:/mu;

export type GoPublishStatusOptions = {
  repositoryRoot?: string;
  tagExists?: (tag: string) => Promise<boolean>;
};

export type GoPublishStatus = {
  shouldTag: boolean;
  tag: string;
};

async function localTagExists(repositoryRoot: string, tag: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], {
      cwd: repositoryRoot,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return false;
    throw error;
  }
}

function changesetReleasesGo(contents: string, file: string): boolean {
  const frontmatter = /^---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents)?.groups?.body;
  if (frontmatter === undefined) {
    throw new Error(`${file} does not contain changeset frontmatter`);
  }
  return goPackageKeyPattern.test(frontmatter);
}

async function hasPendingGoRelease(repositoryRoot: string): Promise<boolean> {
  const changesetDirectory = path.join(repositoryRoot, ".changeset");
  const files = (await readdir(changesetDirectory)).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );

  let pending = false;
  for (const file of files) {
    const contents = await readFile(path.join(changesetDirectory, file), "utf8");
    pending = changesetReleasesGo(contents, file) || pending;
  }
  return pending;
}

export async function goPublishStatus({
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  tagExists = async (tag) => await localTagExists(repositoryRoot, tag),
}: GoPublishStatusOptions = {}): Promise<GoPublishStatus> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "packages/sdk-go/package.json"), "utf8"),
  ) as { version?: unknown };
  const version = packageJson.version;
  if (typeof version !== "string") {
    throw new Error(`Invalid Go SDK package version: ${String(version)}`);
  }
  const match = packageVersionPattern.exec(version);
  if (match === null) throw new Error(`Invalid Go SDK package version: ${version}`);

  const moduleFile = await readFile(path.join(repositoryRoot, "packages/sdk-go/go.mod"), "utf8");
  const modulePath = /^module (\S+)$/mu.exec(moduleFile)?.[1];
  const expectedModulePath = `${moduleBase}/v${match[1]}`;
  if (modulePath !== expectedModulePath) {
    throw new Error(
      `Go module path is ${String(modulePath)}; expected ${expectedModulePath} for ${version}`,
    );
  }

  const tag = `packages/sdk-go/v${version}`;
  if (await hasPendingGoRelease(repositoryRoot)) return { shouldTag: false, tag };

  return { shouldTag: !(await tagExists(tag)), tag };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const status = await goPublishStatus();
  process.stdout.write(`should-tag=${String(status.shouldTag)}\ntag=${status.tag}\n`);
}
