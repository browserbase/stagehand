/**
 * Eval runs via the evals CLI (packages/evals/dist/cli/cli.js).
 *
 * Prereqs: pnpm run build:cli (packages/evals/dist/cli/cli.js present).
 * Args: [target] [options...] (passed to evals run) | --list (prints JSON matrix).
 * Env: STAGEHAND_BROWSER_TARGET=local|browserbase, NODE_V8_COVERAGE, NODE_OPTIONS; writes CTRF to ctrf/evals/<target>.json.
 * Example: STAGEHAND_BROWSER_TARGET=browserbase pnpm run test:evals -- act -t 3 -c 10
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import normalizeV8Coverage from "../../core/scripts/normalize-v8-coverage";
import {
  findRepoRoot,
  resolveFromRoot,
  parseListFlag,
  toSafeName,
} from "../../core/scripts/test-utils";

const writeEvalCtrf = (
  summaryPath: string,
  outputPath: string,
  category: string,
) => {
  const timestamp = new Date().toISOString();
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
      passed?: Array<{ eval: string; model: string; categories?: string[] }>;
      failed?: Array<{ eval: string; model: string; categories?: string[] }>;
    };
    const passed = summary.passed ?? [];
    const failed = summary.failed ?? [];
    const toTests = (arr: typeof passed, status: "passed" | "failed") =>
      arr.map((item) => ({
        name: `evals/${item.eval} [${item.model}]`,
        status,
        duration: 0,
        suite: ["evals", category, ...(item.categories ?? [])],
      }));
    const report = {
      reportFormat: "CTRF",
      specVersion: "0.0.0",
      generatedBy: "stagehand-evals",
      timestamp,
      results: {
        tool: { name: "evals" },
        summary: {
          tests: passed.length + failed.length,
          passed: passed.length,
          failed: failed.length,
          skipped: 0,
          pending: 0,
          other: 0,
          start: 0,
          stop: 0,
        },
        tests: [...toTests(passed, "passed"), ...toTests(failed, "failed")],
      },
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    return;
  }

  const missingReport = {
    reportFormat: "CTRF",
    specVersion: "0.0.0",
    generatedBy: "stagehand-evals",
    timestamp,
    results: {
      tool: { name: "evals" },
      summary: {
        tests: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 0,
      },
      tests: [
        {
          name: `evals/${category} summary missing`,
          status: "failed",
          duration: 0,
          suite: ["evals", category],
        },
      ],
    },
  };
  fs.writeFileSync(outputPath, JSON.stringify(missingReport, null, 2));
};

const repoRoot = findRepoRoot(process.cwd());
const listFlag = parseListFlag(process.argv.slice(2));
const args = listFlag.args.filter((arg) => arg !== "--");

if (listFlag.list) {
  const categories = (
    process.env.EVAL_CATEGORIES ??
    "observe,act,combination,extract,targeted_extract,regression,agent"
  ).split(",");
  const entries = categories.map((category) => ({
    category,
    name: category,
    safe_name: toSafeName(category),
  }));
  console.log(JSON.stringify(entries));
  process.exit(0);
}

const cliPath = path.join(
  repoRoot,
  "packages",
  "evals",
  "dist",
  "cli",
  "cli.js",
);
if (!fs.existsSync(cliPath)) {
  console.error(
    "Missing packages/evals/dist/cli/cli.js. Run pnpm run build:cli first.",
  );
  process.exit(1);
}

const hasRun = args[0] === "run";
const argsAfterRun = hasRun ? args.slice(1) : args;
const target =
  argsAfterRun.find((arg) => !arg.startsWith("-"))?.trim() || "all";
const safeTarget = toSafeName(target);
const cliArgs = hasRun ? args : ["run", ...args];

const registerPath = path.join(
  repoRoot,
  "packages",
  "core",
  "scripts",
  "register-stagehand-dist.js",
);
const baseNodeOptions = [
  "--enable-source-maps",
  "--experimental-specifier-resolution=node",
  `--import ${registerPath}`,
].join(" ");
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const coverageDir = resolveFromRoot(
  repoRoot,
  process.env.NODE_V8_COVERAGE ??
    path.join(repoRoot, "coverage", "evals", safeTarget),
);
fs.mkdirSync(coverageDir, { recursive: true });
const summaryPath = path.join(repoRoot, "eval-summary.json");
const ctrfDir = path.join(repoRoot, "ctrf", "evals");
fs.mkdirSync(ctrfDir, { recursive: true });
const ctrfPath = path.join(ctrfDir, `${safeTarget}.json`);

const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  NODE_V8_COVERAGE: coverageDir,
};

const result = spawnSync(process.execPath, [cliPath, ...cliArgs], {
  stdio: "inherit",
  env,
  cwd: repoRoot,
});

if (coverageDir) {
  await normalizeV8Coverage(coverageDir);
}

writeEvalCtrf(summaryPath, ctrfPath, safeTarget);

process.exit(result.status ?? 1);
