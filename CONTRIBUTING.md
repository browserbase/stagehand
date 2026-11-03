# Contributing to Stagehand

Stagehand is open source under the MIT license. This guide covers the parts of the repository a
contributor needs: how the packages fit together, how to run the checks, and what a change has to
carry before it can be released.

> [!NOTE]
> For questions or support, join the [Discord community](https://discord.gg/stagehand).

## Where to start

Browserbase prioritizes reliability, extensibility, speed, and cost, in that order. Bug fixes and
small improvements are the best way to get started.

For anything larger, raise it in [Discord](https://discord.gg/stagehand) first. A quick
conversation is the best way to confirm the direction fits the roadmap before you invest time in
building it.

## How the repository fits together

Stagehand runs in two halves. The SDK runs in your process and holds the browser handle. The runtime
that executes `act()`, `extract()`, and `observe()` ships as a Chrome extension and runs inside the
browser. The two talk over the Chrome DevTools Protocol, with a JSON-RPC protocol tunneled through
it.

That protocol is the contract, and it decides how a change ripples through the repository:

| Package                                                                                  | What it is                                                                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`packages/protocol`](packages/protocol)                                                 | The JSON-RPC contract. The source of truth for every client                                                |
| [`packages/extension`](packages/extension)                                               | The in-browser runtime that serves those methods                                                           |
| [`packages/sdk-ts`](packages/sdk-ts)                                                     | The TypeScript SDK, published to npm as `@browserbasehq/stagehand`. Consumes the protocol schemas directly |
| [`packages/sdk-python`](packages/sdk-python)                                             | The Python SDK, published to PyPI as `stagehand`. Its models are generated from the protocol               |
| [`packages/sdk-go`](https://github.com/browserbase/stagehand/tree/v4-go/packages/sdk-go) | The Go SDK. Its models are generated from the protocol, and it is released by module tag                   |
| [`packages/evals`](packages/evals)                                                       | The evaluation harness                                                                                     |
| [`packages/docs`](packages/docs)                                                         | The documentation site                                                                                     |

The Python models are generated from the protocol. Regenerate them rather than hand-editing
anything under `packages/sdk-python/src/stagehand/_generated/`.

## Set up your environment

The root [`just`](https://github.com/casey/just) recipes cover TypeScript and Python development.
Install Node.js 22.18 or later, Python 3.11 or later, `just`, [`pnpm`](https://pnpm.io), and
[`uv`](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
just install
just build
```

`just install` installs the pnpm workspace and runs `uv sync --all-packages --locked` for the
Python workspace. All Python projects share the root `uv.lock` and `.venv`: the SDK,
core middleware, three cookbooks, and the Deepagents integration, eval runner, local example,
and managed example. The root `pyproject.toml` defines membership and local package sources.
Workspace consumers use the SDK and middleware from source. `pnpm install` on its own covers
only the TypeScript workspace.

Each Python member keeps its dependency declarations and tool settings in its own `pyproject.toml`.
After changing dependencies, run `uv lock` from the repository root and commit the member's
`pyproject.toml` with the root `uv.lock`. Published packages retain the dependencies declared in
`project.dependencies`; workspace sources apply to local development.

Commands run from the SDK, middleware, or cookbook directories discover the root workspace
automatically. The nested Deepagents runner and examples must select the root explicitly with
`--project` and their member with `--package`, because the integration's intermediate
`pyproject.toml` stops uv's workspace discovery. Use the root `just` recipes or the commands in
[the Deepagents README](packages/integrations/deepagents/README.md).

Add an LLM provider key and a Browserbase API key to run anything that reaches a model or a cloud
browser:

```bash
cp .env.example .env
```

Run an example to confirm the setup works:

```bash
just example act # packages/sdk-ts/examples/act.ts
```

## Before you open a pull request

Run these from the repository root to format, check, and test TypeScript and Python:

```bash
just fmt   # oxfmt and ruff
just check # formatting, lint, types, release metadata, and Python generated-code drift
just test  # vitest, pytest, and Python cookbook checkpoint tests
```

The Python formatting and lint checks cover the SDK, core middleware, and Deepagents adapter
and examples. `just check` also verifies that the Deepagents examples import successfully;
`just test` runs the SDK, middleware, Deepagents adapter, and eval runner test suites, plus the
Python catalog cookbook's checkpoint tests. To work on Deepagents alone, run these from the root:

```bash
just fmt-deepagents
just check-deepagents
just test-deepagents
```

`just check` validates the generated Python models against the committed protocol schema. If you
touched `packages/protocol`, regenerate first:

```bash
just generate
```

That rebuilds the protocol, regenerates and type-checks the Python models, and rebuilds the
extension bundle. Commit the regenerated files with your change.

> [!TIP]
> `just` recipes prefixed with `_` are internal release commands. Don't run them directly.

## Changing the protocol

Adding or changing a method touches the schema, the extension that serves it, and every client that
calls it. [`packages/protocol/README.md`](packages/protocol/README.md#adding-or-changing-a-method)
walks through that sequence, and
[runtime protocol versions](packages/protocol/README.md#runtime-protocol-versions) covers the
compatibility rule and the SemVer policy the table below depends on.

## Stacked pull requests

Larger work in this repository usually lands as a stack. Target each pull request at its immediate
predecessor rather than at `main`, and when a parent changes, merge it into its immediate child and
resolve conflicts there. After a parent is squash-merged, verify that the child contains the
parent's final tip before pushing again.

## Versioning

Package metadata is the source of truth for versions. Each package can be selected independently in
a Changeset; there are no fixed groups. The private Python `package.json` lets Changesets version
the public `stagehand` package, and release tooling copies that version into the SDK
`pyproject.toml` and its entry in the root `uv.lock`.

After the initial v4 release, run `just changeset` when a pull request changes a public SDK, the
extension, or the protocol compatibility contract. Select only the packages intended for release and
commit the generated `.changeset/*.md` file with the pull request. Tests, documentation, formatting,
and internal refactors do not need a Changeset.

| Change                                                       | Changeset                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| SDK-only fix or feature                                      | Patch or minor for that SDK only                                     |
| Extension-only implementation fix                            | Extension patch, plus each SDK that should ship it; no protocol bump |
| Compatible protocol correction requiring no new capability   | Protocol patch, plus affected implementations as needed              |
| Backward-compatible capability that a new client may require | Protocol minor, plus affected implementations as needed              |
| Breaking wire or transport change                            | Protocol major and a coordinated release                             |

## Releases

Merging a normal pull request does not publish anything. Changesets creates or updates a release
pull request on `main`, where further Changesets accumulate. When a maintainer is ready, merging
that release pull request publishes a changed TypeScript SDK to npm and a changed Python SDK to
PyPI.

TypeScript and Python do not have to be bumped together. The Python version stays in sync only with
its own `pyproject.toml` and the SDK entry in the root `uv.lock`.

Two consequences are worth knowing before you plan a change:

- The extension is embedded in each SDK rather than published separately, so an SDK release is what
  delivers an extension fix to users.
- The release workflow does not create Go module tags. A Go release is tagged separately, with the
  version from [`packages/sdk-go/package.json`](https://github.com/browserbase/stagehand/blob/v4-go/packages/sdk-go/package.json).

The protocol package is versioned for compatibility tracking and is never published.

## Preview builds

Add the `preview` label to a pull request to build the TypeScript package, the Python wheel, and the
extension ZIP without publishing them. The workflow keeps one authenticated artifact and one comment
up to date with the pull request. Artifacts expire after 30 days, so push a commit or remove and
reapply the label to refresh one. Removing the label or closing the pull request removes both.

Previews do not change committed versions or changelogs, publish a release, or deploy a Browserbase
environment.
