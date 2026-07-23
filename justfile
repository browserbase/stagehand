python_dir := "packages/sdk-python"

install:
    vp install
    uv --directory {{python_dir}} sync --locked

generate:
    vp run -F ./packages/protocol build
    uv --directory {{python_dir}} run --locked python scripts/generate.py

check:
    vp run check
    uv --directory {{python_dir}} lock --check
    uv --directory {{python_dir}} run --locked python scripts/generate.py --check
    uv --directory {{python_dir}} run --locked ruff format --check .
    uv --directory {{python_dir}} run --locked ruff check .
    uv --directory {{python_dir}} run --locked ty check

test:
    vp run test
    uv --directory {{python_dir}} run --locked pytest

docs:
    vp run docs

example name="act":
    vp run -F ./packages/sdk-ts build
    vp exec tsx "packages/sdk-ts/examples/{{name}}.ts"

fmt:
    vp run fmt
    uv --directory {{python_dir}} run --locked ruff check --fix .
    uv --directory {{python_dir}} run --locked ruff format .

build:
    vp run build
    uv --directory {{python_dir}} run --locked python scripts/build.py
