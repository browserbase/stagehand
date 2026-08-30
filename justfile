python_dir := "packages/sdk-python"
ruby_dir := "packages/sdk-ruby"
go_dir := "packages/sdk-go"
go_generator_dir := "packages/sdk-go/internal/generator"

install:
    pnpm install
    uv --directory {{python_dir}} sync --locked
    cd {{ruby_dir}} && bundle install
    go -C {{go_dir}} mod download
    go -C {{go_generator_dir}} mod download

generate:
    pnpm --filter ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py
    ruby packages/sdk-ruby/scripts/generate.rb
    pnpm --filter ./packages/extension build
    go -C {{go_dir}} generate ./...

check: check-go-examples
    pnpm exec tsx scripts/release/check-changesets.ts
    pnpm exec tsx scripts/release/consolidate-changelogs.ts --check
    pnpm exec tsx scripts/release/sync-python-version.ts --check
    pnpm exec tsx scripts/release/sync-ruby-version.ts --check
    pnpm check
    uv --directory {{python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    ruby packages/sdk-ruby/scripts/generate.rb --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check
    go -C {{go_generator_dir}} run . --check
    pnpm --filter ./packages/extension build
    go -C {{go_dir}} run ./internal/extensionpack --check
    test -z "$(find {{go_dir}} -name '*.go' -type f -exec gofmt -l {} +)"
    go -C {{go_dir}} vet $(go -C {{go_dir}} list ./... | grep -v '/examples$')
    go -C {{go_generator_dir}} vet ./...

check-go-examples:
    sh {{go_dir}}/scripts/check-examples.sh

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest
    cd {{ruby_dir}} && bundle exec rake
    go -C {{go_dir}} test $(go -C {{go_dir}} list ./... | grep -v '/examples$')
    go -C {{go_generator_dir}} test ./...

docs:
    pnpm run docs

example name="act":
    pnpm --filter ./packages/extension build
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
    ruby {{ruby_dir}}/scripts/build.rb
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
    pnpm exec tsx scripts/release/sync-ruby-version.ts
    uv --directory "{{python_dir}}" lock
    just generate
    pnpm exec tsx scripts/release/sync-python-version.ts --check
    pnpm exec tsx scripts/release/sync-ruby-version.ts --check

# Builds the commit-addressed bundle used by labeled pull request previews.
_preview commit:
    pnpm exec tsx scripts/release/build-preview.ts "{{commit}}"

_publish-typescript:
    pnpm --filter ./packages/sdk-ts build
    pnpm exec changeset publish

# Publishes a commit-addressed alpha of the TypeScript SDK (`<next>-alpha-<sha>`)
# under the `alpha` dist-tag. Only packages with pending changesets are versioned,
# so this is a no-op when nothing is unreleased.
_publish-typescript-alpha:
    pnpm exec changeset version --snapshot
    pnpm --filter ./packages/sdk-ts build
    pnpm exec changeset publish --tag alpha --no-git-tag

# Rewrites the Python project to the commit-addressed alpha (`<next>a0.dev<N>`)
# derived from the changesets snapshot version. Nothing is committed; the
# working tree is discarded after publishing.
_version-python-alpha:
    pnpm exec changeset version --snapshot
    pnpm exec tsx scripts/release/python-alpha-version.ts
    uv --directory "{{python_dir}}" lock

# Rewrites the Ruby gem version to the commit-addressed alpha
# (`<next>.pre.alpha.<N>`) derived from the changesets snapshot version.
# Nothing is committed; the working tree is discarded after publishing.
_version-ruby-alpha:
    pnpm exec changeset version --snapshot
    pnpm exec tsx scripts/release/ruby-alpha-version.ts
