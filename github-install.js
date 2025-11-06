#!/usr/bin/env node

/**
 * This script is run when the package is installed from GitHub.
 * It installs the dependencies from packages/core and builds the project.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Only run when installed from GitHub (not in dev environment)
if (fs.existsSync('.git')) {
  console.log('Development environment detected, skipping GitHub install setup.');
  process.exit(0);
}

const coreDir = path.join(__dirname, 'packages', 'core');

if (!fs.existsSync(coreDir)) {
  console.error('packages/core directory not found!');
  process.exit(1);
}

console.log('📦 Installing Stagehand from GitHub...');

try {
  // Read the core package.json to get dependencies
  const corePkgPath = path.join(coreDir, 'package.json');
  const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8'));

  // Combine dependencies and peerDependencies
  const allDeps = {
    ...corePkg.dependencies,
    ...corePkg.peerDependencies
  };

  // Install dependencies at the root level
  console.log('📥 Installing dependencies...');
  const depList = Object.entries(allDeps)
    .map(([name, version]) => `${name}@${version}`)
    .join(' ');

  execSync(`npm install --no-save --no-package-lock ${depList}`, {
    cwd: __dirname,
    stdio: 'inherit'
  });

  // Build the core package
  console.log('🔨 Building packages/core...');
  execSync('npm run build', {
    cwd: coreDir,
    stdio: 'inherit'
  });

  console.log('✅ Stagehand installation complete!');
} catch (error) {
  console.error('❌ Installation failed:', error.message);
  process.exit(1);
}