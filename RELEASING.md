# Versioning and releases

Stagehand is a polyglot monorepo with one release interface. Contributors use the
root `justfile`; package and registry details stay inside the release automation.

## Package versions

Every deliverable owns its version in its package metadata:

| Deliverable    | Version source                     | Stable destination     |
| -------------- | ---------------------------------- | ---------------------- |
| TypeScript SDK | `packages/sdk-ts/package.json`     | npm                    |
| Python SDK     | `packages/sdk-python/package.json` | PyPI                   |
| Extension      | `packages/server/package.json`     | GitHub Releases        |
| Protocol       | `packages/protocol/package.json`   | Compatibility metadata |
| Go SDK         | Go module tag                      | Go module proxy        |

The Python `package.json` is the Changesets proxy. `just _version` copies its
version into `pyproject.toml` and updates `uv.lock`; those files are not separate
version inputs.

The TypeScript client, extension runtime, extension manifest, protocol major, and
preview manifest all read these package versions. Preview versions add the Git SHA
to a package version in a temporary worktree and never edit the checked-out source.

The root `CHANGELOG.md` records public SDK releases. Evals keeps its existing
package-level changelog because it already has an independent release history.

## Contributor commands

```sh
just install
just check
just test
just build
just changeset
```

Add a Changeset when a pull request changes something users can observe in a
released package: an API, behavior, compatibility contract, package contents, or
meaningful performance characteristic. Tests, documentation, formatting, and
internal refactors do not need one.

The initial v4 stack establishes the `4.0.0` baseline without Changesets. This
rule begins after the first v4 release.

Commands beginning with `_` are CI plumbing rather than contributor workflows:

- `just _version` applies Changesets and synchronizes changelogs and Python
  metadata.
- `just _preview <sha>` builds and validates one pull request preview.
- Publishing remains split into isolated CI jobs so a registry failure can be
  retried without republishing successful artifacts.

## Pull request previews

An eligible pull request automatically receives one preview for its current head
commit. No Changeset or publish command is required.

`just _preview` builds:

- a TypeScript tarball with version `<package-version>-preview.<full-sha>`;
- a Python wheel with version `<package-version>.dev0+g<full-sha>`;
- the standalone extension ZIP using the server package version;
- a manifest containing the package versions, public URLs, and SHA-256 checksums.

The workflow creates a draft GitHub release, uploads and verifies every asset,
publishes it as a prerelease, verifies the public downloads, and updates one
persistent pull request comment. Only then does it delete the previous preview.
If a build fails, the last successful preview remains available.

Preview tags are immutable identities:

```text
preview-pr-<pull-request>-<full-sha>
```

A new commit creates a new tag. Closing or merging the pull request deletes its
preview release and tag; deleted names are never reused. With GitHub immutable
releases enabled, automation deletes the whole release before its tag, as GitHub
requires.

Only branches inside `browserbase/stagehand` publish previews. Fork pull requests
run the normal untrusted CI checks without receiving release permissions.

Previews do not:

- change committed versions or changelogs;
- publish to npm, PyPI, or the Go module proxy;
- deploy a Browserbase environment;
- create a stable release.

## Browserbase testing

The preview manifest is the contract between Stagehand and Core. Core reads
`artifacts.extension.url` and `artifacts.extension.sha256`, converts them to its
existing `EXTENSIONS_SPEC_JSON` entry, and installs the extension into the browser
image.

A Stagehand preview never changes a shared environment. An explicit Core build
selects the manifest, builds and tests an image containing that exact extension,
and tags the image with both repositories' commits. Production uses stable
artifacts only.

## Stable releases

Stable releases run only from `main`:

1. Feature pull requests record release intent with `just changeset`.
2. Changesets maintains a release pull request using `just _version`.
3. Merging the release pull request publishes each prepared package from an
   isolated CI job.

The TypeScript SDK publishes to npm and the Python SDK publishes to PyPI. Both
begin at `4.0.0`; Changesets can publish those prepared versions without an
additional pre-launch bump because they do not yet exist in their registries.

Stable artifacts are never replaced. A bad release is fixed in a new version.
The legacy v3 branch can continue shipping hotfixes, followed by a changelog-only
pull request that records the release on `main`.
