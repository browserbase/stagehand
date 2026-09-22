import applyReleasePlan from "@changesets/apply-release-plan";
import assembleReleasePlan from "@changesets/assemble-release-plan";
import { read } from "@changesets/config";
import { getPackages } from "@manypkg/get-packages";
import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
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
  waitMs = 0,
  retryIntervalMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  const packages = await getPackages(repositoryRoot);
  const browse = packages.packages.find((pkg) => pkg.packageJson.name === "browse");
  if (!browse) throw new Error("Missing browse package");
  for (const [name, range] of Object.entries(browse.packageJson.dependencies ?? {})) {
    if (!range.startsWith("workspace:")) continue;
    const dependency = packages.packages.find((pkg) => pkg.packageJson.name === name);
    if (!dependency) throw new Error(`Missing workspace dependency ${name}`);
    for (;;) {
      const requestTimeoutMs = waitMs > 0 ? Math.min(30_000, deadline - Date.now()) : 30_000;
      if (requestTimeoutMs <= 0) {
        throw new Error(
          `Publish ${name}@${dependency.packageJson.version} before Browse (wait timed out)`,
        );
      }
      const response = await fetch(
        `${registry}/${encodeURIComponent(name)}/${dependency.packageJson.version}`,
        { signal: AbortSignal.timeout(requestTimeoutMs) },
      );
      await response.body?.cancel();
      if (response.ok) break;
      const remaining = deadline - Date.now();
      if (response.status !== 404 || remaining <= 0) {
        throw new Error(
          `Publish ${name}@${dependency.packageJson.version} before Browse (registry status ${response.status})`,
        );
      }
      process.stdout.write(`Waiting for ${name}@${dependency.packageJson.version} on npm\n`);
      await setTimeout(Math.min(retryIntervalMs, remaining));
    }
  }
}

export async function isCliVersionPublished(
  repositoryRoot: string,
  registry = "https://registry.npmjs.org",
): Promise<boolean> {
  const { version } = JSON.parse(
    await readFile(path.join(repositoryRoot, "packages/cli/package.json"), "utf8"),
  );
  const response = await fetch(`${registry}/browse/${version}`);
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Registry returned ${response.status} while checking browse@${version}`);
  return true;
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
    const pending = (await scopedChangesets(repositoryRoot, scope)).length > 0;
    process.stdout.write(`has-changesets=${pending}\n`);
    if (scope === "cli") {
      process.stdout.write(
        `should-publish=${!pending && !(await isCliVersionPublished(repositoryRoot))}\n`,
      );
    }
  } else if (command === "wait-dependencies" && scope === "cli") {
    // An SDK release may be publishing concurrently. Gate only on the actual
    // dependency, so unrelated SDK checks cannot block a CLI release.
    await assertPublishedCliDependencies(repositoryRoot, undefined, 15 * 60_000);
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
    throw new Error("Expected command: status, version, publish, or wait-dependencies cli");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
