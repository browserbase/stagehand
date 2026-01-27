#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(pkgDir, "../..");
const distDir = path.join(pkgDir, "dist", "sea");
const blobPath = path.join(distDir, "sea-prep.blob");

const targetPlatform = process.env.SEA_TARGET_PLATFORM ?? process.platform;
const targetArch = process.env.SEA_TARGET_ARCH ?? process.arch;
const binaryName =
  process.env.SEA_BINARY_NAME ??
  `stagehand-server-${targetPlatform}-${targetArch}${targetPlatform === "win32" ? ".exe" : ""}`;
const sourcemapMode = process.env.SEA_SOURCEMAP ?? "";

const run = (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
};

const runOptional = (
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
) => {
  spawnSync(cmd, args, { stdio: "ignore", ...opts });
};

const download = (url: string, dest: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect without location: ${url}`));
            return;
          }
          download(location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}) ${url}`));
          res.resume();
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });

const resolveNodeBinary = async (): Promise<string> => {
  if (targetPlatform === process.platform && targetArch === process.arch) {
    return process.execPath;
  }

  const version = process.version;
  const distPlatform = targetPlatform === "win32" ? "win" : targetPlatform;
  const archiveBase = `node-${version}-${distPlatform}-${targetArch}`;
  const archiveExt = distPlatform === "win" ? "zip" : "tar.xz";
  const tmpRoot = path.join(os.tmpdir(), "stagehand-sea", archiveBase);
  const archivePath = path.join(tmpRoot, `${archiveBase}.${archiveExt}`);
  const extractRoot = path.join(tmpRoot, archiveBase);
  const binaryPath =
    distPlatform === "win"
      ? path.join(extractRoot, "node.exe")
      : path.join(extractRoot, "bin", "node");

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  fs.mkdirSync(tmpRoot, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    const url = `https://nodejs.org/dist/${version}/${archiveBase}.${archiveExt}`;
    await download(url, archivePath);
  }
  run("tar", ["-xf", archivePath, "-C", tmpRoot]);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing Node binary at ${binaryPath}`);
  }
  return binaryPath;
};

const main = async () => {
  fs.mkdirSync(distDir, { recursive: true });

  run("pnpm", ["--filter", "@browserbasehq/stagehand", "build"], {
    cwd: repoDir,
  });

  const esbuildArgs = [
    "exec",
    "esbuild",
    "src/server.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=dist/sea/bundle.cjs",
    "--log-level=warning",
  ];
  if (sourcemapMode) {
    esbuildArgs.push(`--sourcemap=${sourcemapMode}`);
  }
  run("pnpm", esbuildArgs, { cwd: pkgDir });

  run("node", ["--experimental-sea-config", "sea-config.json"], {
    cwd: pkgDir,
  });
  if (!fs.existsSync(blobPath)) {
    throw new Error(`Missing ${blobPath}; SEA blob generation failed.`);
  }

  const nodeBinary = await resolveNodeBinary();
  const outPath = path.join(distDir, binaryName);
  fs.copyFileSync(nodeBinary, outPath);
  if (targetPlatform !== "win32") {
    fs.chmodSync(outPath, 0o755);
  }

  if (targetPlatform === "darwin") {
    runOptional("codesign", ["--remove-signature", outPath]);
  }

  const postjectArgs = [
    "exec",
    "postject",
    outPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (targetPlatform === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  run("pnpm", postjectArgs, { cwd: pkgDir });

  if (targetPlatform === "darwin") {
    runOptional("codesign", ["--sign", "-", outPath]);
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
