import applyReleasePlan from "@changesets/apply-release-plan";
import assembleReleasePlan from "@changesets/assemble-release-plan";
import { read } from "@changesets/config";
import { getPackages } from "@manypkg/get-packages";
import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { belongsToScope, parseReleaseScope, scopedChangesets } from "./release-scope.ts";
import type { ReleaseScope } from "./release-scope.ts";

export async function versionScope(repositoryRoot: string, scope: ReleaseScope, snapshot = false) {
  // Shared prerelease state cannot safely describe two independent release schedules.
  try {
    await access(path.join(repositoryRoot, ".changeset/pre.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return await applyVersionScope(repositoryRoot, scope, snapshot);
  }
  throw new Error("Exit Changesets prerelease mode before using scoped releases");
}

async function applyVersionScope(repositoryRoot: string, scope: ReleaseScope, snapshot: boolean) {
  const changesets = await scopedChangesets(repositoryRoot, scope);
  const packages = await getPackages(repositoryRoot);
  const config = await read(repositoryRoot, packages);
  if (scope === "sdk") config.ignore = [...config.ignore, "browse"];
  const snapshotOptions = snapshot
    ? {
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repositoryRoot,
          encoding: "utf8",
        }).trim(),
      }
    : undefined;
  const plan = assembleReleasePlan(changesets, packages, config, undefined, snapshotOptions);
  for (const release of plan.releases) {
    if (release.type !== "none" && !belongsToScope(release.name, scope)) {
      throw new Error(`Release would cross the ${scope} boundary: ${release.name}`);
    }
  }
  await applyReleasePlan(plan, packages, config, snapshot ? true : undefined, repositoryRoot);
  return plan;
}

export function runReleaseCommand(command: string, args: string[], repositoryRoot: string): void {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

export async function assertPublishedCliDependencies(
  repositoryRoot: string,
  registry = "https://registry.npmjs.org",
): Promise<void> {
  const packages = await getPackages(repositoryRoot);
  const browse = packages.packages.find((pkg) => pkg.packageJson.name === "browse");
  if (!browse) throw new Error("Missing browse package");
  for (const [name, range] of Object.entries(browse.packageJson.dependencies ?? {})) {
    if (!range.startsWith("workspace:")) continue;
    const dependency = packages.packages.find((pkg) => pkg.packageJson.name === name);
    if (!dependency) throw new Error(`Missing workspace dependency ${name}`);
    const response = await fetch(
      `${registry}/${encodeURIComponent(name)}/${dependency.packageJson.version}`,
    );
    if (!response.ok) {
      throw new Error(
        `Publish ${name}@${dependency.packageJson.version} before Browse (registry status ${response.status})`,
      );
    }
  }
}

// Changesets 2.x publish does not honor config.ignore. Give each package exactly
// one publisher, while retaining Changesets' registry checks, tags and OIDC path.
// These flags exist only during publishing; they never enter a release commit.
export async function withPublishScope(
  repositoryRoot: string,
  scope: ReleaseScope,
  publish: () => Promise<void>,
): Promise<void> {
  const { packages } = await getPackages(repositoryRoot);
  const originals = new Map<string, string>();
  try {
    for (const pkg of packages) {
      if (belongsToScope(pkg.packageJson.name, scope) || pkg.packageJson.private) continue;
      const file = path.join(pkg.dir, "package.json");
      const original = await readFile(file, "utf8");
      originals.set(file, original);
      await writeFile(
        file,
        `${JSON.stringify({ ...JSON.parse(original), private: true }, null, 2)}\n`,
      );
    }
    await publish();
  } finally {
    for (const [file, original] of originals) await writeFile(file, original);
  }
}

async function main(): Promise<void> {
  const [command, target, ...flags] = process.argv.slice(2);
  const scope = parseReleaseScope(target);
  const repositoryRoot = process.cwd();
  if (command === "status") {
    process.stdout.write(
      `has-changesets=${(await scopedChangesets(repositoryRoot, scope)).length > 0}\n`,
    );
  } else if (command === "version") {
    if (flags.some((flag) => flag !== "--snapshot")) throw new Error("Unknown version flag");
    const plan = await versionScope(repositoryRoot, scope, flags.includes("--snapshot"));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (command === "publish") {
    if (flags.some((flag) => flag !== "--alpha")) throw new Error("Unknown publish flag");
    if ((await scopedChangesets(repositoryRoot, scope)).length > 0) {
      throw new Error(`Version pending ${scope} changesets before publishing`);
    }
    if (scope === "cli") await assertPublishedCliDependencies(repositoryRoot);
    await withPublishScope(repositoryRoot, scope, async () => {
      runReleaseCommand(
        "pnpm",
        [
          "exec",
          "changeset",
          "publish",
          ...(flags.includes("--alpha") ? ["--tag", "alpha", "--no-git-tag"] : []),
        ],
        repositoryRoot,
      );
    });
  } else {
    throw new Error("Expected command: status, version, or publish");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
