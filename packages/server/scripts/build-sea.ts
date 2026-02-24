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
import { fileURLToPath, pathToFileURL } from "node:url";

const repoDir = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/server/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

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

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const run = (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.error) {
    throw new Error(
      `Command failed to start: ${cmd} ${args.join(" ")}\n${String(result.error)}`,
    );
  }
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
  const tmpRoot = `${os.tmpdir()}/stagehand-sea/${archiveBase}`;
  const archivePath = `${tmpRoot}/${archiveBase}.${archiveExt}`;
  const extractRoot = `${tmpRoot}/${archiveBase}`;
  const binaryPath =
    distPlatform === "win"
      ? `${extractRoot}/node.exe`
      : `${extractRoot}/bin/node`;

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
  const configPath = `${repoDir}/packages/server/dist/sea/sea-config-${mode}.json`;
  const config = {
    main: path
      .relative(`${repoDir}/packages/server`, mainPath)
      .replaceAll("\\", "/"),
    output: path
      .relative(`${repoDir}/packages/server`, outputPath)
      .replaceAll("\\", "/"),
    ...(execArgvExtension ? { execArgvExtension } : {}),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
};

const buildCjsBundle = () => {
  run(
    pnpmCommand,
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
  fs.mkdirSync(`${repoDir}/packages/server/dist/sea`, { recursive: true });
  const bundlePath = `${repoDir}/packages/server/dist/sea/bundle.cjs`;
  run(
    pnpmCommand,
    [
      "exec",
      "esbuild",
      "packages/server/src/sea-entry.ts",
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
  if (!fs.existsSync(`${repoDir}/packages/core/dist/esm/index.js`)) {
    throw new Error(
      `Missing ${repoDir}/packages/core/dist/esm/index.js. Run pnpm run build:esm first.`,
    );
  }

  fs.mkdirSync(`${repoDir}/packages/server/dist/sea`, { recursive: true });
  const appBundlePath = `${repoDir}/packages/server/dist/app.mjs`;
  const esbuildArgs = [
    "exec",
    "esbuild",
    "packages/server/src/sea-entry.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--tree-shaking=false",
    `--outfile=${appBundlePath}`,
    `--alias:@browserbasehq/stagehand=${repoDir}/packages/core/dist/esm/index.js`,
    "--sourcemap=inline",
    "--sources-content",
    `--source-root=${repoDir}`,
    '--banner:js=import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    "--log-level=warning",
  ];
  run(pnpmCommand, esbuildArgs, { cwd: repoDir });

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
  const toPosix = (value: string) => value.replaceAll("\\", "/");
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
      const normalizedSourcePath = toPosix(sourcePath);
      if (normalizedSourcePath.startsWith(`${repoDir}/`)) {
        return toPosix(path.relative(repoDir, normalizedSourcePath));
      }
      return normalizedSourcePath;
    }

    if (sourcePath.startsWith("../src/")) {
      const rel = sourcePath.slice("../src/".length);
      return `packages/server/src/${rel}`;
    }
    if (sourcePath.startsWith("../../core/")) {
      const rel = sourcePath.slice("../../core/".length);
      return `packages/core/${rel}`;
    }
    if (sourcePath.startsWith("../../../node_modules/")) {
      const rel = sourcePath.slice("../../../node_modules/".length);
      return `node_modules/${rel}`;
    }
    if (sourcePath.startsWith("src/")) {
      const rel = sourcePath.slice("src/".length);
      return `packages/server/src/${rel}`;
    }
    if (sourcePath.startsWith("../node_modules/")) {
      const rel = sourcePath.slice("../node_modules/".length);
      return `node_modules/${rel}`;
    }
    if (sourcePath.startsWith("../core/")) {
      const rel = sourcePath.slice("../core/".length);
      return `packages/core/${rel}`;
    }
    if (sourcePath.startsWith("core/")) {
      return `packages/core/${sourcePath.slice("core/".length)}`;
    }
    if (
      sourcePath.startsWith("packages/") ||
      sourcePath.startsWith("node_modules/")
    ) {
      return toPosix(sourcePath);
    }

    const resolved = toPosix(
      path.resolve(`${repoDir}/packages/server`, sourcePath),
    );
    if (resolved.startsWith(`${repoDir}/`)) {
      return toPosix(path.relative(repoDir, resolved));
    }

    return toPosix(sourcePath);
  };

  map.sourceRoot = pathToFileURL(`${repoDir}/`).href;
  map.sources = map.sources.map(toRepoRelative);
  const updatedMap = Buffer.from(JSON.stringify(map)).toString("base64");
  const appSourceUpdated = appSource.replace(mapMatch[1], updatedMap);
  fs.writeFileSync(appBundlePath, appSourceUpdated);

  const appBytes = Buffer.from(appSourceUpdated);
  const bundleHash = createHash("sha256")
    .update(appBytes)
    .digest("hex")
    .slice(0, 12);
  const bootstrapPath = `${repoDir}/packages/server/dist/sea/sea-bootstrap.cjs`;
  const bootstrap = `/* eslint-disable */
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const bundleBase64 = ${JSON.stringify(appBytes.toString("base64"))};
const bundleLength = ${appBytes.length};
const bundleHash = ${JSON.stringify(bundleHash)};

const cacheRoot =
  process.env.STAGEHAND_SEA_CACHE_DIR ||
  \`\${os.tmpdir()}/stagehand-server-sea\`;
const cacheDir = \`\${cacheRoot}/\${bundleHash}\`;
const appPath = \`\${cacheDir}/app.mjs\`;

fs.mkdirSync(cacheDir, { recursive: true });
let needsWrite = true;
try {
  const stat = fs.statSync(appPath);
  needsWrite = stat.size !== bundleLength;
} catch {}

if (needsWrite) {
  const tmpPath =
    \`\${cacheDir}/app.mjs.tmp-\${process.pid}-\${Date.now().toString(16)}\`;
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
  fs.mkdirSync(`${repoDir}/packages/server/dist/sea`, { recursive: true });

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

  const seaConfigPath = writeSeaConfig(
    mainPath,
    `${repoDir}/packages/server/dist/sea/sea-prep.blob`,
    execArgvExtension,
  );

  run("node", ["--experimental-sea-config", seaConfigPath], {
    cwd: `${repoDir}/packages/server`,
  });
  if (!fs.existsSync(`${repoDir}/packages/server/dist/sea/sea-prep.blob`)) {
    throw new Error(
      `Missing ${repoDir}/packages/server/dist/sea/sea-prep.blob; SEA blob generation failed.`,
    );
  }

  const nodeBinary = await resolveNodeBinary();
  const outPath = `${repoDir}/packages/server/dist/sea/${binaryName}`;
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
    `${repoDir}/packages/server/dist/sea/sea-prep.blob`,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (targetPlatform === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  run(pnpmCommand, postjectArgs, { cwd: `${repoDir}/packages/server` });

  if (targetPlatform === "darwin") {
    runOptional("codesign", ["--sign", "-", outPath]);
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
