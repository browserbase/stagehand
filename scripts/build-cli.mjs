import process from "node:process";
import { build } from "esbuild";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const pkgJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const externalDeps = Array.from(
  new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
    ...Object.keys(pkgJson.optionalDependencies ?? {}),
  ]),
);

const distDir = path.join("dist", "evals");
const cliOutfile = path.join(distDir, "cli.js");
const configSource = path.join("evals", "evals.config.json");
const configDestination = path.join(distDir, "evals.config.json");

const commonOptions = {
  bundle: true,
  platform: "node",
  target: "es2022",
  sourcemap: true,
  packages: "external",
  external: externalDeps,
};

const shouldLink = (() => {
  const flag = process.env.STAGEHAND_SKIP_NPM_LINK ?? "";
  return flag !== "1" && flag.toLowerCase() !== "true";
})();

async function main() {
  mkdirSync(distDir, { recursive: true });

  await build({
    entryPoints: ["evals/cli.ts"],
    format: "cjs",
    outfile: cliOutfile,
    banner: { js: "#!/usr/bin/env node" },
    ...commonOptions,
  });

  copyFileSync(configSource, configDestination);

  try {
    chmodSync(cliOutfile, 0o755);
  } catch (error) {
    const maybeSystemError = error;
    if (
      !maybeSystemError ||
      typeof maybeSystemError !== "object" ||
      !("code" in maybeSystemError) ||
      (maybeSystemError.code !== "ENOSYS" && maybeSystemError.code !== "EPERM")
    ) {
      throw error;
    }
  }

  if (!shouldLink) {
    console.warn("Skipping npm link because STAGEHAND_SKIP_NPM_LINK is set.");
    return;
  }

  const linkResult = spawnSync("npm", ["link"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (linkResult.status !== 0) {
    process.exit(linkResult.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
