/**
 * `evals verify <trajectory-dir>` — re-score a saved trajectory offline.
 *
 * The verifier is browser-free: it consumes a hydrated Trajectory + TaskSpec
 * and returns an EvaluationResult. This command reads the on-disk layout written by
 * `TrajectoryRecorder.persist()` and feeds it through V3Evaluator.verify().
 *
 * Output: writes a new result file under `scores/result_<label>.json`.
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  V3,
  V3Evaluator,
  loadTrajectoryFromDisk,
  nextResultFilename,
  type AvailableModel,
} from "@browserbasehq/stagehand";

import { bold, cyan, dim, gray, green, red, yellow } from "../format.js";

export interface VerifyOptions {
  /** Absolute or cwd-relative path to a `<run-id>/<task-id>/` directory. */
  trajectoryDir: string;
  /** Override the verifier model. Defaults to whatever V3Evaluator picks. */
  model?: string;
  /** Label appended to the output result filename (default: timestamp). */
  label?: string;
  /** Emit machine-readable JSON to stdout instead of human summary. */
  jsonOutput?: boolean;
  /** Don't write to disk — print the result and exit. */
  dryRun?: boolean;
}

export function printVerifyHelp(): void {
  console.log(`
${bold("evals verify")} ${dim("— re-score a saved trajectory offline")}

  ${cyan("Usage")}
    evals verify <trajectory-dir> [options]

  ${cyan("Arguments")}
    <trajectory-dir>       Path to a saved trajectory directory containing
                           trajectory.json (typically under .trajectories/<run-id>/<task-id>/).

  ${cyan("Options")}
    --model <name>         Override the verifier LLM (default: V3Evaluator's default,
                           currently google/gemini-2.5-flash).
    --label <text>         Label appended to the output filename
                           (default: rescore-<ISO timestamp>).
                           File written to scores/result_<label>.json.
    --json                 Emit the result as JSON to stdout instead of a human summary.
    --dry-run              Don't write to disk; print result and exit.
    --help, -h             This message.

  ${cyan("Examples")}
    evals verify .trajectories/2026-05-11T06-47-09-697Z/united_13
    evals verify .trajectories/<run>/<task> --model anthropic/claude-haiku-4-5 --label tuning-pass-1
    evals verify .trajectories/<run>/<task> --json > result.json
`);
}

interface ParsedArgs {
  trajectoryDir?: string;
  model?: string;
  label?: string;
  json?: boolean;
  dryRun?: boolean;
  help?: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h" || a === "help") {
      parsed.help = true;
    } else if (a === "--json") {
      parsed.json = true;
    } else if (a === "--dry-run") {
      parsed.dryRun = true;
    } else if (a === "--model" || a === "--label") {
      const value = args[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(
          `Missing value for ${a}. Run 'evals verify --help' for usage.`,
        );
      }
      if (a === "--model") parsed.model = value;
      else parsed.label = value;
    } else if (!a.startsWith("-") && !parsed.trajectoryDir) {
      parsed.trajectoryDir = a;
    } else {
      throw new Error(
        `Unknown argument: ${a}. Run 'evals verify --help' for usage.`,
      );
    }
  }
  return parsed;
}

export async function handleVerify(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help || !parsed.trajectoryDir) {
    printVerifyHelp();
    if (!parsed.trajectoryDir) {
      process.exitCode = parsed.help ? 0 : 1;
    }
    return;
  }

  const dir = path.resolve(parsed.trajectoryDir);
  await assertTrajectoryDir(dir);

  if (!parsed.json) {
    console.log(`${cyan("▸")} loading trajectory from ${gray(dir)}`);
  }
  const trajectory = await loadTrajectoryFromDisk(dir);
  if (!parsed.json) {
    console.log(
      `  ${green("✓")} ${trajectory.steps.length} steps · status=${trajectory.status} · task=${trajectory.task.id}`,
    );
  }

  // ── Build a verifier without launching a browser ────────────────────────
  // V3Evaluator.verify() only touches v3.logger (to construct an LLMProvider)
  // and the verify(trajectory) call is pure. Constructing V3 without
  // calling init() is safe and avoids any browser/Browserbase setup cost.
  const v3 = new V3({
    env: "LOCAL",
    verbose: 0,
    disableAPI: true,
    ...(parsed.model ? { model: parsed.model as AvailableModel } : {}),
  });

  const evaluator = new V3Evaluator(v3, {
    backend: "verifier",
    ...(parsed.model ? { modelName: parsed.model as AvailableModel } : {}),
  });

  if (!parsed.json) {
    console.log(
      `${cyan("▸")} running V3Evaluator.verify()${parsed.model ? ` with model=${parsed.model}` : ""}`,
    );
  }
  const startMs = Date.now();
  const result = await evaluator.verify(trajectory);
  const elapsedMs = Date.now() - startMs;

  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  // ── Human summary ──────────────────────────────────────────────────────
  console.log(`  ${green("✓")} verified in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log();
  const processScore =
    result.processScore === undefined ? "n/a" : result.processScore.toFixed(3);
  console.log(
    `${bold("Result")}  outcomeSuccess=${result.outcomeSuccess}  processScore=${processScore}`,
  );
  const perCriterion = result.perCriterion ?? [];
  const evidenceInsufficient = result.evidenceInsufficient ?? [];
  console.log(
    `${dim("       ")} criteria=${perCriterion.length}  evidenceInsufficient=${evidenceInsufficient.length}`,
  );

  if (perCriterion.length > 0) {
    console.log();
    console.log(bold("Per-criterion"));
    for (const c of perCriterion) {
      const earned = c.earnedPoints === null ? "—" : c.earnedPoints.toFixed(1);
      const flag = c.evidenceInsufficient
        ? ` ${yellow("[evidence_insufficient]")}`
        : "";
      console.log(`  ${cyan(earned)}/${c.maxPoints}  ${c.criterion}${flag}`);
      if (c.explanation) {
        console.log(`    ${dim(c.explanation.slice(0, 220))}`);
      }
    }
  }

  if (result.findings && result.findings.length > 0) {
    console.log();
    console.log(bold(`Findings (${result.findings.length})`));
    for (const f of result.findings) {
      const sev =
        f.severity === "blocking"
          ? red(`[${f.severity}]`)
          : f.severity === "warning"
            ? yellow(`[${f.severity}]`)
            : dim(`[${f.severity}]`);
      const steps = f.relatedSteps?.length
        ? gray(` steps=[${f.relatedSteps.join(",")}]`)
        : "";
      console.log(`  ${sev} ${f.category}${steps}`);
      console.log(`    ${f.description}`);
      if (f.suggestedAction) {
        console.log(`    ${green("→")} ${f.suggestedAction}`);
      }
    }
  }

  // ── Persist ────────────────────────────────────────────────────────────
  if (parsed.dryRun) {
    console.log();
    console.log(dim("dry-run: result not written to disk"));
    return;
  }
  const filename = nextResultFilename(parsed.label);
  const outPath = path.join(dir, "scores", filename);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log();
  console.log(
    `${green("✓")} wrote ${cyan(path.relative(process.cwd(), outPath))}`,
  );
}

async function assertTrajectoryDir(dir: string): Promise<void> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} is not a directory`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Trajectory directory not found: ${dir}`, { cause: e });
    }
    throw e;
  }
  try {
    await fs.access(path.join(dir, "trajectory.json"));
  } catch {
    throw new Error(
      `Missing trajectory.json in ${dir}. Is this a valid trajectory directory?`,
    );
  }
}
