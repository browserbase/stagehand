import fs from "node:fs";
import process from "node:process";
import { build } from "esbuild";

const pkgJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url)),
);
const externalDeps = Array.from(
  new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
    ...Object.keys(pkgJson.optionalDependencies ?? {}),
  ]),
);

const commonOptions = {
  bundle: true,
  platform: "node",
  target: "es2022",
  sourcemap: true,
  banner: {
    js: "var __name = (target, value) => { try { Object.defineProperty(target, 'name', { value, configurable: true }); } catch {} return target; };",
  },
  packages: "external",
  external: externalDeps,
};

async function main() {
  await build({
    entryPoints: ["lib/index.ts"],
    format: "esm",
    outfile: "dist/index.js",
    ...commonOptions,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
