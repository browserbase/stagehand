// oxlint-disable no-console -- a CLI reports to the terminal; this is its output.
/**
 * The jev-ultrafast Google Flights demo, on Stagehand.
 * https://github.com/browser-use/jev-ultrafast/blob/main/examples/flights.py
 *
 * Like the reference, the only input is a goal: no step list, no selectors, no
 * knowledge of Google Flights anywhere in the code. Jev reads the page each
 * turn and decides what to do; Stagehand lists the page and performs the
 * action. See agent.ts for the loop and README.md for how to read the output.
 *
 *   pnpm --filter @browserbasehq/stagehand-integrations-example-jev google-flight
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { localBrowser, Stagehand, type ModelName } from "@browserbasehq/stagehand";
import { type AgentResult, runAgent, warmUp } from "./agent.ts";
import { loadEnv, optionalKey, requireKey, requireOneOf } from "./env.ts";
import { renderTurns, totals } from "./report.ts";

// Before anything reads process.env: see .env.example for what it looks for.
loadEnv();

const START_URL = "https://www.google.com/travel/flights?hl=en";
const GOAL =
  "Find one-way flights from Zurich to London on September 28, 2026, for one adult in economy. " +
  "Stop when matching flight options are visible. Do not select or book a flight.";
/** The goal forbids booking; keep the agent off those controls whatever it thinks. */
const BOOKING = "select flight|book|checkout|payment|sign in|log in";
/**
 * Consent banners interrupt any goal, and an agent left to itself takes the
 * biggest button. Putting blanket acceptance out of reach leaves "Reject all"
 * as the option it can still click, so an unattended run does not opt the user
 * into tracking on their behalf.
 */
const BLANKET_CONSENT = "accept all|accept cookies|agree to all|i agree";
const avoidPattern = (parts: string[]) => new RegExp(`\\b(${parts.join("|")})\\b`, "i");

const USAGE = `
google-flight — a goal-driven browser agent running on Jev decisions

  --goal <text>      what to achieve      (default: the reference demo's goal)
  --url <url>        where to start       (default: ${START_URL})
  --max-turns <n>    give up after n turns                    (default: 20)
  --confidence <n>   minimum Jev confidence to act, 0..1      (default: 0.35)
  --done-above <n>   "goal reached" score that stops the loop (default: 0.7)
  --poll <ms>        wait between page reads while it is still changing (default: 40)
  --allow-booking    do not hold the agent back from booking controls
  --accept-cookies   allow "Accept all" on consent banners (default: reject)
  --model <id>       LLM for act/observe/extract fallbacks     (default: openai/gpt-5.4-mini)
  --headless         run Chrome headless                       (default: headed)
  --fresh-profile    ignore any saved cookies and start clean
  --no-extract       skip the extract() readout at the end
  --verbose          keep Stagehand's info logs on stderr
  --json             print the run as JSON instead of a table

Reads TYPESAFE_API_KEY and OPENAI_API_KEY (or MODEL_API_KEY) from the
environment, this package's .env, or the repo root .env — see .env.example.
`.trim();

// `pnpm run <script> -- --flag` forwards the `--` verbatim on some versions;
// drop it, then report a genuinely bad flag as usage rather than a stack trace.
function parse() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  try {
    return parseArgs({ ...OPTIONS, args });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exit(2);
  }
}

const OPTIONS = {
  options: {
    goal: { type: "string", default: GOAL },
    url: { type: "string", default: START_URL },
    "max-turns": { type: "string", default: "20" },
    confidence: { type: "string", default: "0.35" },
    "done-above": { type: "string", default: "0.7" },
    poll: { type: "string", default: "40" },
    "allow-booking": { type: "boolean", default: false },
    "accept-cookies": { type: "boolean", default: false },
    model: { type: "string", default: "openai/gpt-5.4-mini" },
    headless: { type: "boolean", default: false },
    "fresh-profile": { type: "boolean", default: false },
    "no-extract": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
} as const;

const { values } = parse();

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function number(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got "${raw}"`);
  return parsed;
}

const jevConfig = {
  apiKey: requireKey("TYPESAFE_API_KEY", "Jev decides every turn of this demo"),
  ...(optionalKey("TYPESAFE_API_URL") ? { apiUrl: optionalKey("TYPESAFE_API_URL")! } : {}),
  ...(optionalKey("TYPESAFE_MODEL") ? { model: optionalKey("TYPESAFE_MODEL")! } : {}),
};

const modelApiKey = requireOneOf(
  ["MODEL_API_KEY", "OPENAI_API_KEY"],
  "extract() and the LLM fallback paths need it",
);

// Read from the environment when Stagehand builds its init params, so observe()
// answers from Jev instead of the LLM and extract() copies values Jev picks.
process.env.STAGEHAND_EXPERIMENTAL_JEV_ACT = JSON.stringify({
  ...jevConfig,
  observe: true,
  extract: "pick",
});

/**
 * Stagehand mirrors every forwarded log to stderr. Drop the info/debug chatter
 * so the turn table stays readable; warnings and errors still go through.
 */
function quietInfoLogs(): void {
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" && /^\[stagehand] (INFO|DEBUG) /.test(chunk)) {
      const done = rest.find((argument) => typeof argument === "function");
      (done as (() => void) | undefined)?.();
      return true;
    }
    return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
}

if (!values.verbose) quietInfoLogs();

const flightSchema = z.object({
  flights: z
    .array(
      z.object({
        airline: z.string(),
        departureTime: z.string(),
        arrivalTime: z.string(),
        duration: z.string(),
        stops: z.string(),
        price: z.string(),
      }),
    )
    .describe("The flight results the page is showing, in the order they are listed"),
});

const avoided = [
  ...(values["allow-booking"] ? [] : [BOOKING]),
  ...(values["accept-cookies"] ? [] : [BLANKET_CONSENT]),
];

/*
 * Cookies kept between runs are not a shortcut, they are what a browser is: a
 * consent banner, once answered, stays answered. Chrome will not flush its own
 * jar when the session is torn down this fast, so the jar is saved by hand —
 * otherwise every run spends its first two turns on a dialog no returning user
 * would ever see. --fresh-profile puts it back for a cold-start measurement.
 */
const jar = path.join(os.tmpdir(), "stagehand-jev-google-flight-cookies.json");

function savedCookies(): unknown[] {
  if (values["fresh-profile"]) return [];
  try {
    return JSON.parse(fs.readFileSync(jar, "utf-8")) as unknown[];
  } catch {
    return [];
  }
}

// Both take a moment and neither needs the other.
const [browser] = await Promise.all([
  localBrowser.launch({ headless: values.headless }),
  warmUp(jevConfig),
]);
let run: AgentResult | undefined;
let flights: z.infer<typeof flightSchema>["flights"] = [];
let finalUrl = values.url;
let agentMs = 0;
const startedAt = performance.now();

try {
  const stagehand = await Stagehand.create({
    browser,
    // Validated by Stagehand itself; --model takes any name the SDK supports.
    model: { modelName: values.model as ModelName, apiKey: modelApiKey },
    logging: { level: "info" },
  });

  try {
    const [page] = await browser.context.pages();
    if (!page) throw new Error("The launched browser has no page");
    // E.U cookie banner handling
    const restored = savedCookies();
    if (restored.length > 0) await browser.context.addCookies(restored as never);
    await page.goto(values.url);

    const agentStart = performance.now();
    run = await runAgent(stagehand, page, {
      goal: values.goal,
      startUrl: values.url,
      jev: jevConfig,
      confidence: number("confidence", values.confidence),
      doneAbove: number("done-above", values["done-above"]),
      maxTurns: number("max-turns", values["max-turns"]),
      pollMs: number("poll", values.poll),
      ...(avoided.length > 0 ? { avoid: avoidPattern(avoided) } : {}),
    });

    agentMs = Math.round(performance.now() - agentStart);
    finalUrl = await page.url();
    try {
      fs.writeFileSync(jar, JSON.stringify(await browser.context.cookies()));
    } catch {
      // A jar that cannot be written just means the next run answers the
      // banner again; nothing about this run depends on it.
    }

    // The reference verifies the page it ended on rather than trusting the
    // model's own "done"; reading the results back is that check here.
    if (run.status === "done" && !values["no-extract"]) {
      const extracted = await stagehand.extract(
        "Extract every flight result shown: airline, departure time, arrival time, total duration, number of stops, and price",
        flightSchema,
      );
      flights = extracted.data.flights;
    }
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}

const wallMs = Math.round(performance.now() - startedAt);
const summary = {
  goal: values.goal,
  status: run.status,
  agentMs,
  url: finalUrl,
  wallMs,
  ...totals(run.turns),
};

if (values.json) {
  console.log(JSON.stringify({ ...summary, turns: run.turns, flights }, null, 2));
} else {
  console.log(`\n${renderTurns(run.turns)}`);
  if (flights.length > 0) console.table(flights);
  console.log(
    `\n${summary.status} in ${summary.turns} turns, ${agentMs}ms (${wallMs}ms including browser startup` +
      `${values["no-extract"] ? "" : " and the extract readout"}) ` +
      `(observe ${summary.observeMs}ms, decide ${summary.decideMs}ms, act ${summary.actMs}ms)\n` +
      `${summary.jevRequests} Jev requests, ${summary.jevMs}ms of Jev, ${summary.jevTokens} tokens, 0 LLM calls`,
  );
  console.log(finalUrl);
}

if (run.status !== "done") {
  console.error(`\ngoogle-flight: agent stopped with status "${run.status}"`);
  process.exitCode = 1;
}
