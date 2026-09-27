import { Command } from "commander";
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { loadManifest, checkEnv, applyPreset } from "./config.js";
import { runAttempt } from "./runner.js";
import { pool } from "./pool.js";
import { buildScorecard, OUTCOME_LABELS } from "./scorecard.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderHtml } from "./report/html.js";
import type { AttemptResult, Manifest, Scorecard } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Best-effort .env loader (no dotenv dep — keep the template lean).
function loadDotenv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotenv();

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const banner = () =>
  console.log(pc.bold(pc.red("\n  bbpoc")) + pc.dim("  — Browserbase verified-trial harness\n"));

/** Build the flat task list (site × attempts) and run it through the pool. */
async function executeTrial(manifest: Manifest, opts: { live: boolean }): Promise<Scorecard> {
  const startedAt = ts();
  const jobs: { siteIndex: number; attempt: number }[] = [];
  manifest.sites.forEach((s, i) => {
    const n = s.attempts ?? manifest.defaults.attempts;
    for (let a = 1; a <= n; a++) jobs.push({ siteIndex: i, attempt: a });
  });

  console.log(
    pc.dim(
      `  ${manifest.sites.length} sites × attempts = ${jobs.length} sessions · ` +
        `concurrency ${manifest.defaults.concurrency} · region ${manifest.defaults.region}`,
    ),
  );
  console.log(
    pc.dim(
      `  stealth ${manifest.defaults.features.advancedStealth ? "ON" : "OFF"} · ` +
        `proxies ${manifest.defaults.features.proxies ? "ON" : "OFF"}` +
        `${manifest.defaults.features.proxyCountry ? ` (${manifest.defaults.features.proxyCountry})` : ""} · ` +
        `captcha ${manifest.defaults.features.solveCaptchas ? "ON" : "OFF"}\n`,
    ),
  );

  let done = 0;
  const results = await pool<(typeof jobs)[number], AttemptResult>(
    jobs,
    manifest.defaults.concurrency,
    (job) => runAttempt(manifest.sites[job.siteIndex], manifest.defaults, job.attempt),
    (r) => {
      done++;
      const icon = r.success ? pc.green("✓") : pc.red("✗");
      const tag = r.success
        ? pc.green(OUTCOME_LABELS[r.outcome])
        : pc.yellow(OUTCOME_LABELS[r.outcome]);
      console.log(
        `  ${icon} [${String(done).padStart(2)}/${jobs.length}] ${pc.bold(r.site)} #${r.attempt} — ${tag}` +
          (r.detected ? pc.dim(` · ${r.detected}`) : "") +
          pc.dim(` · ${(r.durationMs / 1000).toFixed(1)}s`),
      );
    },
  );

  return buildScorecard(manifest, results, startedAt, ts());
}

function writeReports(s: Scorecard, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const md = join(outDir, "scorecard.md");
  const html = join(outDir, "scorecard.html");
  const jsonPath = join(outDir, "results.json");
  writeFileSync(md, renderMarkdown(s));
  writeFileSync(html, renderHtml(s));
  writeFileSync(jsonPath, JSON.stringify(s, null, 2));
  console.log("\n" + pc.bold("  Reports written:"));
  console.log("   " + pc.cyan(md) + pc.dim("   (acceptance matrix)"));
  console.log("   " + pc.cyan(html) + pc.dim("  (leadership-ready, open in a browser)"));
  console.log("   " + pc.cyan(jsonPath) + pc.dim("  (raw)"));
}

function printSummary(s: Scorecard) {
  console.log("\n" + pc.bold("  ── Scorecard ──"));
  for (const site of s.sites) {
    const ok = site.met ? pc.green("MET ") : pc.red("MISS");
    const rate = `${Math.round(site.successRate * 100)}%`.padStart(4);
    console.log(
      `  ${ok}  ${rate}  ${pc.bold(site.name)} ${pc.dim(`(target ${Math.round(site.target * 100)}%)`)}`,
    );
  }
  const all = s.sitesMet === s.siteCount;
  console.log(
    "\n  " +
      (all
        ? pc.green(pc.bold(`✓ ${s.sitesMet}/${s.siteCount} sites met target`))
        : pc.yellow(pc.bold(`${s.sitesMet}/${s.siteCount} sites met target`))) +
      pc.dim(`  ·  ${Math.round(s.overallRate * 100)}% overall`),
  );
}

const program = new Command();
program
  .name("bbpoc")
  .description(
    "Turn a Browserbase verified/advanced-stealth trial into a one-day self-serve smoke test.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold trial.yaml + .env in the current directory")
  .action(() => {
    banner();
    const targets: [string, string][] = [
      [join(ROOT, "examples", "trial.example.yaml"), "trial.yaml"],
      [join(ROOT, ".env.example"), ".env"],
    ];
    for (const [src, dest] of targets) {
      const out = resolve(process.cwd(), dest);
      if (existsSync(out)) {
        console.log(pc.yellow(`  • ${dest} already exists — skipped`));
        continue;
      }
      copyFileSync(src, out);
      console.log(pc.green(`  ✓ created ${dest}`));
    }
    console.log(
      "\n  Next:\n" +
        pc.dim("   1. fill in .env with your Browserbase + model keys\n") +
        pc.dim("   2. edit trial.yaml — your URLs, tasks, targets\n") +
        pc.dim("   3. ") +
        pc.cyan("bbpoc smoke") +
        pc.dim("   (quick sanity, 1 attempt/site)\n") +
        pc.dim("   4. ") +
        pc.cyan("bbpoc run") +
        pc.dim("    (full trial)\n"),
    );
  });

function trialCommand(name: string, smoke: boolean) {
  program
    .command(name)
    .description(
      smoke ? "Quick sanity run — 1 attempt per site" : "Run the full trial per trial.yaml",
    )
    .option("-c, --config <path>", "path to manifest", "trial.yaml")
    .option("-o, --out <dir>", "output directory", "results")
    .option("--preset <name>", "feature preset: verified | baseline | stealth-only")
    .option("--concurrency <n>", "override concurrency", (v) => parseInt(v, 10))
    .option("--attempts <n>", "override attempts per site", (v) => parseInt(v, 10))
    .option("--no-stealth", "disable advanced stealth (control run)")
    .option("--no-proxies", "disable residential proxies")
    .action(async (opts) => {
      banner();
      let manifest = loadManifest(opts.config);
      manifest = applyPreset(manifest, opts.preset);
      if (smoke) manifest.defaults.attempts = 1;
      if (opts.attempts) manifest.defaults.attempts = opts.attempts;
      if (opts.concurrency) manifest.defaults.concurrency = opts.concurrency;
      if (opts.stealth === false) manifest.defaults.features.advancedStealth = false;
      if (opts.proxies === false) manifest.defaults.features.proxies = false;

      checkEnv(manifest.defaults.model);

      const s = await executeTrial(manifest, { live: true });
      printSummary(s);
      writeReports(s, resolve(process.cwd(), opts.out));
    });
}
trialCommand("run", false);
trialCommand("smoke", true);

program
  .command("report")
  .description("Regenerate markdown + HTML from a previous results.json")
  .option("-i, --in <path>", "results.json path", "results/results.json")
  .option("-o, --out <dir>", "output directory", "results")
  .action((opts) => {
    banner();
    const p = resolve(process.cwd(), opts.in);
    if (!existsSync(p)) {
      console.error(pc.red(`✖ ${opts.in} not found. Run a trial first.`));
      process.exit(1);
    }
    const s = JSON.parse(readFileSync(p, "utf8")) as Scorecard;
    writeReports(s, resolve(process.cwd(), opts.out));
  });

program.parseAsync(process.argv);
