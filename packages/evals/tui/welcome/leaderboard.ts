/**
 * The public leaderboard, in the terminal.
 *
 * stagehand.dev/evals ranks models on Browserbase Benchmark v1 by accuracy,
 * speed, and cost. A static snapshot of that table (no network in
 * onboarding); the intro quotes the top row, `asOf` is shown so nobody
 * mistakes it for live.
 */

export const LEADERBOARD_URL = "stagehand.dev/evals";
export const LEADERBOARD_BENCHMARK = "Browserbase Benchmark v1";
export const LEADERBOARD_AS_OF = "Sep 2026";

export type LeaderboardRow = {
  model: string;
  /** 0–100 */
  accuracy: number;
  /** seconds per task */
  speedS: number;
  /** dollars per task */
  costUsd: number;
};

export const LEADERBOARD: LeaderboardRow[] = [
  { model: "Claude Fable 5.1", accuracy: 92.1, speedS: 303, costUsd: 0.22 },
  { model: "Claude Fable 5", accuracy: 90.6, speedS: 530, costUsd: 0.522 },
  { model: "GPT-5.6-Sol", accuracy: 85.7, speedS: 168, costUsd: 0.947 },
  { model: "Claude Opus 5", accuracy: 85.7, speedS: 220, costUsd: 0.528 },
  { model: "Claude Opus 4.8", accuracy: 83.3, speedS: 185, costUsd: 0.448 },
];
