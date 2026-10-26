python_dir := "packages/sdk-python"
integrations_python_dir := "packages/integrations/core/python"

install:
    pnpm install
    uv --directory {{python_dir}} sync --locked

generate:
    pnpm --filter ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py
    uv --directory {{python_dir}} run --locked ty check
    pnpm --filter ./packages/extension build

check:
    pnpm exec tsx scripts/release/check-changesets.ts
    pnpm exec tsx scripts/release/consolidate-changelogs.ts --check
    pnpm exec tsx scripts/release/sync-python-version.ts --check
    pnpm check
    uv --directory {{python_dir}} lock --check
    uv --directory {{integrations_python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check
    pnpm --filter ./packages/extension build

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest

docs:
    pnpm run docs

example name="act":
    pnpm --filter ./packages/extension build
    pnpm --filter ./packages/sdk-ts build
    pnpm exec tsx "packages/sdk-ts/examples/{{name}}.ts"

showcase slug *args:
    pnpm --filter ./packages/extension build
    pnpm --filter ./packages/sdk-ts build
    pnpm --filter ./packages/integrations/core build
    pnpm exec tsx packages/examples/showcase/_harness/run.ts {{slug}} {{args}}

showcase-script slug:
    pnpm --filter ./packages/extension build
    pnpm --filter ./packages/sdk-ts build
    pnpm exec tsx packages/examples/showcase/{{slug}}/index.ts

cookbook slug:
    pnpm --dir "packages/examples/cookbooks/{{slug}}/typescript" start

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
    pnpm exec tsx scripts/release/scoped-release.ts version sdk
    pnpm exec tsx scripts/release/consolidate-changelogs.ts
    pnpm exec tsx scripts/release/sync-python-version.ts
    uv --directory "{{python_dir}}" lock
    # Its lockfile pins the editable sdk-python, whose version just changed.
    uv --directory "{{integrations_python_dir}}" lock
    just generate
    pnpm exec tsx scripts/release/sync-python-version.ts --check

# Builds the commit-addressed bundle used by labeled pull request previews.
_preview commit:
    pnpm exec tsx scripts/release/build-preview.ts "{{commit}}"

_publish-typescript:
    pnpm --filter ./packages/sdk-ts build
    pnpm --filter @browserbasehq/eve build
    pnpm exec tsx scripts/release/scoped-release.ts publish sdk

# Publishes a commit-addressed alpha of the TypeScript SDK (`<next>-alpha-<sha>`)
# under the `alpha` dist-tag. Only packages with pending changesets are versioned,
# so this is a no-op when nothing is unreleased.
_publish-typescript-alpha:
    pnpm exec tsx scripts/release/scoped-release.ts version sdk --snapshot
    pnpm --filter ./packages/sdk-ts build
    pnpm exec tsx scripts/release/scoped-release.ts publish sdk --alpha

# Rewrites the Python project to the commit-addressed alpha (`<next>a0.dev<N>`)
# derived from the changesets snapshot version. Nothing is committed; the
# working tree is discarded after publishing.
_version-python-alpha:
    pnpm exec tsx scripts/release/scoped-release.ts version sdk --snapshot
    pnpm exec tsx scripts/release/python-alpha-version.ts
    uv --directory "{{python_dir}}" lock
    uv --directory "{{python_dir}}" run --locked python scripts/generate.py
