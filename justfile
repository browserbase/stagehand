python_dir := "packages/sdk-python"
go_dir := "packages/sdk-go"
go_generator_dir := "packages/sdk-go/internal/generator"

install:
    pnpm install
    uv --directory {{python_dir}} sync --locked
    go -C {{go_dir}} mod download
    go -C {{go_generator_dir}} mod download

generate:
    pnpm --filter ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py
    pnpm --filter ./packages/server build
    go -C {{go_dir}} generate ./...

check: check-go-examples
    pnpm exec tsx scripts/release/check-changesets.ts
    pnpm exec tsx scripts/release/consolidate-changelogs.ts --check
    pnpm exec tsx scripts/release/sync-python-version.ts --check
    pnpm check
    uv --directory {{python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check
    go -C {{go_generator_dir}} run . --check
    pnpm --filter ./packages/server build
    go -C {{go_dir}} run ./internal/extensionpack --check
    test -z "$(find {{go_dir}} -name '*.go' -type f -exec gofmt -l {} +)"
    go -C {{go_dir}} vet $(go -C {{go_dir}} list ./... | grep -v '/examples$')
    go -C {{go_generator_dir}} vet ./...

check-go-examples:
    sh {{go_dir}}/scripts/check-examples.sh

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest
    go -C {{go_dir}} test $(go -C {{go_dir}} list ./... | grep -v '/examples$')
    go -C {{go_generator_dir}} test ./...

docs:
    pnpm run docs

example name="act":
    pnpm --filter ./packages/server build
    pnpm --filter ./packages/sdk-ts build
    pnpm exec tsx "packages/sdk-ts/examples/{{name}}.ts"

go-example name="act":
    go -C {{go_dir}} run "./examples/{{name}}"

fmt:
    pnpm fmt
    uv --directory {{python_dir}} run --locked ruff check --fix .
    uv --directory {{python_dir}} run --locked ruff format .
    find {{go_dir}} -name '*.go' -type f -exec gofmt -w {} +

build:
    pnpm build
    uv --directory {{python_dir}} run --locked python scripts/build.py
    go -C {{go_dir}} run ./internal/extensionpack --check
    go -C {{go_dir}} build $(go -C {{go_dir}} list ./... | grep -v '/examples$')
    go -C {{go_generator_dir}} test -run '^$' ./...

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

_publish-typescript:
    pnpm --filter ./packages/sdk-ts build
    pnpm exec changeset publish
