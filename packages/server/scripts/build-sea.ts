#!/usr/bin/env node
/**
 * Build SEA binary from ESM (test) or CJS (release) bundles.
 *
 * Prereqs:
 * - CJS mode: runs core CJS build via Turbo if dist is missing (pnpm exec turbo run build --filter @browserbasehq/stagehand).
 * - ESM mode: core dist/esm available (pnpm run build:esm).
 * - postject installed; tar available for non-Windows downloads.
 *
 * Args: --mode=esm|cjs --target-platform=<platform> --target-arch=<arch> --binary-name=<name>
 * Env: SEA_BUILD_MODE, SEA_TARGET_PLATFORM, SEA_TARGET_ARCH, SEA_BINARY_NAME.
 * Example: pnpm run build:sea:cjs -- --target-platform=linux --target-arch=arm64
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { pathToFileURL } from "node:url";
import { findRepoRoot } from "../../core/scripts/test-utils";

const repoDir = findRepoRoot(process.cwd());
const pkgDir = path.join(repoDir, "packages", "server");
const distDir = path.join(pkgDir, "dist");
const seaDir = path.join(distDir, "sea");
const blobPath = path.join(seaDir, "sea-prep.blob");
const coreEsmEntry = path.join(
  repoDir,
  "packages",
  "core",
  "dist",
  "esm",
  "index.js",
);

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === `--${name}` && process.argv[i + 1]) return process.argv[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
};

const mode = (
  argValue("mode") ??
  process.env.SEA_BUILD_MODE ??
  "esm"
).toLowerCase();
const targetPlatform =
  argValue("target-platform") ??
  argValue("platform") ??
  process.env.SEA_TARGET_PLATFORM ??
  process.platform;
const targetArch =
  argValue("target-arch") ??
  argValue("arch") ??
  process.env.SEA_TARGET_ARCH ??
  process.arch;
const binaryName =
  argValue("binary-name") ??
  process.env.SEA_BINARY_NAME ??
  `stagehand-server-${targetPlatform}-${targetArch}${targetPlatform === "win32" ? ".exe" : ""}`;

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
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect without location: ${url}`));
            return;
          }
          res.resume();
          download(location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}) ${url}`));
          res.resume();
          return;
        }

        const file = fs.createWriteStream(dest);
        const fail = (error: Error) => {
          file.destroy();
          reject(error);
        };

        res.on("error", fail);
        file.on("error", fail);
        file.on("finish", () => {
          file.close((closeError) => {
            if (closeError) {
              reject(closeError);
              return;
            }
            resolve();
          });
        });
        res.pipe(file);
      })
      .on("error", reject);
  });

const resolveNodeBinary = async (): Promise<string> => {
  if (targetPlatform !== process.platform) {
    throw new Error(
      `Cross-platform builds are not supported. Host=${process.platform}, target=${targetPlatform}`,
    );
  }
  if (targetArch === process.arch) {
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

  if (archiveExt === "zip") {
    if (process.platform !== "win32") {
      throw new Error("Windows binaries must be built on Windows runners.");
    }
    run("powershell", [
      "-Command",
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpRoot}' -Force`,
    ]);
  } else {
    run("tar", ["-xf", archivePath, "-C", tmpRoot]);
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing Node binary at ${binaryPath}`);
  }
  return binaryPath;
};

const writeSeaConfig = (
  mainPath: string,
  outputPath: string,
  execArgvExtension?: string,
) => {
  const configPath = path.join(seaDir, `sea-config-${mode}.json`);
  const config = {
    main: path.relative(pkgDir, mainPath).split(path.sep).join("/"),
    output: path.relative(pkgDir, outputPath).split(path.sep).join("/"),
    ...(execArgvExtension ? { execArgvExtension } : {}),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
};

const buildCjsBundle = () => {
  run(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build:cjs",
      "--filter",
      "@browserbasehq/stagehand",
    ],
    { cwd: repoDir },
  );
  fs.mkdirSync(seaDir, { recursive: true });
  const bundlePath = path.join(seaDir, "bundle.cjs");
  run(
    "pnpm",
    [
      "exec",
      "esbuild",
      "packages/server/src/server.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${bundlePath}`,
      "--log-level=warning",
    ],
    { cwd: repoDir },
  );
  return bundlePath;
};

const buildEsmBundle = () => {
  if (!fs.existsSync(coreEsmEntry)) {
    throw new Error(`Missing ${coreEsmEntry}. Run pnpm run build:esm first.`);
  }

  fs.mkdirSync(seaDir, { recursive: true });
  const appBundlePath = path.join(distDir, "app.mjs");
  const esbuildArgs = [
    "exec",
    "esbuild",
    "packages/server/src/server.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--tree-shaking=false",
    `--outfile=${appBundlePath}`,
    `--alias:@browserbasehq/stagehand=${coreEsmEntry}`,
    "--sourcemap=inline",
    "--sources-content",
    `--source-root=${repoDir}`,
    '--banner:js=import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    "--log-level=warning",
  ];
  run("pnpm", esbuildArgs, { cwd: repoDir });

  const appSource = fs.readFileSync(appBundlePath, "utf8");
  const mapMatch = appSource.match(
    /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/,
  );
  if (!mapMatch) {
    throw new Error("Missing inline sourcemap in dist/app.mjs");
  }
  const mapJson = Buffer.from(mapMatch[1], "base64").toString("utf8");
  const map = JSON.parse(mapJson) as {
    sourceRoot?: string;
    sources: string[];
    sourcesContent?: string[];
  };
  const toPosix = (value: string) => value.split(path.sep).join("/");
  const fileUrlToPathSafe = (value: string) => {
    const parsed = new URL(value);
    let pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  };
  const toRepoRelative = (source: string) => {
    let sourcePath = source;
    if (source.startsWith("file://")) {
      sourcePath = fileUrlToPathSafe(source);
    }

    if (path.isAbsolute(sourcePath)) {
      if (sourcePath.startsWith(repoDir + path.sep)) {
        return toPosix(path.relative(repoDir, sourcePath));
      }
      return toPosix(sourcePath);
    }

    if (sourcePath.startsWith("../src/")) {
      const rel = sourcePath.slice("../src/".length);
      return toPosix(path.join("packages", "server", "src", rel));
    }
    if (sourcePath.startsWith("../../core/")) {
      const rel = sourcePath.slice("../../core/".length);
      return toPosix(path.join("packages", "core", rel));
    }
    if (sourcePath.startsWith("../../../node_modules/")) {
      const rel = sourcePath.slice("../../../node_modules/".length);
      return toPosix(path.join("node_modules", rel));
    }
    if (sourcePath.startsWith("src/")) {
      const rel = sourcePath.slice("src/".length);
      return toPosix(path.join("packages", "server", "src", rel));
    }
    if (sourcePath.startsWith("../node_modules/")) {
      const rel = sourcePath.slice("../node_modules/".length);
      return toPosix(path.join("node_modules", rel));
    }
    if (sourcePath.startsWith("../core/")) {
      const rel = sourcePath.slice("../core/".length);
      return toPosix(path.join("packages", "core", rel));
    }
    if (sourcePath.startsWith("core/")) {
      return toPosix(
        path.join("packages", "core", sourcePath.slice("core/".length)),
      );
    }
    if (
      sourcePath.startsWith("packages/") ||
      sourcePath.startsWith("node_modules/")
    ) {
      return toPosix(sourcePath);
    }

    const resolved = path.resolve(pkgDir, sourcePath);
    if (resolved.startsWith(repoDir + path.sep)) {
      return toPosix(path.relative(repoDir, resolved));
    }

    return toPosix(sourcePath);
  };

  map.sourceRoot = pathToFileURL(`${repoDir}${path.sep}`).href;
  map.sources = map.sources.map(toRepoRelative);
  const updatedMap = Buffer.from(JSON.stringify(map)).toString("base64");
  const appSourceUpdated = appSource.replace(mapMatch[1], updatedMap);
  fs.writeFileSync(appBundlePath, appSourceUpdated);

  const appBytes = Buffer.from(appSourceUpdated);
  const bundleHash = createHash("sha256")
    .update(appBytes)
    .digest("hex")
    .slice(0, 12);
  const bootstrapPath = path.join(seaDir, "sea-bootstrap.cjs");
  const bootstrap = `/* eslint-disable */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const bundleBase64 = ${JSON.stringify(appBytes.toString("base64"))};
const bundleLength = ${appBytes.length};
const bundleHash = ${JSON.stringify(bundleHash)};

const cacheRoot =
  process.env.STAGEHAND_SEA_CACHE_DIR ||
  path.join(os.tmpdir(), "stagehand-server-sea");
const cacheDir = path.join(cacheRoot, bundleHash);
const appPath = path.join(cacheDir, "app.mjs");

fs.mkdirSync(cacheDir, { recursive: true });
let needsWrite = true;
try {
  const stat = fs.statSync(appPath);
  needsWrite = stat.size !== bundleLength;
} catch {}

if (needsWrite) {
  const tmpPath = path.join(
    cacheDir,
    "app.mjs.tmp-" + process.pid + "-" + Date.now().toString(16),
  );
  fs.writeFileSync(tmpPath, Buffer.from(bundleBase64, "base64"));
  try {
    fs.renameSync(tmpPath, appPath);
  } catch (err) {
    if (!fs.existsSync(appPath)) throw err;
  }
  try {
    fs.chmodSync(appPath, 0o500);
  } catch {}
}

(async () => {
  await import(pathToFileURL(appPath).href);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
`;
  fs.writeFileSync(bootstrapPath, bootstrap);
  return bootstrapPath;
};

const main = async () => {
  fs.mkdirSync(seaDir, { recursive: true });

  let mainPath: string;
  let execArgvExtension: string | undefined;

  if (mode === "cjs") {
    mainPath = buildCjsBundle();
  } else if (mode === "esm") {
    mainPath = buildEsmBundle();
    execArgvExtension = "cli";
  } else {
    throw new Error(`Unknown SEA build mode: ${mode}`);
  }

  const seaConfigPath = writeSeaConfig(mainPath, blobPath, execArgvExtension);

  run("node", ["--experimental-sea-config", seaConfigPath], { cwd: pkgDir });
  if (!fs.existsSync(blobPath)) {
    throw new Error(`Missing ${blobPath}; SEA blob generation failed.`);
  }

  const nodeBinary = await resolveNodeBinary();
  const outPath = path.join(seaDir, binaryName);
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
