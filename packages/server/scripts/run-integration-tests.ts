#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { SourceMapConsumer } from "source-map";

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

const repoRoot = findRepoRoot(process.cwd());
const pkgDir = path.join(repoRoot, "packages", "server");

const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const port = process.env.PORT ?? "3107";
const apiUrl = process.env.STAGEHAND_API_URL ?? `http://127.0.0.1:${port}`;
process.env.PORT = port;
process.env.STAGEHAND_API_URL = apiUrl;
process.env.BB_ENV = process.env.BB_ENV ?? "local";

const useSea = process.env.SEA_MODE !== "0";

const distSeaDir = path.join(pkgDir, "dist", "sea");
const defaultSeaName = `stagehand-server-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
const resolveSeaBinary = (): string => {
  if (process.env.SEA_BINARY_PATH) {
    return path.resolve(repoRoot, process.env.SEA_BINARY_PATH);
  }
  if (process.env.SEA_BINARY_NAME) {
    return path.join(distSeaDir, process.env.SEA_BINARY_NAME);
  }
  const localSourcemap = path.join(distSeaDir, "stagehand-server-local-sourcemap");
  if (fs.existsSync(localSourcemap)) return localSourcemap;
  return path.join(distSeaDir, defaultSeaName);
};

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
};

const addNodeOption = (options: string, flag: string) => {
  const parts = options.split(/\s+/).filter(Boolean);
  if (parts.includes(flag)) return options;
  return `${options} ${flag}`.trim();
};

const removeNodeOption = (options: string, flag: string) => {
  const parts = options.split(/\s+/).filter(Boolean);
  return parts.filter((part) => part !== flag).join(" ");
};

const waitForServer = async (url: string, timeoutMs = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
};

const collectTestFiles = (root: string) => {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        results.push(fullPath);
      }
    }
  };
  walk(root);
  return results.sort();
};

const toCompiledPath = (tsPath: string): string => {
  if (tsPath.endsWith(".js")) return tsPath;
  const testRoot = path.join(pkgDir, "test");
  const relative = path.relative(testRoot, tsPath);
  return path.join(pkgDir, "dist", "tests", relative).replace(/\.ts$/, ".js");
};

const run = async () => {
  let serverProc: ReturnType<typeof spawn> | null = null;
  let seaCoverageDir: string | null = null;

  const shutdown = (code = 0) => {
    if (serverProc) {
      serverProc.kill("SIGTERM");
    }
    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  if (useSea) {
    const seaBinary = resolveSeaBinary();
    if (!fs.existsSync(seaBinary)) {
      console.error(`SEA binary not found at ${seaBinary}`);
      process.exit(1);
    }
    seaCoverageDir =
      process.env.NODE_V8_COVERAGE ??
      process.env.SEA_COVERAGE_DIR ??
      path.join(repoRoot, "coverage", "v8", "server-integration", "sea");
    ensureDir(seaCoverageDir);

    let nodeOptions = process.env.NODE_OPTIONS ?? "";
    // --no-lazy is blocked in NODE_OPTIONS for SEA; pass it via --node-options instead.
    nodeOptions = removeNodeOption(nodeOptions, "--no-lazy");
    const seaNodeOptions = addNodeOption(nodeOptions, "--enable-source-maps");
    const seaArgs = ["--node-options=--no-lazy --enable-source-maps"];

    const seaEnv = {
      ...process.env,
      NODE_ENV: "production",
      NODE_OPTIONS: seaNodeOptions,
      NODE_V8_COVERAGE: seaCoverageDir,
      STAGEHAND_SEA_CACHE_DIR:
        process.env.STAGEHAND_SEA_CACHE_DIR ??
        path.join(repoRoot, ".stagehand-sea"),
    };
    serverProc = spawn(seaBinary, seaArgs, {
      stdio: "inherit",
      env: seaEnv,
    });
  } else {
    process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
    serverProc = spawn(
      process.execPath,
      ["--import", "tsx", path.join(pkgDir, "src", "server.ts")],
      { stdio: "inherit", env: process.env },
    );
  }

  const ready = await waitForServer(`${apiUrl}/healthz`);
  if (!ready) {
    console.error(`Server failed to start within 30 seconds at ${apiUrl}`);
    shutdown(1);
  }

  const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
  const testRoot = path.join(pkgDir, "test", "integration", "v3");
  const testFiles = rawArgs.length ? rawArgs : collectTestFiles(testRoot);
  if (testFiles.length === 0) {
    console.error(`No integration tests found under ${testRoot}`);
    shutdown(1);
  }

  const distTestsRoot = path.join(pkgDir, "dist", "tests");
  const shouldCompile =
    useSea || process.env.USE_COMPILED_TESTS === "1" || fs.existsSync(distTestsRoot);
  if (shouldCompile && !fs.existsSync(distTestsRoot)) {
    const build = spawnSync("pnpm", ["run", "build:esm-tests"], {
      cwd: pkgDir,
      stdio: "inherit",
    });
    if (build.status !== 0) {
      shutdown(build.status ?? 1);
    }
  }

  const testPaths = shouldCompile
    ? testFiles.map(toCompiledPath)
    : testFiles;

  const testScript = shouldCompile ? "node:test:compiled" : "node:test";
  const testEnv = { ...process.env };
  if (shouldCompile && !process.env.NODE_TEST_NODE_OPTIONS) {
    testEnv.NODE_TEST_NODE_OPTIONS = `--import ${path.join(
      repoRoot,
      "scripts",
      "register-stagehand-dist.mjs",
    )}`;
  }

  const testResult = spawnSync(
    "pnpm",
    ["--filter", "@browserbasehq/stagehand-server", "run", testScript, ...testPaths],
    { stdio: "inherit", env: testEnv },
  );

  if (serverProc) {
    serverProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (serverProc?.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 10_000);
      serverProc?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  if (useSea && seaCoverageDir) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await normalizeSeaCoverage(seaCoverageDir);
  }

  process.exit(testResult.status ?? 1);
};

const normalizeSeaCoverage = async (coverageDir: string) => {
  const appBundlePath = path.join(pkgDir, "dist", "app.mjs");
  if (!fs.existsSync(appBundlePath)) return;
  if (!fs.existsSync(coverageDir)) return;

  const appSource = fs.readFileSync(appBundlePath, "utf8");
  const mapMatch = appSource.match(
    /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/,
  );
  if (!mapMatch) return;

  const map = JSON.parse(
    Buffer.from(mapMatch[1], "base64").toString("utf8"),
  ) as Record<string, unknown>;

  const lineStarts = [0];
  for (let i = 0; i < appSource.length; i++) {
    if (appSource[i] === "\n") lineStarts.push(i + 1);
  }

  const offsetToLineCol = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = lineStarts[mid];
      const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Infinity;
      if (start <= offset && offset < next) {
        return { line: mid + 1, column: offset - start };
      }
      if (start > offset) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return { line: 1, column: 0 };
  };

  const jsonFiles = fs
    .readdirSync(coverageDir)
    .filter((file) => file.endsWith(".json"));
  if (jsonFiles.length === 0) return;

  const consumer = await new SourceMapConsumer(map);

  try {
    for (const file of jsonFiles) {
      const fullPath = path.join(coverageDir, file);
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8")) as {
        result?: Array<{
          url?: string;
          functions: Array<{
            ranges: Array<{ startOffset: number; endOffset: number }>;
          }>;
        }>;
      };

      if (!Array.isArray(data.result)) continue;
      let updated = false;

      for (const entry of data.result) {
        if (!entry.url || !entry.url.endsWith("/app.mjs")) continue;
        for (const block of entry.functions ?? []) {
          for (const range of block.ranges ?? []) {
            if (range.endOffset <= range.startOffset) continue;
            const startPos = offsetToLineCol(range.startOffset);
            const start = consumer.originalPositionFor({
              line: startPos.line,
              column: startPos.column,
            });
            if (!start.source) continue;

            const endPos = offsetToLineCol(range.endOffset);
            const end = consumer.originalPositionFor({
              line: endPos.line,
              column: endPos.column,
            });
            if (end.source === start.source) continue;

            let found: number | null = null;
            const maxScan = 2000;
            for (
              let off = range.endOffset;
              off >= range.startOffset && range.endOffset - off <= maxScan;
              off--
            ) {
              const pos = offsetToLineCol(off);
              const mapped = consumer.originalPositionFor({
                line: pos.line,
                column: pos.column,
              });
              if (mapped.source === start.source) {
                found = off;
                break;
              }
            }
            if (found !== null) {
              range.endOffset = found;
              updated = true;
            }
          }
        }
      }

      if (updated) {
        fs.writeFileSync(fullPath, JSON.stringify(data));
      }
    }
  } finally {
    consumer.destroy();
  }
};

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
