/**
 * The public leaderboard, in the terminal.
 *
 * stagehand.dev/evals ranks models on Browserbase Benchmark v1 by accuracy,
 * speed, and cost. This module renders that table with the wizard's panel
 * primitives so onboarding can open on the *why* — and append the user's own
 * first run as a row in the same format. Rows are a static snapshot (no
 * network in onboarding); `asOf` is shown so nobody mistakes it for live.
 */

import { c, visibleLength } from "../format.js";
import { padTo, panel, MINT, rgb } from "../wizardAnim.js";

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

const BAR_W = 12;
const MODEL_W = 18;

function bar(frac: number, width = BAR_W, color: string = c.bb): string {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return `${color}${"▰".repeat(filled)}${c.reset}${c.gray}${"▱".repeat(width - filled)}${c.reset}`;
}

export function fmtSpeed(s: number): string {
  return s >= 100 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
}
export function fmtCost(usd: number): string {
  return `$${usd.toFixed(3)}`;
}

export type YourRow = {
  label: string; // e.g. "you · navigation/open"
  accuracy: number;
  speedS: number;
  costUsd: number;
};

/**
 * Render the table. `progress` (0–1) scales every bar and number so the
 * caller can count the table up into place; `yourRow` appends a highlighted
 * row in the same columns.
 */
export function renderLeaderboard(opts: {
  rows?: LeaderboardRow[];
  /** 0–1: scales the public rows' bars and numbers. */
  progress?: number;
  yourRow?: YourRow | null;
  /** 0–1: scales only `yourRow` (defaults to `progress`) so it can count up alone. */
  yourProgress?: number;
  indent?: number;
}): string[] {
  const { rows = LEADERBOARD, progress = 1, yourRow = null, indent = 2 } = opts;
  const p = Math.max(0, Math.min(1, progress));
  const yp = Math.max(0, Math.min(1, opts.yourProgress ?? progress));
  const head = `${c.dim}${padTo("model", MODEL_W)}  ${padTo("accuracy", BAR_W + 8)}  ${padTo("speed", 6)}  cost${c.reset}`;
  const body = rows.map((r, i) => {
    const acc = r.accuracy * p;
    const rank = `${c.gray}${i + 1}${c.reset}`;
    return `${rank} ${padTo(r.model, MODEL_W - 2)}  ${bar(acc / 100)} ${c.bb}${acc.toFixed(1).padStart(5)}%${c.reset}  ${c.dim}${fmtSpeed(r.speedS * p).padStart(5)}${c.reset}  ${c.dim}${fmtCost(r.costUsd * p)}${c.reset}`;
  });
  const lines = [head, ...body];
  if (yourRow) {
    const mint = rgb(MINT);
    const acc = yourRow.accuracy * yp;
    lines.push("");
    lines.push(
      `${mint}▸${c.reset} ${mint}${padTo(yourRow.label, MODEL_W - 2)}${c.reset}  ${bar(acc / 100, BAR_W, mint)} ${mint}${acc.toFixed(1).padStart(5)}%${c.reset}  ${c.dim}${fmtSpeed(yourRow.speedS * yp).padStart(5)}${c.reset}  ${c.dim}${fmtCost(yourRow.costUsd)}${c.reset}`,
    );
  }
  const width = Math.max(...lines.map((l) => visibleLength(l)));
  return panel(lines, {
    title: LEADERBOARD_BENCHMARK,
    footer: `${LEADERBOARD_URL} · ${LEADERBOARD_AS_OF}`,
    indent,
    width,
  });
}
