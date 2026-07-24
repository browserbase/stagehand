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

Package metadata is the source of truth for versions. The private Python
`package.json` lets Changesets version the public `stagehand` package; CI copies
that version into `pyproject.toml` and updates `uv.lock`.

After the initial v4 release, use `just changeset` when a pull request changes a
public SDK or the protocol compatibility contract. Tests, documentation,
formatting, and internal refactors do not need a Changeset.

Changesets maintains the release pull request on `main`. Merging it publishes the
TypeScript SDK to npm and the Python SDK to PyPI. Underscored `just` recipes are
internal CI commands.
