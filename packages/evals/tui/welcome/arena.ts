/**
 * Welcome design a — Arena.
 *
 * Competition is the most legible frame for a leaderboard product: three
 * models attempt the SAME real benchmark task in parallel lanes; whoever gets
 * there correctly wins. The race is a deterministic replay of a real
 * WebVoyager case (agentScript.ts) paced by each model's public speed/cost
 * profile, drawn as continuous motion on an fx Canvas: runners ease along
 * their tracks and leave glow trails, finishes burst, podium blocks rise.
 * Palette semantics: accuracy = brand, speed = cyan, cost = amber, fail = rose.
 */

import { c } from "../format.js";
import { markFirstRunComplete } from "../welcomeState.js";
import {
  animate,
  Canvas,
  clamp01,
  ease,
  fillGlyph,
  GLOW,
  glowGlyph,
  METRIC,
  mixRgb,
  PALETTE,
  ramp,
  seeded,
} from "../fx.js";
import {
  canAnimateInPlace,
  listenForSkip,
  LiveBlock,
  READING_MS_PER_WORD,
  revealLines,
  ruleHeader,
  setCursorHidden,
  sleep,
  termSize,
  type RGB,
  type SkipSignal,
} from "../wizardAnim.js";
import {
  loadScriptedCases,
  MODEL_PROFILES,
  type ScriptStep,
  type ScriptedCase,
  type StepKind,
} from "./agentScript.js";
import { runIntro } from "./intro.js";
import { detectMachine } from "./detect.js";
import { handoffChip } from "./handoff.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

/** Slowest lane (speedMul 1.6 × ~9s case) lands at ~8s. */
const TIME_SCALE = 0.55;
const FPS = 24;
const BURST_MS = 650;
const TRAIL = 8;

const BADGE: Record<StepKind, { label: string; color: RGB }> = {
  goto: { label: "GOTO", color: PALETTE.slate },
  think: { label: "THINK", color: PALETTE.slate },
  observe: { label: "OBSERVE", color: PALETTE.cyan },
  act: { label: "ACT", color: PALETTE.brand },
  extract: { label: "EXTRACT", color: PALETTE.amber },
  answer: { label: "ANSWER", color: PALETTE.mint },
  judge: { label: "JUDGE", color: PALETTE.slate },
};

/** Lane identities from the non-metric part of the palette. */
const LANE_COLORS: RGB[] = [PALETTE.brand, PALETTE.white, PALETTE.teal];

type Lane = {
  name: string;
  color: RGB;
  steps: ScriptStep[];
  totalMs: number;
  costUsd: number;
  passes: boolean;
  failReason: string;
};

type Burst = { x: number; y: number; at: number; color: RGB; seeds: Array<[number, number]> };

function canvasWidth(): number {
  return Math.max(60, Math.min(termSize().cols - 2, 90));
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildLanes(cs: ScriptedCase): Lane[] {
  return MODEL_PROFILES.slice(0, 3).map((p, i) => {
    let steps = cs.steps.map((s) => ({ ...s, ms: Math.round(s.ms * p.speedMul * TIME_SCALE) }));
    let passes = true;
    let failReason = "";
    if (i === 2) {
      // Fastest lane, wrong filter: deterministic fail.
      const n = steps.length;
      steps = steps.map((s, k) =>
        k === n - 2
          ? { ...s, text: 'first "Used - Acceptable" listing → $129.00, Gray' }
          : k === n - 1
            ? { ...s, text: "Cheapest used: Nintendo Switch Lite (Gray), $129.00" }
            : s,
      );
      passes = false;
      failReason = "wrong condition filter";
    }
    return {
      name: p.name,
      color: LANE_COLORS[i],
      steps,
      totalMs: steps.reduce((a, s) => a + s.ms, 0),
      costUsd: cs.costUsd * p.costMul,
      passes,
      failReason,
    };
  });
}

function fmtS(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtCost(usd: number): string {
  return `$${usd.toFixed(3)}`;
}

/** Current step index for a lane at race time t. */
function stepAt(lane: Lane, t: number): { idx: number; frac: number } {
  let acc = 0;
  for (let i = 0; i < lane.steps.length; i++) {
    const s = lane.steps[i];
    if (t < acc + s.ms) return { idx: i, frac: (t - acc) / s.ms };
    acc += s.ms;
  }
  return { idx: lane.steps.length - 1, frac: 1 };
}

/**
 * Runner progress 0→1: each step owns an equal slice of the track and the
 * runner eases through it, so motion is continuous, never a teleport.
 */
function runnerProgress(lane: Lane, t: number): number {
  if (t >= lane.totalMs) return 1;
  const { idx, frac } = stepAt(lane, t);
  const n = lane.steps.length;
  return (idx + ease.inOutSine(clamp01(frac))) / n;
}

// ─── Drawing helpers ────────────────────────────────────────────────────

function drawBox(
  cv: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  title?: string,
): void {
  cv.text(x, y, `╭${"─".repeat(w - 2)}╮`, color);
  for (let r = 1; r < h - 1; r++) {
    cv.put(x, y + r, "│", color);
    cv.put(x + w - 1, y + r, "│", color);
  }
  cv.text(x, y + h - 1, `╰${"─".repeat(w - 2)}╯`, color);
  if (title) cv.text(x + 2, y, ` ${title} `, PALETTE.brand);
}

/** Copy columns [0, wipeX) of `full` into a fresh canvas with a bright leading edge. */
function wipeFrame(full: Canvas, wipeX: number): Canvas {
  const cv = new Canvas(full.width, full.height);
  const edge = Math.floor(wipeX);
  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      const g = full.glyphs[y][x];
      if (g === " ") continue;
      if (x < edge - 1) cv.put(x, y, g, full.colors[y][x]);
      else if (x <= edge) cv.put(x, y, g, PALETTE.mint);
    }
  }
  return cv;
}

function buildTaskCard(cs: ScriptedCase, w: number): Canvas {
  const body = wrapText(cs.task, w - 8);
  const h = body.length + 4;
  const cv = new Canvas(w, h);
  drawBox(cv, 0, 0, w, h, PALETTE.slate, `WebVoyager · ${cs.id} · a real benchmark case`);
  cv.text(3, 1, cs.site, PALETTE.brand);
  cv.text(3 + cs.site.length + 2, 1, cs.startUrl, PALETTE.slate);
  body.forEach((l, i) => cv.text(3, 3 + i, l, PALETTE.white));
  return cv;
}

// ─── Race ───────────────────────────────────────────────────────────────

const LANE_ROWS = 4;

function drawRace(
  cv: Canvas,
  lanes: Lane[],
  t: number,
  time: number,
  bursts: Burst[],
  raceEnd: boolean,
): void {
  const w = cv.width;
  const trackX = 4;
  const trackLen = w - trackX - 6;
  const finishX = trackX + trackLen;

  lanes.forEach((lane, li) => {
    const y0 = 1 + li * LANE_ROWS;
    const done = t >= lane.totalMs;
    const laneColor = done && !lane.passes ? PALETTE.rose : lane.color;

    // Row 0: identity + live clock / verdict chip.
    cv.text(
      2,
      y0,
      done ? (lane.passes ? "✓" : "✗") : "●",
      done ? (lane.passes ? PALETTE.brand : PALETTE.rose) : laneColor,
    );
    cv.text(4, y0, lane.name, laneColor);
    if (done) {
      const timeS = fmtS(lane.totalMs);
      const cost = fmtCost(lane.costUsd);
      const chip = `${timeS} · ${cost}`;
      const x = w - chip.length - 2;
      cv.text(x, y0, timeS, METRIC.speed);
      cv.text(x + timeS.length, y0, " · ", PALETTE.slate);
      cv.text(x + timeS.length + 3, y0, cost, METRIC.cost);
    } else {
      const clock = fmtS(Math.min(t, lane.totalMs));
      cv.text(w - clock.length - 2, y0, clock, METRIC.speed);
    }

    // Row 1: track, trail, runner, finish post.
    const p = runnerProgress(lane, t);
    const rx = trackX + p * (trackLen - 1);
    for (let x = trackX; x < finishX; x++) cv.put(x, y0 + 1, "─", PALETTE.deep);
    for (let k = TRAIL; k >= 1; k--) {
      const tx = rx - k;
      if (tx < trackX) continue;
      const intensity = (1 - k / (TRAIL + 1)) * (done ? 0.35 : 0.8);
      cv.put(tx, y0 + 1, k <= 2 ? "━" : "─", mixRgb(PALETTE.deep, laneColor, intensity));
    }
    if (!done) cv.put(rx, y0 + 1, "●", mixRgb(laneColor, PALETTE.mint, 0.5));
    else cv.put(finishX - 1, y0 + 1, "━", laneColor);
    const pulse = 0.35 + 0.2 * Math.sin(time * 4 + li);
    cv.put(finishX, y0 + 1, "┃", ramp(GLOW, raceEnd ? 0.3 : pulse));

    // Row 2: current step with a kind badge (or the judge line).
    if (done) {
      cv.text(4, y0 + 2, "JUDGE", PALETTE.slate);
      if (lane.passes) {
        cv.text(12, y0 + 2, "pass", PALETTE.brand);
        cv.text(
          17,
          y0 + 2,
          `— ${lane.steps[lane.steps.length - 1].text}`.slice(0, w - 19),
          PALETTE.slate,
        );
      } else {
        cv.text(12, y0 + 2, "fail", PALETTE.rose);
        cv.text(17, y0 + 2, `— ${lane.failReason}`, PALETTE.slate);
      }
    } else {
      const { idx } = stepAt(lane, t);
      const step = lane.steps[idx];
      const badge = BADGE[step.kind];
      cv.text(4, y0 + 2, badge.label.padEnd(8), badge.color);
      cv.text(12, y0 + 2, step.text.slice(0, w - 14), PALETTE.slate);
    }
  });

  // Finish bursts: particles expanding from the finish post, fading.
  for (const b of bursts) {
    const age = time * 1000 - b.at;
    if (age < 0 || age > BURST_MS) continue;
    const k = ease.outCubic(age / BURST_MS);
    const alpha = 1 - age / BURST_MS;
    for (const [dx, dy] of b.seeds) {
      const x = b.x + dx * k * 9;
      const y = b.y + dy * k * 1.6;
      cv.put(x, y, glowGlyph(alpha), mixRgb(b.color, PALETTE.mint, 0.4 * alpha));
    }
  }
}

function raceHeight(lanes: Lane[]): number {
  return 1 + lanes.length * LANE_ROWS;
}

// ─── Podium ─────────────────────────────────────────────────────────────

type Ranked = Lane & { rank: number; finishMs: number };

function rankLanes(lanes: Lane[]): Ranked[] {
  return [...lanes]
    .sort((a, b) => (a.passes !== b.passes ? (a.passes ? -1 : 1) : a.totalMs - b.totalMs))
    .map((l, i) => ({ ...l, rank: i + 1, finishMs: l.totalMs }));
}

const PODIUM_H = 12;
const BLOCK_W = 18;
const BLOCK_HEIGHTS = [5, 3.5, 2.5]; // rank 1, 2, 3 (rows)

/** t: 0→1 over the podium animation. */
function drawPodium(cv: Canvas, ranked: Ranked[], t: number, time: number): void {
  const w = cv.width;
  const floorY = 7;
  const gap = Math.floor((w - BLOCK_W * 3) / 4);
  // Classic arrangement: 2nd left, 1st center, 3rd right.
  const order = [ranked[1], ranked[0], ranked[2]];
  order.forEach((l, slot) => {
    const x = gap + slot * (BLOCK_W + gap);
    const targetH = BLOCK_HEIGHTS[l.rank - 1];
    const riseT = clamp01((t - slot * 0.06) / 0.38);
    const h = targetH * ease.outBack(riseT);
    const winner = l.rank === 1;
    const breathe = winner && t > 0.55 ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
    const baseColor = l.passes
      ? mixRgb(PALETTE.deep, l.color, 0.55)
      : mixRgb(PALETTE.deep, PALETTE.rose, 0.55);
    const color = winner ? mixRgb(baseColor, PALETTE.mint, 0.35 * breathe) : baseColor;
    const full = Math.floor(Math.max(0, h));
    for (let r = 0; r < full; r++) {
      cv.text(x, floorY - 1 - r, "█".repeat(BLOCK_W), color);
    }
    if (h > 0) cv.text(x, floorY - 1 - full, fillGlyph(h - full).repeat(BLOCK_W), color);
    if (riseT > 0.6) {
      const label = `${l.rank}`;
      cv.text(x + Math.floor((BLOCK_W - label.length) / 2), floorY - 1, label, PALETTE.white);
      const name = l.name.length > BLOCK_W ? l.name.slice(0, BLOCK_W - 1) + "…" : l.name;
      const nameY = floorY - 2 - Math.ceil(h);
      cv.text(
        x + Math.floor((BLOCK_W - name.length) / 2),
        Math.max(0, nameY),
        name,
        l.passes ? PALETTE.white : PALETTE.rose,
      );
    }
    // Metrics fade in beneath the floor.
    const fade = ease.inOutSine(clamp01((t - 0.38 - slot * 0.05) / 0.2));
    if (fade > 0) {
      const acc = l.passes ? "✓ 100%" : "✗   0%";
      const rows: Array<[string, RGB]> = [
        [acc, l.passes ? METRIC.accuracy : PALETTE.rose],
        [fmtS(l.finishMs), METRIC.speed],
        [fmtCost(l.costUsd), METRIC.cost],
      ];
      rows.forEach(([text, col], i) => {
        cv.text(
          x + Math.floor((BLOCK_W - text.length) / 2),
          floorY + 1 + i,
          text,
          mixRgb(PALETTE.void, col, fade),
        );
      });
    }
  });
  cv.text(0, floorY, "▔".repeat(w), PALETTE.deep);
  const legend = ["accuracy", "speed", "cost"];
  const legendColors = [METRIC.accuracy, METRIC.speed, METRIC.cost];
  const lfade = ease.inOutSine(clamp01((t - 0.5) / 0.2));
  legend.forEach((word, i) =>
    cv.text(1, floorY + 1 + i, word, mixRgb(PALETTE.void, legendColors[i], lfade * 0.8)),
  );
}

// ─── Flow ───────────────────────────────────────────────────────────────

export async function runArena(ctx: WelcomeRunContext): Promise<WizardOutcome> {
  setCursorHidden(true);
  try {
    return await flow(ctx);
  } finally {
    setCursorHidden(false);
  }
}

function cancelled(): WizardOutcome {
  process.stdout.write(`\n  ${c.dim}(cancelled — we'll show this again next launch)${c.reset}\n\n`);
  return { status: "cancelled" };
}

async function flow(ctx: WelcomeRunContext): Promise<WizardOutcome> {
  const cs = loadScriptedCases()[0];
  const lanes = buildLanes(cs);
  const w = canvasWidth();
  // Shared intro (logo → statement → measures → board). It owns its keys;
  // our skip listener arms only after it returns, so an Esc inside the
  // intro never skips the race as well.
  const opening = await runIntro();
  if (opening.aborted) return cancelled();
  const intro = listenForSkip();
  const signal: SkipSignal = intro.signal;
  try {
    // 2. Task card — horizontal wipe.
    ruleHeader("The task", { eyebrow: "one real benchmark case" });
    const card = buildTaskCard(cs, Math.min(w, 74));
    const cardBlock = new LiveBlock();
    await animate({
      durationMs: 650,
      fps: FPS,
      signal,
      block: cardBlock,
      draw: (t) => wipeFrame(card, ease.outCubic(t) * (card.width + 2)).render(),
    });
    cardBlock.paint(card.render(), { final: true });
    process.stdout.write("\n");
    await sleep(1400, signal);
    if (signal.aborted) return cancelled();

    // 3. Countdown — each number pops with an expanding ring.
    ruleHeader("The race", { eyebrow: "three lanes" });
    const cdBlock = new LiveBlock();
    const cdH = 5;
    for (const label of ["3", "2", "1", "go"]) {
      if (signal.cancelled) break;
      await animate({
        durationMs: 430,
        fps: FPS,
        signal,
        block: cdBlock,
        draw: (t) => {
          const cv = new Canvas(w, cdH);
          const k = ease.outBack(t);
          const cx = Math.floor(w / 2);
          const cy = 2;
          const color = ramp([PALETTE.deep, PALETTE.brand, PALETTE.mint], t);
          const rx = 2 + k * 10;
          const ry = k * 1.6;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
            cv.put(
              cx + Math.cos(a) * rx,
              cy + Math.sin(a) * ry,
              glowGlyph(0.35 * (1 - t) + 0.15),
              mixRgb(PALETTE.deep, color, 0.6),
            );
          }
          cv.text(
            cx - Math.floor(label.length / 2),
            cy,
            label,
            label === "go" ? PALETTE.mint : color,
          );
          return cv.render();
        },
      });
    }
    cdBlock.paint(Array(cdH).fill(""), { final: canAnimateInPlace() });

    // 4. The race.
    const raceBlock = new LiveBlock();
    const maxT = Math.max(...lanes.map((l) => l.totalMs));
    const raceMs = maxT + BURST_MS + 200;
    const rand = seeded(0xa2e4a);
    const bursts: Burst[] = lanes.map((l) => ({
      x: 0,
      y: 0,
      at: l.totalMs,
      color: l.passes ? l.color : PALETTE.rose,
      seeds: Array.from({ length: 16 }, () => {
        const a = rand() * Math.PI * 2;
        const m = 0.5 + rand() * 0.5;
        return [Math.cos(a) * m, Math.sin(a) * m] as [number, number];
      }),
    }));
    const finishX = 4 + (w - 4 - 6);
    lanes.forEach((_, i) => {
      bursts[i].x = finishX;
      bursts[i].y = 2 + i * LANE_ROWS;
    });
    const paints = await animate({
      durationMs: raceMs,
      fps: FPS,
      signal,
      block: raceBlock,
      draw: (t) => {
        const cv = new Canvas(w, raceHeight(lanes));
        const clock = t * raceMs;
        drawRace(cv, lanes, clock, clock / 1000, bursts, false);
        return cv.render();
      },
    });
    {
      const cv = new Canvas(w, raceHeight(lanes));
      drawRace(cv, lanes, Number.MAX_SAFE_INTEGER, 0, [], true);
      raceBlock.paint(cv.render(), { final: true });
    }
    process.stdout.write("\n");
    if (signal.aborted) return cancelled();
    if (process.env.EVALS_WELCOME_DEBUG) {
      process.stdout.write(
        `  ${c.dim}[arena] race paints=${paints} over ${(raceMs / 1000).toFixed(1)}s${c.reset}\n`,
      );
    }

    // 5. Podium rises.
    ruleHeader("Podium", { eyebrow: "accuracy · speed · cost" });
    const ranked = rankLanes(lanes);
    const podiumBlock = new LiveBlock();
    await animate({
      durationMs: 2600,
      fps: FPS,
      signal,
      block: podiumBlock,
      draw: (t) => {
        const cv = new Canvas(w, PODIUM_H);
        drawPodium(cv, ranked, t, t * 2.6);
        return cv.render();
      },
    });
    {
      const cv = new Canvas(w, PODIUM_H);
      drawPodium(cv, ranked, 1, 0);
      podiumBlock.paint(cv.render(), { final: true });
    }
    process.stdout.write("\n");
    await revealLines(
      [
        `  ${c.dim}That's the whole idea:${c.reset} ${c.bb}stagehand.dev/evals${c.reset} ${c.dim}ranks models${c.reset}`,
        `  ${c.dim}exactly like this — across hundreds of tasks, not one.${c.reset}`,
        `  ${c.gray}replay of a real benchmark task · timings and costs illustrative${c.reset}`,
      ],
      { signal, msPerWord: READING_MS_PER_WORD },
    );
    if (signal.aborted) return cancelled();
  } finally {
    intro.release();
  }

  // 6. Hand-off
  const m = detectMachine();
  const tail = listenForSkip();
  let runNext: string | null = null;
  try {
    const lead = m.plan.kind === "real" ? "Race for real:" : "Next:";
    const [firstLine, ...rest] = wrapText(m.recommend.line, 70 - lead.length - 1);
    process.stdout.write(`\n  ${c.bb}${lead}${c.reset} ${c.dim}${firstLine}${c.reset}\n`);
    for (const l of wrapText(rest.join(" "), 70)) {
      if (l) process.stdout.write(`  ${c.dim}${l}${c.reset}\n`);
    }
    runNext = await handoffChip(m.recommend.command ?? "list bench", tail.signal);
    if (tail.signal.aborted) return cancelled();
  } finally {
    tail.release();
  }
  markFirstRunComplete(ctx.entryDir);
  process.stdout.write(
    runNext
      ? `  ${c.bb}✓ Running ${runNext}…${c.reset}\n\n`
      : `  ${c.bb}✓ All set.${c.reset} ${c.dim}Try${c.reset} ${c.bb}list bench${c.reset} ${c.dim}or${c.reset} ${c.bb}evals doctor${c.reset}${c.dim}.${c.reset}\n\n`,
  );
  return { status: "completed", runNext };
}
