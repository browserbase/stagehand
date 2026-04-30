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
  benchCaseDiffs,
  collectExperimentMetrics,
  detectCompareMode,
  listRecentExperiments,
  resolveExperimentAcrossProjects,
  resolveExperimentProjectsAcrossProjects,
  findLeaderIndex,
  sharedMetricKeys,
  sharedBenchCaseKeys,
  sharedTaskNames,
  summarizeBenchAgentConfigs,
  type ExperimentData,
  type ExperimentInput,
  type RecentExperimentData,
  type ResolvedExperimentProject,
} from "../../lib/braintrust-report.js";
import { getPackageRootDir } from "../../runtimePaths.js";

const DEFAULT_LIST_PROJECTS = ["stagehand-dev", "stagehand-core-dev"];
const DEFAULT_LIMIT = 5;
const DEFAULT_COMPARE_OUTPUT = "/tmp/stagehand-evals-braintrust-report.html";

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
  experiments: ExperimentInput[];
};

type ResolvedCompareInput = ExperimentInput & ResolvedExperimentProject;

export async function handleExperiments(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (
    !subcommand ||
    subcommand === "help" ||
    subcommand === "-h" ||
    subcommand === "--help"
  ) {
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
  const projects = options.project ? [options.project] : DEFAULT_LIST_PROJECTS;

  const rows: Array<{
    project: string;
    experiments: RecentExperimentData[];
  }> = [];
  for (const project of projects) {
    rows.push({
      project,
      experiments: await listRecentExperiments(project, options.limit),
    });
  }

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
      const relative = dim(
        padRight(formatRelativeTime(experiment.createdAt), 10),
      );
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
  console.log(
    `  ${bold("Created:")} ${experiment.createdAt ?? gray("unknown")}`,
  );
  console.log(`  ${bold("Pass rate:")} ${formatPassRate(experiment, false)}`);
  console.log(
    `  ${bold(experiment.mode === "bench" ? "Cases:" : "Tasks:")} ${experiment.passedTasks}/${experiment.totalTasks}`,
  );
  console.log(
    `  ${bold("Duration:")} ${formatSeconds(experiment.durationSeconds)}`,
  );
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
  const resolvedInputs = await resolveCompareInputs(options);
  const projects = [
    ...new Set(resolvedInputs.map((input) => input.projectName)),
  ];
  const projectLabel =
    projects.length === 1 ? projects[0] : `mixed (${projects.join(", ")})`;
  const scriptPath = path.join(
    getPackageRootDir(),
    "scripts",
    "render-braintrust-core-report.ts",
  );
  const experimentArgs = resolvedInputs.map(formatExperimentArg);
  const outputPath = options.out ?? DEFAULT_COMPARE_OUTPUT;
  const projectArgs =
    projects.length === 1
      ? ["--project", projects[0]]
      : [
          "--project-map",
          JSON.stringify(resolvedInputs.map((input) => input.projectName)),
        ];

  const childArgs = [
    "--import",
    "tsx",
    scriptPath,
    ...experimentArgs,
    ...projectArgs,
    ...(options.title ? ["--title", options.title] : []),
    "--out",
    outputPath,
    ...(options.headless ? ["--no-open"] : []),
  ];

  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, childArgs, {
      stdio: options.headless ? "pipe" : "inherit",
      env: {
        ...process.env,
        ...(options.headless
          ? { BROWSER: "none", CI: process.env.CI ?? "true", NO_COLOR: "1" }
          : {}),
      },
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
    child.on("close", (code) => {
      if (code === 0) {
        if (options.headless) {
          const dataPath = outputPath.replace(/\.html?$/i, ".json");
          try {
            renderHeadlessCompareSummary(projectLabel, outputPath, dataPath);
          } catch (err) {
            reject(err);
            return;
          }
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
    throw new Error(
      "Usage: experiments show <experiment> [--project <name>] [--json]",
    );
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
  const experiments: ExperimentInput[] = [];

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
    experiments.push(parseExperimentSpec(arg));
  }

  if (experiments.length < 2) {
    throw new Error("Usage: experiments compare <exp1> <exp2> [exp3 ...]");
  }

  return { project, title, out, headless, experiments };
}

function parseExperimentSpec(raw: string): ExperimentInput {
  const eqIdx = raw.indexOf("=");
  if (eqIdx === -1) {
    return { label: raw, experiment: raw };
  }
  const left = raw.slice(0, eqIdx).trim();
  const right = raw.slice(eqIdx + 1).trim();
  if (!left || !right) {
    throw new Error(
      `Invalid experiment spec "${raw}". Use <id> or <label>=<id>.`,
    );
  }
  if (looksLikeExperimentId(right) && !looksLikeExperimentId(left)) {
    return { label: left, experiment: right };
  }
  if (looksLikeExperimentId(left) && !looksLikeExperimentId(right)) {
    return { label: right, experiment: left };
  }
  return { label: right, experiment: left };
}

function looksLikeExperimentId(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) || /^[a-z][a-z0-9_-]*-[a-f0-9]{4,}$/i.test(value)
  );
}

async function resolveCompareInputs(
  options: CompareOptions,
): Promise<ResolvedCompareInput[]> {
  const inputs = options.project
    ? options.experiments.map((experiment) => ({
        ...experiment,
        project: options.project,
      }))
    : options.experiments;
  const resolved = await resolveExperimentProjectsAcrossProjects(
    options.project ? [options.project] : DEFAULT_LIST_PROJECTS,
    inputs,
  );

  return inputs.map((input, index) => ({
    ...input,
    ...resolved[index],
    project: resolved[index].projectName,
  }));
}

function formatExperimentArg(input: ResolvedCompareInput): string {
  if (input.label === input.experiment) return input.experiment;
  return `${input.label}=${input.experiment}`;
}

function formatPassRate(experiment: ExperimentData, color = true): string {
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
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Compare data file was not written: ${dataPath}`);
  }
  const rows = JSON.parse(
    fs.readFileSync(dataPath, "utf8"),
  ) as ExperimentData[];
  const mode = detectCompareMode(rows);
  const leaderIndex = rows.length > 1 ? findLeaderIndex(rows) : -1;
  const sharedTasks = mode === "core" ? sharedTaskNames(rows) : [];
  const sharedMetrics = mode === "core" ? sharedMetricKeys(rows) : [];
  const sharedCases = mode === "bench" ? sharedBenchCaseKeys(rows) : [];
  const metricSpreads = sharedMetrics
    .map((key) => {
      const values = rows
        .map((row) => row.taskMetrics[key]?.mean)
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        values,
        spread:
          values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
      };
    })
    .filter((entry) => entry.spread > 0)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 5)
    .map((entry) => ({
      metric: entry.key,
      spread: entry.spread,
      values: rows.map((row) => row.taskMetrics[entry.key]?.mean ?? null),
    }));

  const differingTasks = sharedTasks
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
    .slice(0, 8)
    .map((entry) => ({
      task: entry.name,
      outcomes: rows.map((row, index) => ({
        label: row.label,
        project: row.projectName,
        passed: entry.outcomes[index],
      })),
    }));
  const caseDiffs = mode === "bench" ? benchCaseDiffs(rows) : [];
  const differingCases = caseDiffs
    .filter((entry) => entry.differs && !entry.missing)
    .slice(0, 8)
    .map((entry) => ({
      key: entry.key,
      suite: entry.suite,
      dataset: entry.dataset,
      taskId: entry.taskId,
      model: entry.model,
      agentMode: entry.agentMode,
      outcomes: entry.outcomes,
    }));
  const missingCases = caseDiffs
    .filter((entry) => entry.missing)
    .slice(0, 8)
    .map((entry) => ({
      key: entry.key,
      suite: entry.suite,
      dataset: entry.dataset,
      taskId: entry.taskId,
      model: entry.model,
      agentMode: entry.agentMode,
      outcomes: entry.outcomes,
    }));
  const agentConfigs =
    mode === "bench"
      ? rows.map((row) => ({
          label: row.label,
          project: row.projectName,
          configs: summarizeBenchAgentConfigs(row.benchCases).map((config) => ({
            key: config.key,
            label: config.label,
            models: config.models,
            passed: config.passed,
            total: config.total,
            passScore: config.passScore,
            meanDurationMs: config.meanDurationMs,
          })),
        }))
      : [];
  const experimentMetrics = collectExperimentMetrics(rows).slice(0, 24);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode,
        project,
        reportPath,
        dataPath,
        experiments: rows.map((row, index) => ({
          label: row.label,
          project: row.projectName,
          experimentName: row.experimentName,
          experimentId: row.experimentId,
          experimentUrl: row.experimentUrl,
          passScore: row.passScore,
          passedTasks: row.passedTasks,
          totalTasks: row.totalTasks,
          durationSeconds: row.durationSeconds,
          leader: index === leaderIndex,
        })),
        sharedTasks: sharedTasks.length,
        sharedCases: sharedCases.length,
        sharedMetrics: sharedMetrics.length,
        metricSpreads,
        differingTasks,
        agentConfigs,
        experimentMetrics,
        differingCases,
        missingCases,
      },
      null,
      2,
    ),
  );
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
  const args = platform === "win32" ? ["/c", "start", "", target] : [target];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // best-effort only
  }
}
