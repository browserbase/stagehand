#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Clone the repository
git clone https://github.com/navidkpr/bananalyzer
git -C bananalyzer checkout  # In case the repo has a bad commit
# Manually update the hash once in a while

# Copy the static folder to the script's directory
rm -rf "$SCRIPT_DIR/static"
cp -r bananalyzer/static "$SCRIPT_DIR"

# Remove the cloned repository
rm -rf bananalyzer