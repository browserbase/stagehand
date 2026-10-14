import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const BENCHMARKS = ["Browserbase Benchmark v2", "Online Mind2Web"];
const TOP = 10;

const leaderboard = z.object({
  rows: z.array(
    z.object({
      rank: z.number(),
      model: z.string(),
      harness: z.string().describe("The agent harness the model ran in, e.g. claude code"),
      accuracyPct: z.number(),
      costPerTaskUsd: z.number().nullable(),
      secondsPerTask: z.number().nullable(),
    }),
  ),
});

export const schema = z.object({
  benchmarks: z.array(leaderboard.extend({ name: z.string() })),
});

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  await page.goto("https://www.stagehand.dev/evals");
  await page.waitForLoadState("networkidle", 10_000).catch(() => undefined);

  const benchmarks = [];
  for (const name of BENCHMARKS) {
    // One page, one switcher: the table re-renders in place for each benchmark.
    await stagehand.act(`Select the "${name}" benchmark`, { page });
    const { data } = await stagehand.extract(
      `The top ${TOP} rows of the leaderboard table, by rank`,
      leaderboard,
      { page },
    );
    benchmarks.push({ name, rows: data.rows.slice(0, TOP) });
  }
  return { benchmarks };
}
