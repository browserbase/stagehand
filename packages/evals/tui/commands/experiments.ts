import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  padRight,
  red,
  separator,
} from "../format.js";
import {
  listRecentExperiments,
  resolveExperimentAcrossProjects,
  resolveExperimentProjectAcrossProjects,
  findLeaderIndex,
  sharedMetricKeys,
  sharedTaskNames,
  type ExperimentData,
  type RecentExperimentData,
} from "../../lib/braintrust-report.js";
import { getPackageRootDir } from "../../runtimePaths.js";

const DEFAULT_LIST_PROJECTS = ["stagehand-dev", "stagehand-core-dev"];
const DEFAULT_LIMIT = 5;
const DEFAULT_COMPARE_OUTPUT = "/tmp/stagehand-core-braintrust-report.html";

type ListOptions = {
  project?: string;
  limit: number;
  json: boolean;
};

type ShowOptions = {
  project?: string;
  json: boolean;
  experiment: string;
};

type OpenOptions = {
  project?: string;
  experiment: string;
};

type CompareOptions = {
  project?: string;
  title?: string;
  out?: string;
  headless: boolean;
  experiments: string[];
};

export async function handleExperiments(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help" || subcommand === "-h" || subcommand === "--help") {
    const { printExperimentsHelp } = await import("./help.js");
    printExperimentsHelp();
    return;
  }

  switch (subcommand) {
    case "list": {
      if (rest.includes("-h") || rest.includes("--help")) {
        const { printExperimentsHelp } = await import("./help.js");
        printExperimentsHelp("list");
        return;
      }
      await handleList(rest);
      return;
    }
    case "show": {
      if (rest.includes("-h") || rest.includes("--help")) {
        const { printExperimentsHelp } = await import("./help.js");
        printExperimentsHelp("show");
        return;
      }
      await handleShow(rest);
      return;
    }
    case "open": {
      if (rest.includes("-h") || rest.includes("--help")) {
        const { printExperimentsHelp } = await import("./help.js");
        printExperimentsHelp("open");
        return;
      }
      await handleOpen(rest);
      return;
    }
    case "compare": {
      if (rest.includes("-h") || rest.includes("--help")) {
        const { printExperimentsHelp } = await import("./help.js");
        printExperimentsHelp("compare");
        return;
      }
      await handleCompare(rest);
      return;
    }
    default:
      throw new Error(`Unknown experiments subcommand "${subcommand}"`);
  }
}

async function handleList(args: string[]): Promise<void> {
  const options = parseListArgs(args);
  const projects = options.project
    ? [options.project]
    : DEFAULT_LIST_PROJECTS;

  const rows = await Promise.all(
    projects.map(async (project) => ({
      project,
      experiments: await listRecentExperiments(project, options.limit),
    })),
  );

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const section of rows) {
    console.log(`\n  ${bold(cyan(section.project))}`);
    if (section.experiments.length === 0) {
      console.log(`    ${dim("No recent experiments found.")}`);
      continue;
    }

    console.log(separator());
    // Size the name column to the longest experiment name in this
    // section so long names like
    // `act_browserbase_stagehand_gpt_4_1_mini_apr27_1530` aren't truncated.
    // Floor at 24 to keep short-name layouts stable.
    const nameWidth = Math.max(
      24,
      ...section.experiments.map((e) => e.experimentName.length),
    );
    for (const experiment of section.experiments) {
      const relative = dim(padRight(formatRelativeTime(experiment.createdAt), 10));
      const name = padRight(experiment.experimentName, nameWidth);
      const passRate =
        experiment.passScore !== undefined
          ? formatRecentPassRate(experiment)
          : dim(padRight("—", 7));
      const duration =
        experiment.durationSeconds !== undefined
          ? dim(formatSeconds(experiment.durationSeconds))
          : dim("—");
      console.log(`    ${relative} ${name} ${passRate} ${duration}`);
    }
  }
  console.log("");
}

async function handleShow(args: string[]): Promise<void> {
  const options = parseShowArgs(args);
  const projects = options.project ? [options.project] : DEFAULT_LIST_PROJECTS;
  const experiment = await resolveExperimentAcrossProjects(
    projects,
    options.experiment,
  );

  if (options.json) {
    console.log(JSON.stringify(experiment, null, 2));
    return;
  }

  console.log(`\n  ${bold("Experiment:")} ${experiment.experimentName}`);
  console.log(`  ${bold("Project:")} ${experiment.projectName}`);
  console.log(`  ${bold("Created:")} ${experiment.createdAt ?? gray("unknown")}`);
  console.log(
    `  ${bold("Pass rate:")} ${formatPassRate(experiment, false)}`,
  );
  console.log(
    `  ${bold("Tasks:")} ${experiment.passedTasks}/${experiment.totalTasks}`,
  );
  console.log(`  ${bold("Duration:")} ${formatSeconds(experiment.durationSeconds)}`);
  console.log(`  ${bold("URL:")} ${experiment.experimentUrl}`);
  console.log("");
}

async function handleOpen(args: string[]): Promise<void> {
  const options = parseOpenArgs(args);
  const projects = options.project ? [options.project] : DEFAULT_LIST_PROJECTS;
  const experiment = await resolveExperimentAcrossProjects(
    projects,
    options.experiment,
  );
  console.log(green(`  Opening ${experiment.experimentName}`));
  openInBrowser(experiment.experimentUrl);
}

async function handleCompare(args: string[]): Promise<void> {
  const options = parseCompareArgs(args);
  const project = options.project ?? (await inferCompareProject(options.experiments));
  const scriptPath = path.join(
    getPackageRootDir(),
    "scripts",
    "render-braintrust-core-report.ts",
  );

  const childArgs = [
    "--import",
    "tsx",
    scriptPath,
    ...options.experiments,
    "--project",
    project,
    ...(options.title ? ["--title", options.title] : []),
    ...(options.out ? ["--out", options.out] : []),
    ...(options.headless ? ["--no-open"] : []),
  ];

  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, childArgs, {
      stdio: options.headless ? "pipe" : "inherit",
      env: process.env,
    });
    if (options.headless) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        if (options.headless) {
          const outputPath = options.out ?? DEFAULT_COMPARE_OUTPUT;
          const dataPath = outputPath.replace(/\.html?$/i, ".json");
          renderHeadlessCompareSummary(project, outputPath, dataPath);
        }
        resolve();
        return;
      }
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(
        new Error(
          `Compare report exited with code ${code ?? 1}${details ? `\n${details}` : ""}`,
        ),
      );
    });
  });
}

function parseListArgs(args: string[]): ListOptions {
  let project: string | undefined;
  let limit = DEFAULT_LIMIT;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--project") {
      project = args[++i];
      if (!project) throw new Error("Missing value for --project");
      continue;
    }
    if (arg === "--limit") {
      const raw = args[++i];
      if (!raw) throw new Error("Missing value for --limit");
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      limit = parsed;
      continue;
    }
    throw new Error(`Unknown option "${arg}"`);
  }

  return { project, limit, json };
}

function parseShowArgs(args: string[]): ShowOptions {
  let project: string | undefined;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--project") {
      project = args[++i];
      if (!project) throw new Error("Missing value for --project");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}"`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error("Usage: experiments show <experiment> [--project <name>] [--json]");
  }

  return { project, json, experiment: positional[0] };
}

function parseOpenArgs(args: string[]): OpenOptions {
  let project: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project") {
      project = args[++i];
      if (!project) throw new Error("Missing value for --project");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}"`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error("Usage: experiments open <experiment> [--project <name>]");
  }

  return { project, experiment: positional[0] };
}

function parseCompareArgs(args: string[]): CompareOptions {
  let project: string | undefined;
  let title: string | undefined;
  let out: string | undefined;
  let headless = false;
  const experiments: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project") {
      project = args[++i] ?? "";
      if (!project) throw new Error("Missing value for --project");
      continue;
    }
    if (arg === "--title") {
      title = args[++i];
      if (!title) throw new Error("Missing value for --title");
      continue;
    }
    if (arg === "--out") {
      out = args[++i];
      if (!out) throw new Error("Missing value for --out");
      continue;
    }
    if (arg === "--headless") {
      headless = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}"`);
    }
    experiments.push(arg);
  }

  if (experiments.length < 2) {
    throw new Error("Usage: experiments compare <exp1> <exp2> [exp3 ...]");
  }

  return { project, title, out, headless, experiments };
}

async function inferCompareProject(experiments: string[]): Promise<string> {
  const resolved = await Promise.all(
    experiments.map((experiment) =>
      resolveExperimentProjectAcrossProjects(
        DEFAULT_LIST_PROJECTS,
        experiment,
      ),
    ),
  );

  const project = resolved[0]?.projectName;
  if (!project) {
    throw new Error("Unable to infer a Braintrust project for compare.");
  }
  if (resolved.some((entry) => entry.projectName !== project)) {
    throw new Error(
      "All experiments in compare must belong to the same project. Pass --project explicitly if needed.",
    );
  }
  return project;
}

function formatPassRate(
  experiment: ExperimentData,
  color = true,
): string {
  const pct = `${(experiment.passScore * 100).toFixed(1)}%`;
  if (!color) return pct;
  if (experiment.passScore >= 0.8) return green(pct);
  if (experiment.passScore >= 0.5) return pct;
  return red(pct);
}

function formatRecentPassRate(experiment: RecentExperimentData): string {
  if (experiment.passScore === undefined) {
    return dim("—");
  }
  const pct = `${(experiment.passScore * 100).toFixed(1)}%`;
  if (experiment.passScore >= 0.8) return green(pct);
  if (experiment.passScore >= 0.5) return pct;
  return red(pct);
}

function renderHeadlessCompareSummary(
  project: string,
  reportPath: string,
  dataPath: string,
): void {
  const rows = JSON.parse(fs.readFileSync(dataPath, "utf8")) as ExperimentData[];
  const leaderIndex = rows.length > 1 ? findLeaderIndex(rows) : -1;
  const sharedTasks = sharedTaskNames(rows);
  const sharedMetrics = sharedMetricKeys(rows);
  const nameWidth = Math.max(
    18,
    Math.min(
      32,
      Math.max(...rows.map((row) => row.label.length), "Experiment".length),
    ),
  );
  const passWidth = 7;
  const tasksWidth = 9;
  const durationWidth = 8;
  const leaderWidth = 8;
  const sideLetters = rows.map((_, index) => String.fromCharCode(65 + index));

  console.log(`\n  ${bold("Comparison")}`);
  console.log(`  ${bold("Project:")} ${project}`);
  console.log(
    `  ${bold("Experiments:")} ${rows
      .map((row, index) => `${sideLetters[index]}=${row.label}`)
      .join(` ${dim("·")} `)}`,
  );
  console.log(separator());
  console.log(
    `    ${bold(padRight("Experiment", nameWidth))} ${bold(padRight("Pass", passWidth))} ${bold(padRight("Tasks", tasksWidth))} ${bold(padRight("Duration", durationWidth))}`,
  );
  console.log(separator());

  for (const [index, row] of rows.entries()) {
    const name = padRight(row.label, nameWidth);
    const pass = colorizeRate(
      row.passScore,
      padRight(formatPassRate(row, false), passWidth),
    );
    const tasks = padRight(`${row.passedTasks}/${row.totalTasks}`, 9);
    const duration = padRight(formatSeconds(row.durationSeconds), durationWidth);
    const leader = padRight(index === leaderIndex ? "leader" : "", leaderWidth);
    console.log(`    ${name} ${pass} ${dim(tasks)} ${dim(duration)} ${dim(leader)}`);
  }

  console.log(separator());
  console.log(`  ${bold("Shared tasks:")} ${sharedTasks.length}`);
  console.log(`  ${bold("Shared metrics:")} ${sharedMetrics.length}`);
  printMetricSpreadSection(rows, sharedMetrics, sideLetters);
  printTaskDiffSection(rows, sharedTasks, sideLetters);
  console.log(`  ${bold("HTML report:")} ${reportPath}`);
  console.log(`  ${bold("JSON data:")} ${dataPath}`);
  console.log("");
}

function printMetricSpreadSection(
  rows: ExperimentData[],
  metricKeys: string[],
  sideLetters: string[],
): void {
  const topMetrics = metricKeys
    .map((key) => {
      const values = rows
        .map((row) => row.taskMetrics[key]?.mean)
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        spread:
          values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
      };
    })
    .filter((entry) => entry.spread > 0)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 5);

  if (topMetrics.length === 0) {
    return;
  }

  console.log(`\n  ${bold("Largest metric spreads:")}`);
  const metricWidth = Math.max(
    12,
    Math.min(18, Math.max(...topMetrics.map((metric) => metric.key.length))),
  );

  for (const metric of topMetrics) {
    const metricValues = rows.map((row, index) => ({
      side: sideLetters[index],
      mean: row.taskMetrics[metric.key]?.mean,
    }));
    const numericValues = metricValues
      .map((entry) => entry.mean)
      .filter((value): value is number => typeof value === "number");
    const bestValue = numericValues.length > 0 ? Math.min(...numericValues) : undefined;
    const valueWidth = Math.max(
      10,
      Math.min(
        14,
        Math.max(
          ...metricValues.map((entry) =>
            `${entry.side}:${formatMetricValue(metric.key, entry.mean ?? 0)}`.length,
          ),
        ),
      ),
    );
    const values = metricValues
      .map((entry) => {
        if (typeof entry.mean !== "number") {
          return padRight(`${entry.side}:—`, valueWidth);
        }
        const text = padRight(
          `${entry.side}:${formatMetricValue(metric.key, entry.mean)}`,
          valueWidth,
        );
        return entry.mean === bestValue ? green(text) : dim(text);
      })
      .join(` ${dim("·")} `);
    console.log(
      `    ${padRight(metric.key, metricWidth)} ${values} ${dim(`spread ${formatMetricValue(metric.key, metric.spread)}`)}`,
    );
  }
}

function printTaskDiffSection(
  rows: ExperimentData[],
  taskNames: string[],
  sideLetters: string[],
): void {
  const differingTasks = taskNames
    .map((name) => {
      const outcomes = rows.map((row) => {
        const task = row.tasks.find((candidate) => candidate.name === name);
        return task?.success ?? false;
      });
      return {
        name,
        outcomes,
        differs: new Set(outcomes).size > 1,
      };
    })
    .filter((entry) => entry.differs)
    .slice(0, 8);

  if (differingTasks.length === 0) {
    return;
  }

  console.log(`\n  ${bold("Differing tasks:")}`);
  for (const task of differingTasks) {
    const outcomes = task.outcomes
      .map((success, index) =>
        `${sideLetters[index]}:${success ? green("pass") : red("fail")}`,
      )
      .join(` ${dim("·")} `);
    console.log(`    ${padRight(task.name, 28)} ${outcomes}`);
  }
}

function colorizeRate(score: number, text: string): string {
  if (score >= 0.8) return green(text);
  if (score >= 0.5) return text;
  return red(text);
}

function formatMetricValue(metricKey: string, value: number): string {
  if (metricKey.endsWith("_ms")) {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  }
  if (metricKey.endsWith("_tokens")) {
    return `${Math.round(value)}tok`;
  }
  if (metricKey.includes("duration")) {
    return formatSeconds(value);
  }
  if (value >= 100) {
    return `${Math.round(value)}`;
  }
  return value.toFixed(2);
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return `${minutes}m${remainder}s`;
  }
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function formatRelativeTime(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openInBrowser(target: string): void {
  if (process.env.CI === "true") return;
  if ((process.env.BROWSER ?? "").toLowerCase() === "none") return;

  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", target] : [target];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // best-effort only
  }
}
