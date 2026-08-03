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

export interface IntegrationTestGroup {
  name: string;
  safe_name: string;
  paths: string[];
}

export interface IntegrationCliArgs {
  list: boolean;
  listGroups: boolean;
  args: string[];
}

// Every integration test file must appear in exactly one semantic group. Discovery
// throws when this map and packages/sdk-ts/tests/integration fall out of sync.
export const integrationTestGroups = {
  "local/browser-lifecycle": [
    "cdp-session-detached",
    "cookies",
    "default-page-tracking",
    "user-data-dir",
  ],
  "local/context-network": [
    "context-addInitScript",
    "context-domain-policy",
    "context-extra-http-headers",
  ],
  "local/frames-shadow": ["coordinate-click", "nested-div"],
  "local/input": ["clipboard", "keyboard"],
  "local/locators-read": [
    "locator-content-methods",
    "locator-count",
    "locator-nth",
    "text-selector-innermost",
  ],
  "local/locators-write": ["locator-fill", "locator-input-methods", "locator-select-option"],
  "local/page-navigation": ["page-addInitScript", "page-extra-http-headers", "page-goto-response"],
  "local/page-interactions": ["click-count", "page-drag-and-drop", "page-hover", "page-scroll"],
  "local/snapshots-ai": ["observe-element-id-format"],
  "local/waits-timeouts": ["wait-for-selector", "wait-for-timeout"],
} as const;

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

export const groupIntegrationTests = (
  entries: IntegrationTestEntry[],
  groups: Record<string, readonly string[]> = integrationTestGroups,
): IntegrationTestGroup[] => {
  if (entries.length === 0) return [];

  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const assignedTo = new Map<string, string>();
  const result = Object.entries(groups).map(([name, testNames]) => {
    if (testNames.length === 0) throw new Error(`Integration group ${name} has no tests`);
    const paths = testNames.map((testName) => {
      const entry = entriesByName.get(testName);
      if (!entry) throw new Error(`Integration group ${name} references unknown test ${testName}`);
      if (assignedTo.has(testName)) {
        const previousGroup = assignedTo.get(testName);
        if (previousGroup === name) {
          throw new Error(`Integration test ${testName} is listed multiple times in group ${name}`);
        }
        throw new Error(`Integration test ${testName} has multiple groups`);
      }
      assignedTo.set(testName, name);
      return entry.path;
    });
    return {
      name,
      safe_name: toSafeName(name),
      paths,
    };
  });

  const ungrouped = entries.filter((entry) => !assignedTo.has(entry.name));
  if (ungrouped.length > 0) {
    throw new Error(
      `Integration tests missing a group: ${ungrouped.map((entry) => entry.name).join(", ")}`,
    );
  }
  return result;
};

export const parseIntegrationCliArgs = (args: string[]): IntegrationCliArgs => {
  const listFlag = parseListFlag(args);
  return {
    list: listFlag.list,
    listGroups: listFlag.args.includes("--list-groups"),
    args: listFlag.args.filter((arg) => arg !== "--list-groups"),
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const cli = parseIntegrationCliArgs(process.argv.slice(2));

  if (cli.list || cli.listGroups) {
    const entries = discoverIntegrationTests(repoRoot, testsDir);
    const output = cli.listGroups ? groupIntegrationTests(entries) : entries;
    // Deliberately not process.exit(): stdout is async when piped, which is exactly how CI
    // reads this, so exiting here can truncate the matrix mid-JSON. Setting exitCode lets
    // Node flush and exit on its own.
    process.exitCode = 0;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    runVitest(cli.args);
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
