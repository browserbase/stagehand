const esbuild = require('esbuild');
const { peerDependencies, dependencies } = require('./package.json');

const externals = Object.keys(peerDependencies).concat(
  Object.keys(dependencies)
);

esbuild
  .build({
    entryPoints: ['lib/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/index.js',
    sourcemap: false,
    external: externals,
  })
  .catch(() => process.exit(1));
