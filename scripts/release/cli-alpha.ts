import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareCliAlpha(
  repositoryRoot: string,
  baseRef = "HEAD^",
  registry = "https://registry.npmjs.org",
): Promise<string | undefined> {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (!git(["diff", "--name-only", baseRef, "HEAD", "--", "packages/cli/"])) return;

  const manifestPath = "packages/cli/package.json";
  const file = path.join(repositoryRoot, manifestPath);
  const manifest = JSON.parse(await readFile(file, "utf8"));
  const previous = JSON.parse(git(["show", `${baseRef}:${manifestPath}`]));
  // A release PR publishes the new stable version through release-cli.
  if (previous.version !== manifest.version) return;
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("Expected a stable Browse version before preparing an alpha");
  }

  const version = `${manifest.version}-alpha-${git(["rev-parse", "HEAD"])}`;
  const response = await fetch(`${registry}/browse/${version}`, {
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  if (response.ok) return;
  if (response.status !== 404) {
    throw new Error(`Registry returned ${response.status} while checking browse@${version}`);
  }

  // This checkout is disposable. Leave changesets and SDK versions untouched.
  await writeFile(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = await prepareCliAlpha(process.cwd(), process.env.CLI_ALPHA_BASE || "HEAD^");
  process.stdout.write(`should-publish=${version !== undefined}\n`);
  if (version) process.stdout.write(`version=${version}\n`);
}
