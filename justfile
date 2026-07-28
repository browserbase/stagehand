python_dir := "packages/sdk-python"

install:
    pnpm install
    uv --directory {{python_dir}} sync --locked

generate:
    pnpm --filter ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py

check:
    pnpm exec tsx scripts/release/check-changesets.ts
    pnpm exec tsx scripts/release/consolidate-changelogs.ts --check
    pnpm exec tsx scripts/release/sync-python-version.ts --check
    pnpm check
    uv --directory {{python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest

docs:
    pnpm run docs

example name="act":
    pnpm --filter ./packages/server build
    pnpm --filter ./packages/sdk-ts build
    pnpm exec tsx "packages/sdk-ts/examples/{{name}}.ts"

fmt:
    pnpm fmt
    uv --directory {{python_dir}} run --locked ruff check --fix .
    uv --directory {{python_dir}} run --locked ruff format .

build:
    pnpm build
    uv --directory {{python_dir}} run --locked python scripts/build.py

changeset:
    pnpm exec changeset

# Prefixed with `_` because this internal recipe is only used to generate release versions and changelogs.
_version:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
        export GITHUB_TOKEN="$(gh auth token)"
    fi
    pnpm exec changeset version
    pnpm exec tsx scripts/release/consolidate-changelogs.ts
    pnpm exec tsx scripts/release/sync-python-version.ts
    uv --directory "{{python_dir}}" lock
    pnpm exec tsx scripts/release/sync-python-version.ts --check

# Builds the commit-addressed bundle used by labeled pull request previews.
_preview commit:
    pnpm exec tsx scripts/release/build-preview.ts "{{commit}}"

_publish-typescript:
    pnpm --filter ./packages/sdk-ts build
    pnpm exec changeset publish
