# Stagehand

**This directory is a SELF-CONTAINED pnpm 11 workspace, separate from the repository root workspace (which uses pnpm 9 + turbo). Run all pnpm, vp, and just commands for these packages FROM `v4/`; they resolve the nearest `pnpm-workspace.yaml`. Running `pnpm install` at the repository root does NOT install these packages' dependencies—run `pnpm install` (pnpm 11) or `just install` inside `v4/`.**

Stagehand is the AI browser automation framework.

## Setup

Install [Vite+](https://viteplus.dev/guide/), [just](https://github.com/casey/just), and [uv](https://docs.astral.sh/uv/):

```bash
curl -fsSL https://vite.plus | bash
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
