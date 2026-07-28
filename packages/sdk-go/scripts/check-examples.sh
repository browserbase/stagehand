#!/usr/bin/env sh

set -eu

sdk_dir=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
output_dir=$(mktemp -d "${TMPDIR:-/tmp}/stagehand-go-examples.XXXXXX")
trap 'rm -rf "$output_dir"' 0 HUP INT TERM

for example in "$sdk_dir"/examples/*.go; do
  name=$(basename "$example" .go)
  go -C "$sdk_dir" vet "examples/$name.go"
  go -C "$sdk_dir" build -o "$output_dir/$name" "examples/$name.go"
done
