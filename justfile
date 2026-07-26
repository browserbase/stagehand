python_dir := "packages/sdk-python"

install:
    pnpm install
    uv --directory {{python_dir}} sync --locked

generate:
    pnpm --filter ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py

# Adds a model to the curated catalog, then regenerates and validates shared SDK artifacts.
# This never commits, publishes, or deploys a release.
add-model model:
    pnpm exec tsx scripts/add-model.ts {{model}}
    just generate
    just check

check:
    pnpm check
    uv --directory {{python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check

test:
    pnpm test
    uv --directory {{python_dir}} run --locked pytest

# TODO(docs-migration): Re-enable after restoring v3 docs in Stagehand.
# docs:
#     pnpm docs

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
