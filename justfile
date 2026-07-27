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

check:
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
    go -C {{go_dir}} vet ./...
    go -C {{go_generator_dir}} vet ./...

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest
    go -C {{go_dir}} test ./...
    go -C {{go_generator_dir}} test ./...

# TODO(docs-migration): Re-enable after restoring v3 docs in Stagehand.
# docs:
#     pnpm docs

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
    go -C {{go_dir}} build ./...
    go -C {{go_generator_dir}} build -o /dev/null .
