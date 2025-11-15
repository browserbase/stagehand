#!/usr/bin/env node

/**
 * Postinstall script for @browserbasehq/stagehand
 * 
 * This script runs after package installation (e.g., via gitpkg) to ensure
 * the package is built if dist files don't exist.
 */

const fs = require("fs");
const path = require("path");
const { exec, execSync } = require("child_process");

const distPath = path.join(__dirname, "..", "dist", "index.js");

// Check if dist files already exist
if (fs.existsSync(distPath)) {
  console.log("✓ @browserbasehq/stagehand already built");
  process.exit(0);
}

console.log("Building @browserbasehq/stagehand...");

// Determine which package manager to use
// Check if pnpm is available, otherwise fall back to npm
let pkgManager = "npm";
try {
  execSync("pnpm --version", { stdio: "ignore" });
  pkgManager = "pnpm";
} catch {
  // pnpm not available, use npm
}

const buildCommand = `${pkgManager} run build`;

// Run the build command
exec(buildCommand, { cwd: path.join(__dirname, "..") }, (error, stdout, stderr) => {
  if (error) {
    console.error("✗ Build failed:", stderr);
    console.error("Note: Make sure devDependencies are installed");
    process.exit(1);
  }
  
  if (stdout) {
    console.log(stdout);
  }
  
  console.log("✓ Build complete");
  process.exit(0);
});

