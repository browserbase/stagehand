#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Clone the repository
git clone https://github.com/reworkd/bananalyzer.git
git -C bananalyzer checkout 49038a5619616893034385a9c07f3ac40d7a8b8d # In case the repo has a bad commit
# Manually update the hash once in a while

# Copy the static folder to the script's directory
rm -rf "$SCRIPT_DIR/static"
cp -r bananalyzer/static "$SCRIPT_DIR"

# Remove the cloned repository
rm -rf bananalyzer