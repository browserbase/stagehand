# Stagehand

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

## Contributing

Before opening a pull request, run:

```bash
just check
just test
```

After the initial v4 release, pull requests that change a released package should
include release intent with `just changeset`. Package versions, previews, and
publishing are coordinated from the root workflow; see
[RELEASING.md](./RELEASING.md) for the complete lifecycle.
