# Release groups

Browse and the Stagehand SDKs have separate release PRs and publication jobs in
`release.yml`. Both use the official Changesets release planner, changelog writer,
and publisher; the wrapper chooses which changesets/packages they see.

- A changeset containing `browse` belongs to the CLI. Its release PR is
  `release/browse`, titled `Release browse@<version>`.
- All other changesets belong to the existing Stagehand release group. Its PR
  remains `changeset-release/main`.
- A change affecting both groups needs two changeset files. CI rejects mixed
  files so merging one release cannot consume the other's release notes.
- Merge either release PR when ready. The next push to main publishes that group
  even while changesets for the other group remain pending. SDK alphas exclude
  Browse. Python and Go continue to follow the SDK group.
- Re-run the failed Release workflow to retry publication. Each package has one
  publisher, and Changesets skips versions already present in the registry.

Browse still depends on the TypeScript SDK via `workspace:*`. Packing resolves
that to the workspace SDK's exact version. That SDK version must already exist
on npm; a dependency change requiring new SDK code must ship the SDK first.
The CLI publishing path waits up to 15 minutes for that SDK version to appear,
so it can complete alongside a concurrent SDK publication without depending on
unrelated SDK checks.
Before publishing, the CLI job packs and installs Browse outside the workspace
and checks its entry points against registry dependencies. This does not prove
that every browser command is compatible with an unreleased SDK change.

## Coordination details

Changesets 2.x `publish` does not honor `ignore`. The wrapper temporarily marks
packages outside the selected group private and restores their exact manifests
in `finally`. These flags are never committed. Keep `privatePackages.tag: false`.

The Changesets GitHub action also counts every pending changeset when choosing
between versioning and publishing. If no SDK changesets remain, the SDK job
moves pending CLI changesets outside the checkout for the action's publish-only
invocation, then restores them in an `always()` step. When an SDK PR is being
prepared, nothing is hidden: the scoped version command consumes only SDK notes.

Shared Changesets prerelease mode (`.changeset/pre.json`) is rejected. Existing
commit-addressed SDK snapshot releases remain supported.

Tag recovery runs even if the publisher fails after npm accepts the version.
It checks npm before creating a missing tag and skips existing remote tags. If
the local tag is missing, recovery requires the original version-bump commit;
it refuses to label a later main commit as the release. Retry the original
Release workflow run in that case.

## First rollout

Merge this infrastructure change before either pending release PR. The next
Release run regenerates the existing Stagehand release PR without Browse and
creates the separate Browse release PR. Verify both diffs before merging. Do not
merge an older combined release PR during the transition.

The CLI job stays in `release.yml` so it uses the same npm trusted-publisher
workflow identity as the existing release process. GitHub Actions OIDC and npm
publication permissions must still be verified on the first production release.
