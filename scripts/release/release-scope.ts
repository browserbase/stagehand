import readChangesets from "@changesets/read";

export type ReleaseScope = "cli" | "sdk";

export function parseReleaseScope(value: string | undefined): ReleaseScope {
  if (value !== "cli" && value !== "sdk") throw new Error("Expected release scope: cli or sdk");
  return value;
}

export function belongsToScope(name: string, scope: ReleaseScope): boolean {
  return (name === "browse") === (scope === "cli");
}

export async function scopedChangesets(repositoryRoot: string, scope: ReleaseScope) {
  const changesets = await readChangesets(repositoryRoot);
  for (const changeset of changesets) {
    const hasCli = changeset.releases.some((release) => release.name === "browse");
    if (hasCli && changeset.releases.some((release) => release.name !== "browse")) {
      throw new Error(`Split mixed CLI/SDK changeset ${changeset.id} into separate files`);
    }
  }
  return changesets.filter((changeset) =>
    changeset.releases.length === 0
      ? scope === "sdk"
      : changeset.releases.some((release) => belongsToScope(release.name, scope)),
  );
}
