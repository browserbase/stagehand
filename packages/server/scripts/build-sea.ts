#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { pathToFileURL } from "node:url";

const findRepoRoot = (startDir: string): string => {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
};

const repoDir = findRepoRoot(process.cwd());
const pkgDir = path.join(repoDir, "packages", "server");
const distDir = path.join(pkgDir, "dist");
const seaDir = path.join(distDir, "sea");
const blobPath = path.join(seaDir, "sea-prep.blob");
const coreEsmEntry = path.join(repoDir, "packages", "core", "dist", "esm", "index.js");

const targetPlatform = process.env.SEA_TARGET_PLATFORM ?? process.platform;
const targetArch = process.env.SEA_TARGET_ARCH ?? process.arch;
const binaryName =
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
  fs.mkdirSync(seaDir, { recursive: true });

  run("pnpm", ["--filter", "@browserbasehq/stagehand", "build"], {
    cwd: repoDir,
  });
  run("pnpm", ["--filter", "@browserbasehq/stagehand", "run", "build:esm"], {
    cwd: repoDir,
  });

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
    "--banner:js=import { createRequire as __createRequire } from \"node:module\"; const require = __createRequire(import.meta.url);",
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
      return toPosix(path.join("packages", "core", sourcePath.slice("core/".length)));
    }
    if (sourcePath.startsWith("packages/") || sourcePath.startsWith("node_modules/")) {
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
  const bundleHash = createHash("sha256").update(appBytes).digest("hex").slice(0, 12);
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

  run("node", ["--experimental-sea-config", "sea-config.json"], {
    cwd: pkgDir,
  });
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
