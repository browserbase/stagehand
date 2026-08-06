# Stagehand

Stagehand is the AI browser automation framework.

## Setup

Install [Node.js 24](https://nodejs.org/), [pnpm](https://pnpm.io/installation), [just](https://github.com/casey/just), and [uv](https://docs.astral.sh/uv/):

```bash
corepack enable pnpm
brew install just uv
```

Install the project:

```bash
just install
```

## Development

Run an example:

```bash
just example act
```

Run the documentation:

```bash
just docs
```

## Contributing

Before opening a pull request, run:

```bash
just check
just test
```

Package metadata is the source of truth for versions. Each package can be selected independently in
a Changeset; there are no fixed groups. The private Python `package.json` lets Changesets version the
public `stagehand` package; release tooling copies that version into `pyproject.toml` and `uv.lock`.

After the initial v4 release, run `just changeset` when a pull request changes a public SDK, the
extension, or the protocol compatibility contract. Select only the packages intended for release
and commit the generated `.changeset/*.md` file with the pull request. Tests, documentation,
formatting, and internal refactors do not need a Changeset.

| Change                                                       | Changeset                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| SDK-only fix or feature                                      | Patch or minor for that SDK only                                     |
| Extension-only implementation fix                            | Extension patch, plus each SDK that should ship it; no protocol bump |
| Compatible protocol correction requiring no new capability   | Protocol patch, plus affected implementations as needed              |
| Backward-compatible capability that a new client may require | Protocol minor, plus affected implementations as needed              |
| Breaking wire or transport change                            | Protocol major and a coordinated release                             |

See [`packages/protocol/README.md`](packages/protocol/README.md#runtime-protocol-versions) for the
runtime compatibility rule and protocol SemVer policy.

Merging a normal pull request does not publish anything. Changesets creates or
updates a release pull request on `main`, where additional Changesets can
accumulate. When a maintainer is ready to release, merging that release pull
request publishes a changed TypeScript SDK to npm and a changed Python SDK to
PyPI. TypeScript and Python do not have to be bumped together; the Python proxy
version is synchronized only with its own `pyproject.toml` and lockfile.

The extension is embedded in each SDK rather than published separately, so an
SDK must also be released to deliver an extension change to its users. The
protocol package is versioned for compatibility tracking but is not published.
The current release workflow does not create Go module tags; Go releases must
still be tagged separately with the version from `packages/sdk-go/package.json`.
Underscored `just` recipes are internal CI commands.

### Pull request previews

Add the `preview` label to build the TypeScript package, Python wheel, and
extension ZIP without publishing them. The workflow keeps one authenticated
artifact and one comment up to date with the pull request. Artifacts expire
after 30 days; push a commit or remove and reapply the label to refresh one.
Removing the label or closing the pull request removes both.

Previews do not change committed versions or changelogs, publish releases, or
deploy a Browserbase environment.
