import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runReleaseCommand, versionScope } from "./scoped-release.ts";
import { scopedChangesets } from "./release-scope.ts";

const repositoryRoot = process.cwd();
const branch = "release/browse";
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required");
const changesets = await scopedChangesets(repositoryRoot, "cli");
if (changesets.length > 0) {
  runReleaseCommand("git", ["diff", "--exit-code", "HEAD"], repositoryRoot);
  const previous = execFileSync("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s/)[0];
  runReleaseCommand("git", ["switch", "-C", branch], repositoryRoot);
  await versionScope(repositoryRoot, "cli");
  const allowed = new Set([
    "packages/cli/package.json",
    "packages/cli/CHANGELOG.md",
    ...changesets.map((changeset) => `.changeset/${changeset.id}.md`),
  ]);
  const changed = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (changed.some((file) => !allowed.has(file)))
    throw new Error(`Unexpected CLI release files: ${changed.join(", ")}`);
  const manifest = JSON.parse(await readFile("packages/cli/package.json", "utf8"));
  const title = `Release browse@${manifest.version}`;
  // GitHub's documented bot identity: https://github.com/actions/checkout#push-a-commit-using-the-built-in-token
  runReleaseCommand("git", ["config", "user.name", "github-actions[bot]"], repositoryRoot);
  runReleaseCommand(
    "git",
    ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    repositoryRoot,
  );
  runReleaseCommand("git", ["add", "--", ...allowed], repositoryRoot);
  runReleaseCommand("git", ["commit", "-m", title], repositoryRoot);
  runReleaseCommand(
    "git",
    [
      "push",
      `--force-with-lease=refs/heads/${branch}:${previous}`,
      "origin",
      `HEAD:refs/heads/${branch}`,
    ],
    repositoryRoot,
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "browse-release-pr-"));
  try {
    const changelog = await readFile("packages/cli/CHANGELOG.md", "utf8");
    const notes = changelog.split(/^## /m)[1]?.trim() ?? manifest.version;
    const body = path.join(directory, "body.md");
    await writeFile(
      body,
      `Release Browse independently of the Stagehand SDKs. Merging this PR publishes the CLI from the merged commit.\n\n## ${notes}\n`,
    );
    const prs = JSON.parse(
      execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--repo",
          repo,
          "--head",
          branch,
          "--base",
          "main",
          "--state",
          "open",
          "--json",
          "number",
        ],
        { encoding: "utf8" },
      ),
    );
    const args = prs.length
      ? ["pr", "edit", String(prs[0].number)]
      : ["pr", "create", "--base", "main", "--head", branch];
    runReleaseCommand(
      "gh",
      [...args, "--repo", repo, "--title", title, "--body-file", body],
      repositoryRoot,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
