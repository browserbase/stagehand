/**
 * Server unit + integration tests on dist/esm + SEA/local server targets.
 *
 * Prereqs:
 * - pnpm run build (packages/server/dist/tests + packages/server/dist/server.js).
 * - SEA integration still requires build:sea when STAGEHAND_SERVER_TARGET=sea.
 *
 * Args: [test paths...] -- [node --test args...] | --list (prints JSON matrix)
 * Env: STAGEHAND_SERVER_TARGET=sea|local|remote, STAGEHAND_BASE_URL, SEA_BINARY_NAME,
 *      NODE_TEST_CONSOLE_REPORTER, NODE_TEST_REPORTER, NODE_TEST_REPORTER_DESTINATION,
 *      NODE_V8_COVERAGE; writes CTRF to ctrf/node-test-*.xml by default.
 * Example: STAGEHAND_SERVER_TARGET=sea pnpm run test:server -- packages/server/dist/tests/integration/v3/start.test.js
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getRepoRootDir } from "./runtimePaths.js";

const ensureParentDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const splitArgs = (args: string[]) => {
  const tokens = [...args];
  while (tokens[0] === "--") {
    tokens.shift();
  }

  const leadingExtra: string[] = [];
  while (tokens.length > 0 && tokens[0].startsWith("-")) {
    const arg = tokens.shift();
    if (!arg) break;
    if (arg === "--") break;
    leadingExtra.push(arg);
    if (
      !arg.includes("=") &&
      tokens[0] &&
      tokens[0] !== "--" &&
      !tokens[0].startsWith("-")
    ) {
      leadingExtra.push(tokens.shift() as string);
    }
  }

  while (tokens[0] === "--") {
    tokens.shift();
  }

  const separatorIndex = tokens.indexOf("--");
  return {
    paths: separatorIndex === -1 ? tokens : tokens.slice(0, separatorIndex),
    extra: [
      ...leadingExtra,
      ...(separatorIndex === -1 ? [] : tokens.slice(separatorIndex + 1)),
    ],
  };
};

const toSafeName = (name: string) => name.replace(/[\\/]/g, "-");

const collectFiles = (dir: string, suffix: string) => {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return results.sort();
};

const repoRoot = getRepoRootDir();

const writeCtrfFromJunit = (junitPath: string, tool: string) => {
  if (!fs.existsSync(junitPath)) return;
  const stat = fs.statSync(junitPath);
  if (stat.size === 0) return;
  const ctrfPath = junitPath.match(/\.xml$/i)
    ? junitPath.replace(/\.xml$/i, ".json")
    : `${junitPath}.json`;
  const result = spawnSync(
    "pnpm",
    ["exec", "junit-to-ctrf", junitPath, "-o", ctrfPath, "-t", tool],
    { stdio: "inherit", cwd: repoRoot },
  );
  if (result.status !== 0) {
    console.warn(`CTRF conversion failed for ${junitPath}.`);
  }
};

const sourceTestsDir = `${repoRoot}/packages/server/test`;
const sourceUnitDir = `${sourceTestsDir}/unit`;
const sourceIntegrationDir = `${sourceTestsDir}/integration`;
const unitDir = `${repoRoot}/packages/server/dist/tests/unit`;
const integrationDir = `${repoRoot}/packages/server/dist/tests/integration`;
const allTestsDir = `${repoRoot}/packages/server/dist/tests`;

const resolveRepoRelative = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

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

const toTestName = (testPath: string, root: string) => {
  const abs = resolveRepoRelative(testPath);
  const rel = path.relative(root, abs).replaceAll("\\", "/");
  if (!rel.startsWith("..")) {
    return rel.replace(/\.test\.js$/i, "");
  }
  return path.basename(abs).replace(/\.test\.js$/i, "");
};

const rawArgs = process.argv.slice(2);
const listRequested = rawArgs.includes("--list");

if (listRequested) {
  const unitTests = collectFiles(sourceUnitDir, ".test.ts").map((file) => {
    const relSource = path.relative(sourceTestsDir, file).replaceAll("\\", "/");
    const distPath = `${repoRoot}/packages/server/dist/tests/${relSource.replace(/\.test\.ts$/, ".test.js")}`;
    const name = path.basename(file, ".test.ts");
    return {
      path: path.relative(repoRoot, distPath).replaceAll("\\", "/"),
      name,
      safe_name: toSafeName(name),
    };
  });
  const integrationTests = collectFiles(sourceIntegrationDir, ".test.ts").map(
    (file) => {
      const relSource = path
        .relative(sourceTestsDir, file)
        .replaceAll("\\", "/");
      const distPath = `${repoRoot}/packages/server/dist/tests/${relSource.replace(/\.test\.ts$/, ".test.js")}`;
      const rel = path
        .relative(sourceIntegrationDir, file)
        .replaceAll("\\", "/")
        .replace(/\.test\.ts$/, "");
      return {
        path: path.relative(repoRoot, distPath).replaceAll("\\", "/"),
        name: rel,
        safe_name: toSafeName(rel),
      };
    },
  );
  console.log(JSON.stringify([...unitTests, ...integrationTests]));
  process.exit(0);
}

const { paths, extra } = splitArgs(rawArgs);
const { filtered: extraArgs, removed: removedReporterOverride } =
  stripNodeReporterArgs(extra);
if (removedReporterOverride) {
  console.warn(
    "Ignoring node --test reporter overrides to preserve console + JUnit output.",
  );
}

if (!fs.existsSync(allTestsDir)) {
  console.error(
    "Missing packages/server/dist/tests. Run pnpm run build first.",
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

if (
  serverTarget === "local" &&
  !fs.existsSync(`${repoRoot}/packages/server/dist/server.js`)
) {
  console.error(
    "Missing packages/server/dist/server.js. Run pnpm run build first.",
  );
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

const allPaths =
  paths.length > 0
    ? paths.map(resolveRepoRelative)
    : [
        ...collectFiles(unitDir, ".test.js"),
        ...collectFiles(integrationDir, ".test.js"),
      ];

const unitPaths = allPaths.filter((p) =>
  p.replaceAll("\\", "/").includes("/packages/server/dist/tests/unit/"),
);
const integrationPaths = allPaths.filter((p) =>
  p.replaceAll("\\", "/").includes("/packages/server/dist/tests/integration/"),
);

const singlePath = allPaths.length === 1 ? allPaths[0] : null;
const coverageSuffix =
  singlePath &&
  singlePath.startsWith(`${repoRoot}/packages/server/dist/tests/unit/`)
    ? `server-unit/${path.basename(singlePath).replace(/\.test\.js$/, "")}`
    : singlePath &&
        singlePath.startsWith(
          `${repoRoot}/packages/server/dist/tests/integration/`,
        )
      ? `server-integration/${path
          .relative(integrationDir, singlePath)
          .replace(/\.test\.js$/, "")
          .replaceAll("\\", "/")}`
      : "server";

const coverageRoot = resolveRepoRelative(
  process.env.NODE_V8_COVERAGE ?? `${repoRoot}/coverage/${coverageSuffix}`,
);
const testsCoverage = `${coverageRoot}/tests`;
const serverCoverage = `${coverageRoot}/server`;
fs.mkdirSync(testsCoverage, { recursive: true });
fs.mkdirSync(serverCoverage, { recursive: true });

const consoleReporter = process.env.NODE_TEST_CONSOLE_REPORTER ?? "spec";
const defaultReporter = process.env.NODE_TEST_REPORTER ?? "junit";
const envDestination = process.env.NODE_TEST_REPORTER_DESTINATION
  ? resolveRepoRelative(process.env.NODE_TEST_REPORTER_DESTINATION)
  : null;

const reporterArgsFor = (kind: "unit" | "integration", testName?: string) => {
  const destination =
    envDestination ??
    `${repoRoot}/ctrf/${kind === "unit" ? "server-unit" : "server-integration"}/${testName ? `${testName}.xml` : "all.xml"}`;
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
    ["--test", ...extraArgs, ...reporterArgs, ...files],
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
    return spawn(
      process.execPath,
      [`${repoRoot}/packages/server/dist/server.js`],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_ENV: "development",
          NODE_OPTIONS: nodeOptions,
          NODE_V8_COVERAGE: serverCoverage,
        },
      },
    );
  }

  const defaultName = `stagehand-server-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const seaBinary = `${repoRoot}/packages/server/dist/sea/${process.env.SEA_BINARY_NAME ?? defaultName}`;

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
        process.env.STAGEHAND_SEA_CACHE_DIR ?? `${repoRoot}/.stagehand-sea`,
    },
  });
};

let serverProc: ReturnType<typeof spawn> | null = null;
let status = 0;

if (unitPaths.length > 0) {
  const unitName =
    unitPaths.length === 1 ? toTestName(unitPaths[0], unitDir) : undefined;
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
        ? toTestName(integrationPaths[0], integrationDir)
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

process.exit(status);
