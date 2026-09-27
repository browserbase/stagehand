import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isCliVersionPublished, runReleaseCommand } from "./scoped-release.ts";

export async function pushCliReleaseTag(
  repositoryRoot: string,
  registry = "https://registry.npmjs.org",
): Promise<"existing" | "unpublished" | "pushed"> {
  const manifestPath = "packages/cli/package.json";
  const { version } = JSON.parse(await readFile(path.join(repositoryRoot, manifestPath), "utf8"));
  const tag = `browse@${version}`;
  const ref = `refs/tags/${tag}`;
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (git(["ls-remote", "--tags", "origin", ref])) return "existing";
  if (!(await isCliVersionPublished(repositoryRoot, registry))) return "unpublished";

  const local = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (local.error) throw local.error;
  if (local.status === 1) {
    // A fresh checkout after npm accepted the upload may have no local tag.
    // Recover only on the version-bump commit; tagging a later main HEAD would
    // misidentify the released code. Retrying the original workflow retains it.
    const previous = JSON.parse(git(["show", `HEAD^:${manifestPath}`]));
    if (previous.version === version) {
      throw new Error(
        `Cannot recover ${tag} from a later commit; rerun the original version-bump workflow`,
      );
    }
    runReleaseCommand("git", ["tag", tag, "HEAD"], repositoryRoot);
  } else if (local.status !== 0) {
    throw new Error("Could not inspect the local Browse release tag");
  } else {
    const tagged = JSON.parse(git(["show", `${local.stdout.trim()}:${manifestPath}`]));
    if (tagged.version !== version)
      throw new Error("Local Browse tag points to a different package version");
  }

  runReleaseCommand("git", ["push", "origin", ref], repositoryRoot);
  return "pushed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`Browse release tag: ${await pushCliReleaseTag(process.cwd())}\n`);
}
