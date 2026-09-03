/**
 * Welcome design e — "Dialogue".
 *
 * The agent introduces itself. Onboarding as a live chat: the agent narrates
 * a real WebVoyager task in the first person, the browser answers with what
 * it sees, tool calls show up as chips, and a judge stamps the result. We
 * replay the FAIL case on purpose — a judge with something to say is the
 * whole point of evals.
 *
 * Motion: bubbles slide in (eased) and warm from slate to their speaker's
 * color; a typing indicator bobs before the agent speaks; chips flash on
 * arrival; the judge lands with an overshoot and a rose glow. Speakers sit in
 * an 8-column gutter; bubbles are rounded panels indented 10.
 */

import * as clack from "@clack/prompts";
import { c, stripAnsi, visibleLength } from "../format.js";
import { animate, ease, fg, mixRgb, PALETTE } from "../fx.js";
import { markFirstRunComplete } from "../welcomeState.js";
import {
  canAnimateInPlace,
  listenForSkip,
  LiveBlock,
  panel,
  READING_MS_PER_WORD,
  setCursorHidden,
  sleep,
  type RGB,
  type SkipSignal,
} from "../wizardAnim.js";
import { loadScriptedCases, type ScriptStep, type ScriptedCase } from "./agentScript.js";
import { runIntro } from "./intro.js";
import { detectMachine } from "./detect.js";
import { handoffChip } from "./handoff.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

// ─── Layout ─────────────────────────────────────────────────────────────

const GUTTER = 8; // speaker column, right-aligned
const INDENT = GUTTER + 2; // bubble left edge
const MAX_INNER = 50; // bubble ≤ 64 cols; + stamp ≤ 72
const SPEAKER_PAUSE_MS = 320;
const SLIDE_MS = 240;
const TYPING_MS = 600;

type Speaker = "agent" | "browser" | "judge" | "you";

const SPEAKER_COLOR: Record<Speaker, RGB> = {
  agent: PALETTE.brand,
  browser: PALETTE.cyan,
  judge: PALETTE.rose,
  you: PALETTE.white,
};

/** How far each speaker slides in from (columns off its resting edge). */
const SLIDE_FROM: Record<Speaker, number> = { agent: 6, browser: 8, judge: 10, you: 8 };

/** The agent speaks from the left; the browser, the judge and you answer from the right. */
const RIGHT_ALIGNED: Record<Speaker, boolean> = {
  agent: false,
  browser: true,
  judge: true,
  you: true,
};
/** Visible measure every bubble row stays within. */
const MEASURE = 72;

/** Word-wrap plain text to `width` visible columns. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && visibleLength(line) + 1 + visibleLength(word) > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

function fmtStamp(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = ((total % 60000) / 1000).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

function label(who: Speaker, tint: RGB): string {
  return `${fg(tint)}${who.padStart(GUTTER)}${c.reset}`;
}

type BubbleOpts = {
  /** Border + label color. Callers fade this from slate to the speaker color. */
  tint: RGB;
  /** Extra columns to the right of the resting edge (during a slide). */
  shift?: number;
  stamp?: number;
  /** Style for the text lines (e.g. c.dim for quotes). */
  style?: string;
  /** Pre-rendered first content line (may carry its own colors). */
  firstLine?: string;
};

/**
 * A chat bubble: rounded panel under the gutter, speaker label on the first
 * content row, optional dim elapsed stamp to its right. Every row shifts by
 * the same amount so a sliding bubble is never jagged.
 */
function bubble(who: Speaker, text: string, o: BubbleOpts): string[] {
  const style = o.style ?? "";
  const lines = wrap(text, MAX_INNER).map((l) => `${style}${l}${style ? c.reset : ""}`);
  if (o.firstLine) lines[0] = o.firstLine;
  const width = Math.max(...lines.map((l) => visibleLength(l)));
  const shiftN = Math.max(0, Math.round(o.shift ?? 0));

  if (!RIGHT_ALIGNED[who]) {
    // Left: gutter label, bubble, stamp trailing the first row.
    const rows = panel(lines, { indent: INDENT, padX: 1, width, border: fg(o.tint) });
    const shift = " ".repeat(shiftN);
    return rows.map((row, i) => {
      if (i === 1) {
        let r = label(who, o.tint) + shift + row.slice(INDENT - 2);
        if (o.stamp !== undefined) r += ` ${c.dim}${fmtStamp(o.stamp)}${c.reset}`;
        return r;
      }
      return shift + row;
    });
  }

  // Right: the bubble's right edge sits at MEASURE − label; the label hangs
  // off its right side, the stamp sits in the left margin. A slide starts
  // further LEFT (shift) and settles rightward — nothing ever crosses the
  // measure, so an 80-col terminal never wraps a moving bubble.
  const rows = panel(lines, { indent: 0, padX: 1, width, border: fg(o.tint) });
  const bubbleW = visibleLength(rows[0]);
  const rest = MEASURE - bubbleW - 1 - GUTTER;
  const pad = Math.max(0, rest - shiftN);
  return rows.map((row, i) => {
    if (i === 1) {
      const stamp = o.stamp !== undefined ? `${c.dim}${fmtStamp(o.stamp)}${c.reset}` : "";
      const stampW = visibleLength(stamp);
      const lead =
        stamp && pad >= stampW + 1 ? " ".repeat(pad - stampW - 1) + stamp + " " : " ".repeat(pad);
      return `${lead}${row} ${fg(o.tint)}${who.padEnd(GUTTER)}${c.reset}`;
    }
    return " ".repeat(pad) + row;
  });
}

/** Inline tool-call chip under the agent: `⚙ act  click "Reviews"`. */
function chip(step: ScriptStep, glow = 0): string {
  const verb = mixRgb(PALETTE.brand, PALETTE.mint, glow);
  const body = mixRgb(PALETTE.teal, PALETTE.mint, glow);
  return `${" ".repeat(INDENT)}${fg(body)}⚙${c.reset} ${fg(verb)}${step.kind.padEnd(7)}${c.reset}${fg(body)}${step.text}${c.reset}`;
}

// ─── Motion ─────────────────────────────────────────────────────────────

/** Reading time for a bubble's text, so the pause after it scales with length. */
function readMs(text: string): number {
  const words = stripAnsi(text)
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
  return Math.min(1400, Math.max(300, words * READING_MS_PER_WORD * 0.5));
}

/**
 * Speak: (optionally) bob a typing indicator in the gutter, then slide the
 * bubble in from the right while its border warms from slate to the speaker
 * color. Off-TTY paints the resting bubble once.
 */
async function speak(
  who: Speaker,
  text: string,
  signal: SkipSignal,
  o: {
    stamp?: number;
    style?: string;
    typing?: boolean;
    clockFrom?: number;
    firstLine?: string;
  } = {},
): Promise<void> {
  const block = new LiveBlock();
  const tint = SPEAKER_COLOR[who];
  const live = canAnimateInPlace() && !signal.cancelled;

  if (o.typing && live) {
    // Three dots bobbing with phase offsets; the clock keeps running.
    const from = o.clockFrom ?? o.stamp ?? 0;
    const to = o.stamp ?? from;
    await animate({
      durationMs: TYPING_MS,
      signal,
      block,
      draw: (t) => {
        const dots = [0, 1, 2]
          .map((i) => {
            const k = (Math.sin(t * Math.PI * 3 + i * 1.1) + 1) / 2;
            const g = k < 0.33 ? "·" : k < 0.66 ? "•" : "●";
            return `${fg(mixRgb(PALETTE.deep, tint, 0.35 + 0.65 * k))}${g}${c.reset}`;
          })
          .join(" ");
        const stamp =
          o.stamp !== undefined ? `   ${c.dim}${fmtStamp(from + (to - from) * t)}${c.reset}` : "";
        return [`${label(who, mixRgb(PALETTE.slate, tint, 0.6))}  ${dots}${stamp}`];
      },
    });
  }

  const resting = bubble(who, text, {
    tint,
    stamp: o.stamp,
    style: o.style,
    firstLine: o.firstLine,
  });
  if (live) {
    await animate({
      durationMs: SLIDE_MS,
      signal,
      block,
      draw: (t) => {
        const p = ease.outCubic(t);
        return bubble(who, text, {
          tint: mixRgb(PALETTE.slate, tint, p),
          shift: SLIDE_FROM[who] * (1 - p),
          style: o.style,
          firstLine: o.firstLine,
        });
      },
    });
  }
  block.paint(resting, { final: true });
  process.stdout.write("\n");
  if (!signal.cancelled) await sleep(readMs(text) + SPEAKER_PAUSE_MS, signal);
}

/** A tool chip that flashes teal → mint on arrival, then settles. */
async function toolChip(step: ScriptStep, signal: SkipSignal): Promise<void> {
  const block = new LiveBlock();
  await animate({
    durationMs: 320,
    signal,
    block,
    draw: (t) => [chip(step, Math.sin(Math.min(1, t) * Math.PI))],
  });
  block.paint([chip(step)], { final: true });
  await sleep(step.kind === "extract" ? 420 : 220, signal);
}

/** The judge's stamp: lands with an overshoot, border glows, then settles. */
async function stamp(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  const pass = cs.verdict === "pass";
  const tint = pass ? PALETTE.brand : PALETTE.rose;
  const head = pass ? "✓ PASS" : "✗ FAIL";
  const first = (glow: number): string =>
    `${c.bold}${fg(mixRgb(tint, PALETTE.white, glow))}${head}${c.reset} — ${wrap(cs.reason, MAX_INNER - head.length - 3)[0] ?? ""}`;
  // wrap() the whole line so the remainder flows onto following rows
  const text = `${head} — ${cs.reason}`;
  const block = new LiveBlock();
  const live = canAnimateInPlace() && !signal.cancelled;
  if (live) {
    await animate({
      durationMs: 420,
      signal,
      block,
      draw: (t) => {
        const p = ease.outBack(t);
        return bubble("judge", text, {
          tint: mixRgb(PALETTE.slate, tint, Math.min(1, p)),
          shift: Math.max(0, SLIDE_FROM.judge * (1 - p)),
          firstLine: first(0),
        });
      },
    });
    await animate({
      durationMs: 1000,
      signal,
      block,
      draw: (t) => {
        const glow = Math.max(0, Math.sin(t * Math.PI * 2)) * 0.7 * (1 - t);
        return bubble("judge", text, {
          tint: mixRgb(tint, PALETTE.white, glow),
          firstLine: first(glow),
        });
      },
    });
  }
  block.paint(bubble("judge", text, { tint, firstLine: first(0) }), { final: true });
  process.stdout.write("\n");
  await sleep(SPEAKER_PAUSE_MS, signal);
}

// ─── Transcript ─────────────────────────────────────────────────────────

/** First-person narration for a step (the scripted case has no `think` rows of its own). */
function narrate(step: ScriptStep): string | null {
  switch (step.kind) {
    case "goto":
      return `I'll start on ${step.text}.`;
    case "act":
      return `Next I'll ${step.text}.`;
    case "extract":
      return "Let me read what's on the page.";
    case "answer":
      return `My answer: ${step.text}`;
    default:
      return null;
  }
}

async function transcript(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  let clock = 0;
  await speak(
    "agent",
    "Hi. I'm the agent evals will be testing. Here's a real WebVoyager task:",
    signal,
    {
      typing: true,
    },
  );
  if (signal.cancelled) return;
  await speak("agent", cs.task, signal, { style: c.dim });

  const steps = cs.steps;
  for (let i = 0; i < steps.length && !signal.cancelled; i++) {
    const step = steps[i];
    const before = clock;
    clock += step.ms;
    if (step.kind === "observe") continue; // consumed by the preceding act/goto
    if (step.kind === "answer") {
      await speak("agent", narrate(step) ?? step.text, signal, {
        stamp: clock,
        typing: true,
        clockFrom: before,
      });
      continue;
    }
    const line = narrate(step);
    if (line && step.kind !== "extract") {
      await speak("agent", line, signal, { stamp: clock, typing: true, clockFrom: before });
    }
    await toolChip(step, signal);
    // The browser answers with what it sees: the next observe, or the URL.
    const next = steps[i + 1];
    let seen: string | null = null;
    if (next?.kind === "observe") {
      clock += next.ms;
      seen = next.url ? `${next.text}\n${next.url}` : next.text;
    } else if (step.url) {
      seen = step.url;
    } else if (step.kind === "extract") {
      seen = step.text;
    }
    process.stdout.write("\n");
    if (seen) await speak("browser", seen, signal, { stamp: clock });
  }
}

async function verdict(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  await stamp(cs, signal);
  await speak(
    "agent",
    "Fair. That's exactly what evals is for — I only improve if someone measures.",
    signal,
    { typing: true },
  );
  process.stdout.write(
    `${" ".repeat(INDENT)}${c.dim}replay of a real benchmark task · timings illustrative${c.reset}\n\n`,
  );
}

// ─── Flow ───────────────────────────────────────────────────────────────

type Choice = "run" | "unlock" | "later";

export async function runDialogue(ctx: WelcomeRunContext): Promise<WizardOutcome> {
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
  const cs = loadScriptedCases()[2]; // Coursera — the FAIL
  const machine = detectMachine();

  const opening = await runIntro();
  if (opening.aborted) return cancelled();
  const intro = listenForSkip();
  try {
    await transcript(cs, intro.signal);
    if (intro.signal.aborted) return cancelled();
    if (intro.signal.cancelled) process.stdout.write("\n");
    // Esc lands here: the judge still speaks, at full speed.
    await verdict(cs, intro.signal);
    if (intro.signal.aborted) return cancelled();
    // The question — painted statically (clack takes over right after).
    process.stdout.write(
      bubble("agent", "Want me to try one for real on your machine?", {
        tint: SPEAKER_COLOR.agent,
      }).join("\n") + "\n\n",
    );
  } finally {
    intro.release();
  }

  // ── the reply (clack owns stdin here)
  const real = machine.plan.kind === "real";
  let choice: Choice;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    setCursorHidden(false);
    const picked = await clack.select({
      message: "Your reply",
      options: real
        ? [
            {
              value: "run",
              label: "Yes — run 3 real WebVoyager cases",
              hint: machine.recommend.line,
            },
            { value: "later", label: "Not now" },
          ]
        : [
            { value: "unlock", label: "Show me what unlocks it" },
            { value: "later", label: "Not now" },
          ],
      initialValue: real ? "run" : "unlock",
    });
    if (clack.isCancel(picked)) return cancelled();
    choice = picked as Choice;
    setCursorHidden(true);
  } else {
    choice = real ? "later" : "unlock";
  }

  const echo =
    choice === "run"
      ? "Yes — run 3 real cases."
      : choice === "unlock"
        ? "Show me what unlocks it."
        : "Not now.";

  let runNext: string | null = null;
  let reply: string;
  if (choice === "run") {
    reply = "On it.";
    runNext = machine.recommend.command;
  } else if (choice === "unlock") {
    reply = machine.recommend.line;
    runNext = "list bench";
  } else {
    reply = "I'll be here. `evals welcome e` brings me back.";
  }

  const tail = listenForSkip();
  try {
    process.stdout.write("\n");
    await speak("you", echo, tail.signal);
    await speak("agent", reply, tail.signal, { typing: true });
    if (tail.signal.aborted) return cancelled();
    if (runNext) {
      runNext = await handoffChip(runNext, tail.signal, { title: "Your move", eyebrow: "next" });
    }
  } finally {
    tail.release();
  }

  markFirstRunComplete(ctx.entryDir);
  process.stdout.write("\n");
  return { status: "completed", runNext };
}
