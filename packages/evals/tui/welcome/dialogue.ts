import { c, stripAnsi, visibleLength } from "../format.js";
import { animate, ease, fg, mixRgb, PALETTE } from "../fx.js";
import {
  canAnimateInPlace,
  LiveBlock,
  panel,
  READING_MS_PER_WORD,
  ruleHeader,
  sleep,
  wizardWidth,
  type RGB,
  type SkipSignal,
} from "../wizardAnim.js";
import { type ScriptStep, type ScriptedCase } from "./agentScript.js";

const GUTTER = 8;
const INDENT = GUTTER + 2;
const MAX_INNER = 50;
const SPEAKER_PAUSE_MS = 320;
const SLIDE_MS = 240;
const TYPING_MS = 600;

type Speaker = "agent" | "browser" | "judge" | "you";

const SPEAKER_COLOR: Record<Speaker, RGB> = {
  agent: PALETTE.brand,
  browser: PALETTE.cyan,
  judge: PALETTE.amber,
  you: PALETTE.white,
};

const SLIDE_FROM: Record<Speaker, number> = { agent: 6, browser: 8, judge: 10, you: 8 };

const RIGHT_ALIGNED: Record<Speaker, boolean> = {
  agent: false,
  browser: true,
  judge: true,
  you: true,
};
const edge = (): number => wizardWidth();
const RIGHT_LABEL_W = Math.max(...(["browser", "judge", "you"] as const).map((w) => w.length));
const STAMP_W = 6;

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

let lastSpeaker: Speaker | null = null;

type BubbleOpts = {
  tint: RGB;
  showLabel?: boolean;
  shift?: number;
  stamp?: number;
  style?: string;
  firstLine?: string;
};

function bubble(who: Speaker, text: string, o: BubbleOpts): string[] {
  const style = o.style ?? "";
  const lines = wrap(text, MAX_INNER).map((l) => `${style}${l}${style ? c.reset : ""}`);
  if (o.firstLine) lines[0] = o.firstLine;
  const width = Math.max(...lines.map((l) => visibleLength(l)));
  const shiftN = Math.max(0, Math.round(o.shift ?? 0));

  if (!RIGHT_ALIGNED[who]) {
    const rows = panel(lines, { indent: INDENT, padX: 1, width, border: fg(o.tint) });
    const shift = " ".repeat(shiftN);
    return rows.map((row, i) => {
      if (i === 1) {
        const lab = o.showLabel === false ? " ".repeat(GUTTER) : label(who, o.tint);
        let r = lab + shift + row.slice(INDENT - 2);
        if (o.stamp !== undefined) r += ` ${c.dim}${fmtStamp(o.stamp)}${c.reset}`;
        return r;
      }
      return shift + row;
    });
  }

  const rows = panel(lines, { indent: 0, padX: 1, width, border: fg(o.tint) });
  const bubbleW = visibleLength(rows[0]);
  const rest = edge() - bubbleW - 1 - RIGHT_LABEL_W;
  const pad = Math.max(0, rest - shiftN);
  return rows.map((row, i) => {
    if (i === 1) {
      const stamp = o.stamp !== undefined ? `${c.dim}${fmtStamp(o.stamp)}${c.reset}` : "";
      const stampW = visibleLength(stamp);
      const lead =
        stamp && pad >= stampW + 1 ? " ".repeat(pad - stampW - 1) + stamp + " " : " ".repeat(pad);
      const lab =
        o.showLabel === false
          ? " ".repeat(RIGHT_LABEL_W)
          : `${fg(o.tint)}${who.padEnd(RIGHT_LABEL_W)}${c.reset}`;
      return `${lead}${row} ${lab}`;
    }
    return " ".repeat(pad) + row;
  });
}

const CHIP_VERB_COLOR: Record<string, RGB> = {
  goto: PALETTE.slate,
  act: PALETTE.brand,
  extract: PALETTE.mint,
};
const VERB_W = 9;
function chip(step: ScriptStep, clockMs: number, glow = 0): string[] {
  const verbBase = CHIP_VERB_COLOR[step.kind] ?? PALETTE.teal;
  const verb = mixRgb(verbBase, PALETTE.mint, glow);
  const body = mixRgb(PALETTE.teal, PALETTE.mint, glow);
  const text = step.kind === "extract" ? "reading the page" : step.text;
  const textCol = INDENT + 2 + VERB_W;
  const lines = wrap(text, edge() - textCol - 2 - STAMP_W);
  const head = `${" ".repeat(INDENT)}${fg(body)}⚙${c.reset} ${fg(verb)}${step.kind.padEnd(VERB_W)}${c.reset}${fg(body)}${lines[0]}${c.reset}`;
  const pad = " ".repeat(Math.max(2, edge() - visibleLength(head) - STAMP_W));
  return [
    `${head}${pad}${c.dim}${fmtStamp(clockMs)}${c.reset}`,
    ...lines.slice(1).map((l) => `${" ".repeat(textCol)}${fg(body)}${l}${c.reset}`),
  ];
}

function readMs(text: string): number {
  const words = stripAnsi(text)
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
  return Math.min(1400, Math.max(300, words * READING_MS_PER_WORD * 0.5));
}

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
  const showLabel = lastSpeaker !== who;
  lastSpeaker = who;

  if (o.typing && live) {
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
        const lab = showLabel ? label(who, mixRgb(PALETTE.slate, tint, 0.6)) : " ".repeat(GUTTER);
        return [`${lab}  ${dots}${stamp}`];
      },
    });
  }

  const resting = bubble(who, text, {
    tint,
    stamp: o.stamp,
    style: o.style,
    firstLine: o.firstLine,
    showLabel,
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
          showLabel,
        });
      },
    });
  }
  block.paint(resting, { final: true });
  process.stdout.write("\n");
  if (!signal.cancelled) await sleep(readMs(text) + SPEAKER_PAUSE_MS, signal);
}

async function toolChip(step: ScriptStep, clockMs: number, signal: SkipSignal): Promise<void> {
  const block = new LiveBlock();
  await animate({
    durationMs: 320,
    signal,
    block,
    draw: (t) => chip(step, clockMs, Math.sin(Math.min(1, t) * Math.PI)),
  });
  block.paint(chip(step, clockMs), { final: true });
  lastSpeaker = null;
  await sleep(step.kind === "extract" ? 420 : 200, signal);
}

async function stamp(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  const pass = cs.verdict === "pass";
  const tint = PALETTE.amber;
  const verdictColor = pass ? PALETTE.brand : PALETTE.rose;
  const head = pass ? "✓ PASS" : "✗ FAIL";
  const first = (glow: number): string =>
    `${c.bold}${fg(mixRgb(verdictColor, PALETTE.white, glow))}${head}${c.reset}  ${wrap(cs.reason, MAX_INNER - head.length - 2)[0] ?? ""}`;
  const text = `${head}  ${cs.reason}`;
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
          showLabel: true,
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
  block.paint(bubble("judge", text, { tint, firstLine: first(0), showLabel: true }), {
    final: true,
  });
  lastSpeaker = "judge";
  process.stdout.write("\n");
  await sleep(SPEAKER_PAUSE_MS, signal);
}

async function transcript(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  lastSpeaker = null;
  await speak("agent", "Here's how I got there.", signal, { typing: true });
  if (signal.cancelled) return;

  const steps = cs.steps;
  let clock = 0;
  let chipsOpen = false;
  const closeChips = (): void => {
    if (chipsOpen) {
      process.stdout.write("\n");
      chipsOpen = false;
    }
  };

  for (let i = 0; i < steps.length && !signal.cancelled; i++) {
    const step = steps[i];
    clock += step.ms;
    switch (step.kind) {
      case "think": {
        closeChips();
        const line = /[.!?]$/.test(step.text) ? step.text : `${step.text}.`;
        await speak("agent", line, signal, { typing: true });
        break;
      }
      case "goto":
      case "act":
      case "extract": {
        await toolChip(step, clock, signal);
        chipsOpen = true;
        const next = steps[i + 1];
        let seen: string | null = null;
        if (next?.kind === "observe") {
          i++;
          clock += next.ms;
          seen = next.url ? `${next.text}\n${next.url}` : next.text;
        } else if (step.kind === "goto" && step.url) {
          seen = step.url;
        } else if (step.kind === "extract") {
          seen = step.text;
        }
        if (seen) {
          closeChips();
          await speak("browser", seen, signal);
        }
        break;
      }
      case "answer": {
        closeChips();
        await speak("agent", step.text, signal, { typing: true, style: c.bold });
        break;
      }
      default:
        break;
    }
  }
  closeChips();
}

async function verdict(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  await stamp(cs, signal);
  if (signal.aborted) return;
  const line =
    cs.verdict === "pass"
      ? "Same task, same judge, every run — that's how the board gets its numbers."
      : "That's what evals catches. Same task, same judge, every run.";
  await speak("agent", line, signal, { typing: true });
  if (signal.aborted) return;
  process.stdout.write(
    `${" ".repeat(INDENT)}${c.dim}replay of a real benchmark task · timings illustrative${c.reset}\n\n`,
  );
}

export async function runInside(cs: ScriptedCase, signal: SkipSignal): Promise<void> {
  process.stdout.write("\n");
  ruleHeader("How the winner got there", { eyebrow: "inside the run" });
  await transcript(cs, signal);
  if (signal.aborted) return;
  if (signal.cancelled) process.stdout.write("\n");
  await verdict(cs, signal);
}
