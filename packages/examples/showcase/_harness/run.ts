import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { z } from "zod/v4";
import { runPlaywrightMcp } from "./baseline.ts";
import { runCodeMode } from "./codemode.ts";
import { PRICES } from "./pricing.ts";
import { compressRecording, downloadRecording, extractPoster } from "./recording.ts";
import {
  summarize,
  type RunMetrics,
  type RunSummary,
  type ShowcaseResults,
  type TimelineStep,
} from "./results.ts";
import { MODEL } from "./session.ts";
import { runStagehand, type StagehandRun } from "./stagehand.ts";
import type { ShowcaseTask, Workflow } from "./task.ts";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(EXAMPLES, ".env"), quiet: true });

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "3" },
    "skip-baseline": { type: "boolean", default: false },
    "skip-cached": { type: "boolean", default: false },
    "skip-video": { type: "boolean", default: false },
    "skip-code-mode": { type: "boolean", default: false },
    "skip-script": { type: "boolean", default: false },
  },
});

const slug = positionals[0];
if (!slug)
  throw new Error("Usage: pnpm showcase <slug> [--runs 3] [--skip-baseline] [--skip-cached]");
const runs = Number(values.runs);
const dir = join(EXAMPLES, slug);
const out = join(dir, ".out");
await mkdir(out, { recursive: true });

const workflow = (await import(
  pathToFileURL(join(dir, "workflow.ts")).href
)) as Workflow<z.ZodType>;
const { task } = (await import(pathToFileURL(join(dir, "task.ts")).href)) as {
  task: ShowcaseTask<z.ZodType>;
};

const log = (message: string) => console.log(`[${slug}] ${message}`);
const describe = (run: RunMetrics) =>
  `${run.success ? "ok" : "FAILED"} ${run.inputTokens + run.outputTokens} tok $${run.costUsd.toFixed(4)} ${(run.durationMs / 1000).toFixed(1)}s${run.error ? ` (${run.error})` : ""}`;

// Account problems are not task failures: recording them would publish a
// success rate that says nothing about the task. Stop and fix the account.
const FATAL =
  /credit balance|insufficient_quota|invalid x-api-key|incorrect api key|authentication_error/i;

async function repeat<T extends { metrics: RunMetrics }>(label: string, fn: () => Promise<T>) {
  const results: T[] = [];
  for (let i = 1; i <= runs; i++) {
    const result = await fn();
    log(`${label} ${i}/${runs}: ${describe(result.metrics)}`);
    if (result.metrics.error && FATAL.test(result.metrics.error)) {
      throw new Error(`Aborting: provider account error, nothing written. ${result.metrics.error}`);
    }
    results.push(result);
  }
  return results;
}

type Featured = {
  metrics: RunMetrics;
  sessionId: string | undefined;
  output: unknown;
  steps: Array<{ startedAt: number } & Omit<TimelineStep, "t">>;
};

const codeModeRuns = values["skip-code-mode"]
  ? null
  : await repeat("stagehand code mode", () => runCodeMode(workflow, task));

const baselineRuns = values["skip-baseline"]
  ? null
  : await repeat("playwright mcp", () => runPlaywrightMcp(workflow, task));

const scriptRuns = values["skip-script"]
  ? null
  : await repeat("stagehand script", () => runStagehand(workflow, task, { cache: false }));

let cachedRuns: StagehandRun[] | null = null;
if (scriptRuns && !values["skip-cached"]) {
  const seed = await runStagehand(workflow, task, { cache: true });
  log(`cache seed: ${describe(seed.metrics)}`);
  cachedRuns = await repeat("stagehand script cached", () =>
    runStagehand(workflow, task, { cache: true }),
  );
}

// A skipped lane keeps its numbers from the previous results file, so one lane
// can be re-run without paying for the others again. Version 1 files used the
// names stagehand / stagehandCached for the script lanes.
type Lanes = ShowcaseResults["runs"];
const previous: Partial<Lanes> = await readFile(join(out, "results.json"), "utf8")
  .then((text) => {
    const old = JSON.parse(text) as {
      schemaVersion: number;
      runs: Record<string, RunSummary | null>;
    };
    return old.schemaVersion === 1
      ? {
          playwrightMcp: old.runs.playwrightMcp,
          script: old.runs.stagehand,
          scriptCached: old.runs.stagehandCached,
        }
      : (old.runs as Partial<Lanes>);
  })
  .catch(() => ({}));

const summaryOf = (lane: { metrics: RunMetrics }[] | null, name: keyof Lanes) =>
  lane ? summarize(lane.map((run) => run.metrics)) : (previous[name] ?? null);

// The headline recording is the code-mode agent: the successful run closest to
// the median duration, so the video shows a typical run, not the luckiest one.
const featuredLane: Featured[] = (codeModeRuns ?? scriptRuns ?? []) as Featured[];
const featuredSummary = summarize(featuredLane.map((run) => run.metrics));
const successful = featuredLane.filter((run) => run.metrics.success);
const featured = [...(successful.length ? successful : featuredLane)].sort(
  (a, b) =>
    Math.abs(a.metrics.durationMs - featuredSummary.median.durationMs) -
    Math.abs(b.metrics.durationMs - featuredSummary.median.durationMs),
)[0];
if (!featured) throw new Error("Nothing ran: every lane was skipped");

let video: ShowcaseResults["video"] = null;
let startedAtMs: number | undefined;
let trimmedMs = 0;
if (!values["skip-video"] && featured.sessionId) {
  log(`downloading recording for session ${featured.sessionId}`);
  const raw = join(out, "recording.raw.mp4");
  ({ startedAtMs } = await downloadRecording(featured.sessionId, raw));
  trimmedMs = (await compressRecording(raw, join(out, "recording.mp4"))) * 1000;
  await extractPoster(join(out, "recording.mp4"), join(out, "poster.jpg"));
  video = { file: "recording.mp4", poster: "poster.jpg" };
}

const firstStep = featured.steps[0]?.startedAt;
const timeline = featured.steps.map(({ startedAt, ...step }) => ({
  ...step,
  t: Math.max(0, (startedAt - (startedAtMs ?? firstStep ?? startedAt) - trimmedMs) / 1000),
}));

const require = createRequire(import.meta.url);
const version = (pkg: string) =>
  (JSON.parse(readFileSync(require.resolve(pkg), "utf8")) as { version: string }).version;

const results: ShowcaseResults = {
  schemaVersion: 2,
  slug,
  ranAt: new Date().toISOString(),
  stagehandVersion: version("../../sdk-ts/package.json"),
  playwrightMcpVersion: version("@playwright/mcp/package.json"),
  model: MODEL,
  price: PRICES[MODEL]!,
  startUrl: task.startUrl,
  output: featured.output,
  goal: task.goal,
  timeline,
  video,
  snippet: await readFile(join(dir, "workflow.ts"), "utf8"),
  featuredLane: codeModeRuns ? "codeMode" : "script",
  runs: {
    codeMode: summaryOf(codeModeRuns, "codeMode"),
    playwrightMcp: summaryOf(baselineRuns, "playwrightMcp"),
    script: summaryOf(scriptRuns, "script"),
    scriptCached: summaryOf(cachedRuns, "scriptCached"),
  },
};

await writeFile(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
log(`wrote ${join(out, "results.json")}`);
