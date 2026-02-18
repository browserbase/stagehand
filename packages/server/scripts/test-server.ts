/**
 * Server unit + integration tests (node --test) on dist/esm + SEA.
 *
 * Prereqs: pnpm run build (core dist/esm + server dist/tests + server dist/server.js)
 *          and pnpm run build:sea:esm for SEA.
 * Args: [test paths...] -- [node --test args...] | --list [unit|integration] (prints JSON matrix)
 * Env: STAGEHAND_SERVER_TARGET=sea|local|remote, STAGEHAND_BASE_URL, SEA_BINARY_NAME,
 *      NODE_TEST_CONSOLE_REPORTER, NODE_TEST_REPORTER, NODE_TEST_REPORTER_DESTINATION,
 *      NODE_V8_COVERAGE; writes CTRF to ctrf/node-test-*.xml by default.
 * Example: STAGEHAND_SERVER_TARGET=sea pnpm run test:server -- packages/server/test/integration/foo.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import normalizeV8Coverage from "../../core/scripts/normalize-v8-coverage";
import {
  findRepoRoot,
  resolveFromRoot,
  ensureParentDir,
  parseListFlag,
  splitArgs,
  collectFiles,
  toSafeName,
  writeCtrfFromJunit,
} from "../../core/scripts/test-utils";

const repoRoot = findRepoRoot(process.cwd());
const serverRoot = path.join(repoRoot, "packages", "server");
const distTestsRoot = path.join(serverRoot, "dist", "tests");
const distServerEntry = path.join(serverRoot, "dist", "server.js");

const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);
const stripNodeReporterArgs = (argsList: string[]) => {
  const filtered: string[] = [];
  let removed = false;
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (
      arg === "--test-reporter" ||
      arg.startsWith("--test-reporter=") ||
      arg === "--test-reporter-destination" ||
      arg.startsWith("--test-reporter-destination=")
    ) {
      removed = true;
      if (
        (arg === "--test-reporter" || arg === "--test-reporter-destination") &&
        argsList[i + 1]
      ) {
        i += 1;
      }
      continue;
    }
    filtered.push(arg);
  }
  return { filtered, removed };
};
const { filtered: extraArgs, removed: removedReporterOverride } =
  stripNodeReporterArgs(extra);
if (removedReporterOverride) {
  console.warn(
    "Ignoring node --test reporter overrides to preserve console + JUnit output.",
  );
}

if (listFlag.list) {
  const unitRoot = path.join(serverRoot, "test", "unit");
  const integrationRoot = path.join(serverRoot, "test", "integration");
  const unitTests = collectFiles(unitRoot, ".test.ts").map((file) => {
    const name = path.basename(file, ".test.ts");
    return {
      path: path.relative(repoRoot, file),
      name,
      safe_name: toSafeName(name),
    };
  });
  const integrationTests = collectFiles(integrationRoot, ".test.ts").map(
    (file) => {
      const rel = path
        .relative(integrationRoot, file)
        .replace(/\.test\.ts$/, "");
      return {
        path: path.relative(repoRoot, file),
        name: rel,
        safe_name: toSafeName(rel),
      };
    },
  );
  const value = listFlag.value.toLowerCase();
  if (value === "unit") {
    console.log(JSON.stringify(unitTests));
  } else if (value === "integration") {
    console.log(JSON.stringify(integrationTests));
  } else {
    console.log(JSON.stringify([...unitTests, ...integrationTests]));
  }
  process.exit(0);
}

if (!fs.existsSync(distTestsRoot)) {
  console.error(
    "Missing packages/server/dist/tests. Run pnpm run build first.",
  );
  process.exit(1);
}
if (!fs.existsSync(distServerEntry)) {
  console.error(
    "Missing packages/server/dist/server.js. Run pnpm run build first.",
  );
  process.exit(1);
}

const serverTarget = (
  process.env.STAGEHAND_SERVER_TARGET ?? "sea"
).toLowerCase();
const explicitBaseUrl = process.env.STAGEHAND_BASE_URL;
const baseUrl = explicitBaseUrl ?? "http://stagehand-api.localhost:3107";

if (serverTarget === "remote" && !explicitBaseUrl) {
  console.error("Missing STAGEHAND_BASE_URL for remote server target.");
  process.exit(1);
}

const parsedBaseUrl = new URL(baseUrl);
const port =
  parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80");

process.env.PORT = port;
process.env.STAGEHAND_API_URL = baseUrl;
process.env.BB_ENV = process.env.BB_ENV ?? "local";

const baseNodeOptions = "--enable-source-maps";
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const unitRoot = path.join(serverRoot, "test", "unit");
const integrationRoot = path.join(serverRoot, "test", "integration");
const singlePath = paths.length === 1 ? path.resolve(repoRoot, paths[0]) : null;
const coverageSuffix =
  singlePath && singlePath.startsWith(unitRoot + path.sep)
    ? path.join(
        "server-unit",
        path.basename(singlePath).replace(/\.test\.ts$/, ""),
      )
    : singlePath && singlePath.startsWith(integrationRoot + path.sep)
      ? path.join(
          "server-integration",
          path.relative(integrationRoot, singlePath).replace(/\.test\.ts$/, ""),
        )
      : "server";

const coverageRoot = resolveFromRoot(
  repoRoot,
  process.env.NODE_V8_COVERAGE ??
    path.join(repoRoot, "coverage", coverageSuffix),
);
const testsCoverage = path.join(coverageRoot, "tests");
const serverCoverage = path.join(coverageRoot, "server");
fs.mkdirSync(testsCoverage, { recursive: true });
fs.mkdirSync(serverCoverage, { recursive: true });

const collectTests = (dir: string): string[] => {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        results.push(fullPath);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return results.sort();
};

const toDistPath = (testPath: string) => {
  if (
    testPath.endsWith(".js") &&
    testPath.includes(`${path.sep}dist${path.sep}tests${path.sep}`)
  ) {
    return testPath;
  }
  const abs = path.isAbsolute(testPath)
    ? testPath
    : path.resolve(repoRoot, testPath);
  const rel = path.relative(path.join(serverRoot, "test"), abs);
  return path.join(distTestsRoot, rel).replace(/\.ts$/i, ".js");
};

const allPaths =
  paths.length > 0
    ? paths
    : [
        ...collectTests(path.join(serverRoot, "test", "unit")),
        ...collectTests(path.join(serverRoot, "test", "integration")),
      ];

const unitPaths = allPaths.filter((p) =>
  path.resolve(repoRoot, p).includes(path.join(serverRoot, "test", "unit")),
);
const integrationPaths = allPaths.filter((p) =>
  path
    .resolve(repoRoot, p)
    .includes(path.join(serverRoot, "test", "integration")),
);

const consoleReporter = process.env.NODE_TEST_CONSOLE_REPORTER ?? "spec";
const defaultReporter = process.env.NODE_TEST_REPORTER ?? "junit";
const envDestination = process.env.NODE_TEST_REPORTER_DESTINATION
  ? resolveFromRoot(repoRoot, process.env.NODE_TEST_REPORTER_DESTINATION)
  : null;

const reporterArgsFor = (kind: "unit" | "integration", testName?: string) => {
  const baseDir = path.join(
    repoRoot,
    "ctrf",
    kind === "unit" ? "server-unit" : "server-integration",
  );
  const destination =
    envDestination ??
    path.join(baseDir, testName ? `${testName}.xml` : "all.xml");
  ensureParentDir(destination);
  return {
    args: [
      `--test-reporter=${consoleReporter}`,
      `--test-reporter=${defaultReporter}`,
      "--test-reporter-destination=stdout",
      `--test-reporter-destination=${destination}`,
    ],
    destination,
  };
};

const runNodeTests = (files: string[], reporterArgs: string[]) =>
  spawnSync(
    process.execPath,
    ["--test", ...extraArgs, ...reporterArgs, ...files.map(toDistPath)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
        NODE_V8_COVERAGE: testsCoverage,
      },
    },
  );

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

const startServer = async () => {
  if (serverTarget === "remote") return null;
  if (serverTarget === "local") {
    return spawn(process.execPath, [distServerEntry], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        NODE_OPTIONS: nodeOptions,
        NODE_V8_COVERAGE: serverCoverage,
      },
    });
  }

  const seaDir = path.join(serverRoot, "dist", "sea");
  const defaultName = `stagehand-server-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const seaBinary = path.join(
    seaDir,
    process.env.SEA_BINARY_NAME ?? defaultName,
  );

  if (!fs.existsSync(seaBinary)) {
    console.error(`SEA binary not found at ${seaBinary}`);
    process.exit(1);
  }

  return spawn(seaBinary, ["--node-options=--no-lazy --enable-source-maps"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_V8_COVERAGE: serverCoverage,
      STAGEHAND_SEA_CACHE_DIR:
        process.env.STAGEHAND_SEA_CACHE_DIR ??
        path.join(repoRoot, ".stagehand-sea"),
    },
  });
};

let serverProc: ReturnType<typeof spawn> | null = null;
let status = 0;

if (unitPaths.length > 0) {
  const unitName =
    unitPaths.length === 1
      ? path.basename(unitPaths[0]).replace(/\.test\.ts$/, "")
      : undefined;
  const reporter = reporterArgsFor("unit", unitName);
  const result = runNodeTests(unitPaths, reporter.args);
  status = result.status ?? 1;
  writeCtrfFromJunit(reporter.destination, "node-test");
}

if (status === 0 && integrationPaths.length > 0) {
  serverProc = await startServer();
  const ready = await waitForServer(`${process.env.STAGEHAND_API_URL}/healthz`);
  if (!ready) {
    console.error("Server failed to start within 30 seconds.");
    status = 1;
  } else {
    const integrationName =
      integrationPaths.length === 1
        ? path
            .relative(
              path.join(serverRoot, "test", "integration"),
              path.resolve(repoRoot, integrationPaths[0]),
            )
            .replace(/\.test\.ts$/, "")
        : undefined;
    const reporter = reporterArgsFor("integration", integrationName);
    const result = runNodeTests(integrationPaths, reporter.args);
    status = result.status ?? 1;
    writeCtrfFromJunit(reporter.destination, "node-test");
  }
}

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
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

await normalizeV8Coverage(coverageRoot);

process.exit(status);
