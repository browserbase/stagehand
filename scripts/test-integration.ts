/** Discover or run the v4 server integration tests. */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { collectFiles, parseListFlag, splitArgs, toSafeName } from "./test-utils.js";

export interface IntegrationTestEntry {
  path: string;
  name: string;
  safe_name: string;
}

export interface IntegrationTestShard {
  shard: string;
  name: string;
  safe_name: string;
  paths: string[];
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(repoRoot, "packages/sdk-ts/tests/integration");

export const discoverIntegrationTests = (
  root: string,
  integrationTestsDir: string,
): IntegrationTestEntry[] =>
  collectFiles(integrationTestsDir, ".test.ts")
    .map((file) => {
      const relativeTestPath = path.relative(integrationTestsDir, file).replaceAll("\\", "/");
      const name = relativeTestPath.replace(/\.test\.ts$/, "");
      return {
        path: path.relative(root, file).replaceAll("\\", "/"),
        name,
        safe_name: toSafeName(name),
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

export const shardIntegrationTests = (
  entries: IntegrationTestEntry[],
  requestedShards: number,
): IntegrationTestShard[] => {
  if (!Number.isInteger(requestedShards) || requestedShards < 1) {
    throw new Error("--list-shards must be a positive integer");
  }
  if (entries.length === 0) return [];

  const shardCount = Math.min(entries.length, requestedShards);
  const baseSize = Math.floor(entries.length / shardCount);
  const largerShardCount = entries.length % shardCount;
  let offset = 0;

  return Array.from({ length: shardCount }, (_, index) => {
    const shard = String(index + 1);
    const size = baseSize + (index < largerShardCount ? 1 : 0);
    const paths = entries.slice(offset, offset + size).map((entry) => entry.path);
    offset += size;
    return {
      shard,
      name: `shard-${shard}`,
      safe_name: `shard-${shard}`,
      paths,
    };
  });
};

const parseShardFlag = (args: string[]) => {
  const remaining: string[] = [];
  let count: number | null = null;
  for (const arg of args) {
    if (arg.startsWith("--list-shards=")) {
      count = Number(arg.slice("--list-shards=".length));
    } else {
      remaining.push(arg);
    }
  }
  return { count, args: remaining };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const listFlag = parseListFlag(process.argv.slice(2));
  const shardFlag = parseShardFlag(listFlag.args);

  if (listFlag.list || shardFlag.count !== null) {
    const entries = discoverIntegrationTests(repoRoot, testsDir);
    const output =
      shardFlag.count === null ? entries : shardIntegrationTests(entries, shardFlag.count);
    // Deliberately not process.exit(): stdout is async when piped, which is exactly how CI
    // reads this, so exiting here can truncate the matrix mid-JSON. Setting exitCode lets
    // Node flush and exit on its own.
    process.exitCode = 0;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    runVitest(shardFlag.args);
  }
}

function runVitest(args: string[]): void {
  const { paths, extra } = splitArgs(args);
  const require = createRequire(import.meta.url);
  const vitestCliPath = path.join(path.dirname(require.resolve("vitest")), "vitest.mjs");
  const configPath = path.join(repoRoot, "vitest.integration.config.ts");
  const result = spawnSync(
    process.execPath,
    [vitestCliPath, "run", "--config", configPath, ...extra, ...paths],
    { stdio: "inherit", cwd: repoRoot },
  );
  process.exitCode = result.status ?? 1;
}
