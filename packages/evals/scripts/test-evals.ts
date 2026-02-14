/**
 * Eval runs via the evals CLI (packages/evals/dist/cli/cli.js).
 *
 * Prereqs: pnpm run build:cli (packages/evals/dist/cli/cli.js present).
 * Args: [target] [options...] (passed to evals run) | --list (prints JSON matrix).
 * Env: STAGEHAND_BROWSER_TARGET=local|browserbase, NODE_V8_COVERAGE, NODE_OPTIONS;
 *      writes JUnit to ctrf/evals/<target>.xml and CTRF to ctrf/evals/<target>.json.
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

type EvalSummaryEntry = {
  eval: string;
  model: string;
  categories?: string[];
};

type EvalSummary = {
  passed?: EvalSummaryEntry[];
  failed?: EvalSummaryEntry[];
};

const readEvalSummary = (summaryPath: string): EvalSummary | null => {
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as EvalSummary;
  } catch (error) {
    console.warn(
      `Failed to parse eval summary at ${summaryPath}: ${String(error)}`,
    );
    return null;
  }
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const writeEvalJunit = (
  summaryPath: string,
  outputPath: string,
  category: string,
) => {
  const summary = readEvalSummary(summaryPath);
  const passed = summary?.passed ?? [];
  const failed = summary?.failed ?? [];
  const missingSummary = summary === null;
  const tests = missingSummary ? 1 : passed.length + failed.length;
  const failures = missingSummary ? 1 : failed.length;
  const suiteName = `evals-${category}`;
  const cases: string[] = [];

  if (missingSummary) {
    cases.push(
      `    <testcase name="${escapeXml(`evals/${category} summary missing`)}" classname="${escapeXml(suiteName)}" time="0">`,
      `      <failure message="eval summary missing">Missing eval summary at ${escapeXml(summaryPath)}</failure>`,
      "    </testcase>",
    );
  } else {
    for (const item of passed) {
      cases.push(
        `    <testcase name="${escapeXml(`evals/${item.eval} [${item.model}]`)}" classname="${escapeXml(suiteName)}" time="0" />`,
      );
    }
    for (const item of failed) {
      cases.push(
        `    <testcase name="${escapeXml(`evals/${item.eval} [${item.model}]`)}" classname="${escapeXml(suiteName)}" time="0">`,
        `      <failure message="eval failed">${escapeXml(`categories=${(item.categories ?? []).join(",")}`)}</failure>`,
        "    </testcase>",
      );
    }
  }

  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<testsuites>",
    `  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="0">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");

  fs.writeFileSync(outputPath, xml);
};

const writeEvalCtrf = (
  summaryPath: string,
  outputPath: string,
  category: string,
) => {
  const timestamp = new Date().toISOString();
  const summary = readEvalSummary(summaryPath);
  if (summary) {
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

if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
  const result = spawnSync(process.execPath, [cliPath, "--help"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  process.exit(result.status ?? 0);
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
const junitPath = path.join(ctrfDir, `${safeTarget}.xml`);
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

writeEvalJunit(summaryPath, junitPath, safeTarget);
writeEvalCtrf(summaryPath, ctrfPath, safeTarget);

process.exit(result.status ?? 1);
