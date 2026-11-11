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

Browse pins an exact published TypeScript SDK version in `packages/cli/package.json`.
Development, CI, and installed packages all use that version from npm. SDK upgrades
are explicit Browse dependency changes: publish the SDK first, update the pin and
lockfile, and run Browse's contract and browser smoke tests before releasing.
The CLI publishing path checks the declared version on npm and rejects workspace
links or version ranges for monorepo dependencies. It retains a bounded wait for
registry propagation, independent of unrelated SDK checks.
Before publishing, the CLI job also packs and installs Browse outside the workspace
to check its packaged entry points and dependencies.

## Coordination details

The versioning wrapper applies only entries belonging to the selected release
group, including entries with no version bump. This prevents SDK releases from
silently updating Browse's dependency pin.

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

## Browse alphas

Every push to `main` that changes `packages/cli/` without changing the Browse
version publishes `<current-version>-alpha-<full-commit-sha>` under npm's `alpha`
dist-tag. This restores the original path-based Browse canary behavior: no
changeset is required, and pending CLI and SDK changesets remain available for
their stable releases. Pushes containing a Browse version bump publish stable
releases instead. Already-published alpha versions are skipped on retries.

The alpha job runs independently of the stable release jobs, uses only the
Browse publisher, and creates no Git tag. It builds and smoke-tests the tarball
against Browse's pinned published SDK version, just like stable Browse releases;
it does not depend on an SDK alpha being published for the same commit.

## First rollout

Merge this infrastructure change before either pending release PR. The next
Release run regenerates the existing Stagehand release PR without Browse and
creates the separate Browse release PR. Verify both diffs before merging. Do not
merge an older combined release PR during the transition.

The CLI job stays in `release.yml` so it uses the same npm trusted-publisher
workflow identity as the existing release process. GitHub Actions OIDC and npm
publication permissions must still be verified on the first production release.

## Python distribution installs

`publish-python.yml` uses `just _install-python-release` for stable and alpha builds.
It installs root release tooling plus the extension, protocol, and TypeScript SDK
pnpm dependencies, and syncs only the Python `stagehand` environment. The SDK TS
dependencies are required by the extension's current direct source imports.

The build job disables pnpm's automatic dependency installation before `run`/`exec`
so alpha manifest changes cannot trigger a full-workspace reinstall. For local
reproduction in a disposable checkout, set `pnpm_config_verify_deps_before_run=false`
for subsequent pnpm commands too. Root `just install` remains comprehensive.

Both installs use locked dependencies. Alpha preparation still deliberately updates
the shared lockfile after changing versions; filtered installation does not isolate
workspace-wide dependency resolution. Existing wheel and source-distribution smoke
checks and publication steps are unchanged.
