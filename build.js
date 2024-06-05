const esbuild = require('esbuild');
const { dependencies } = require('./package.json');

const externals = Object.keys(dependencies);

esbuild
  .build({
    entryPoints: ['lib/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/index.js',
    sourcemap: true,
    external: externals,
  })
  .catch(() => process.exit(1));
