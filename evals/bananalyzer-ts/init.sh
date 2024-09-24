#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Clone the repository
git clone https://github.com/reworkd/bananalyzer.git

# Copy the static folder to the script's directory
rm -rf "$SCRIPT_DIR/static"
cp -r bananalyzer/static "$SCRIPT_DIR"

# Remove the cloned repository
rm -rf bananalyzer