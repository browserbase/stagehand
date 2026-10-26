import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://www.stagehand.dev/evals",
  goal: 'On stagehand.dev/evals, read the leaderboard for the "Browserbase Benchmark v2" benchmark and then for the "Online Mind2Web" benchmark. For each, report the top 10 rows with rank, model, harness, accuracy in percent, cost per task in USD and seconds per task (null if not shown).',
  check: ({ benchmarks }) =>
    benchmarks.length === 2 &&
    benchmarks.every(
      (benchmark) =>
        benchmark.rows.length === 10 &&
        new Set(benchmark.rows.map((row) => row.model)).size >= 5 &&
        benchmark.rows.every((row) => row.accuracyPct >= 0 && row.accuracyPct <= 100),
    ),
};
