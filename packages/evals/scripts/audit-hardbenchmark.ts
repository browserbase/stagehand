/**
 * HardBenchmark validity audit.
 *
 * Runs four checks over every row of HardBenchmark_data.jsonl and writes a
 * per-task record to datasets/hardbenchmark/audit-<date>.json:
 *
 *   1. reachability  — real Browserbase session (browserSettings.verified) via
 *                      the v4 SDK; navigates to the task's start URL AND the
 *                      deep page(s) the task actually needs (search / category
 *                      URLs, since bot-walls often let the homepage through and
 *                      block /search). A captcha/WAF result is retried once with
 *                      proxies enabled; only a block on BOTH attempts counts.
 *   2. rubric        — precomputed_rubric.items non-empty, each item has
 *                      criterion + description strings.
 *   3. achievability — optional; --trajectories <dir> points at a trajectory
 *                      store with agent_hardbenchmark__* run folders. Reports
 *                      whether any run ever passed each task. Model directories
 *                      are aliased (model-1, model-2, ...) so no model names
 *                      leak into the audit output.
 *   4. stop-before-purchase — heuristic flag (never invalidates): the wording
 *                      asks to buy/order/book while the rubric rewards stopping
 *                      at the checkout "critical point".
 *
 * With --apply the jsonl is rewritten in place: rows that fail check 1 or 2 get
 * `valid: false` + `invalid_reason`; rows matching check 4 get
 * `verdict_review: "stop-before-purchase"`. Rows are never deleted, and an
 * existing `valid: false` set by hand is preserved.
 *
 * Usage (from packages/evals):
 *   pnpm tsx scripts/audit-hardbenchmark.ts [--concurrency 4] [--only id1,id2]
 *       [--skip-reachability] [--trajectories <dir> [--trajectory-dirs a,b]]
 *       [--apply] [--out <file>]
 *
 * Needs BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID (read from
 * packages/evals/.env or the environment).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Stagehand, browserbase, type Page } from "@browserbasehq/stagehand";

const here = dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = join(here, "..", "datasets", "hardbenchmark");
const DATASET_PATH = join(DATASET_DIR, "HardBenchmark_data.jsonl");
const GOOGLE_FALLBACK = "https://www.google.com";

type RubricItem = { criterion?: unknown; description?: unknown; maxPoints?: unknown };
type Row = {
  id: string;
  ques: string;
  web?: string;
  category?: string;
  precomputed_rubric?: { items?: RubricItem[] } | null;
  valid?: boolean;
  invalid_reason?: string;
  verdict_review?: string;
  [k: string]: unknown;
};

/** "error" = the audit itself failed (no session / creds); never invalidates. */
type ProbeClass = "ok" | "captcha-or-WAF" | "login-wall" | "dead" | "error";

type ProbeResult = {
  url: string;
  attempt: 1 | 2;
  proxies: boolean;
  classification: ProbeClass;
  httpStatus: number | null;
  finalUrl: string;
  title: string;
  treeHead: string;
  error?: string;
  sessionId?: string;
};

type TaskAudit = {
  id: string;
  category?: string;
  startUrl: string;
  probeUrls: string[];
  reachability: {
    classification: ProbeClass | "skipped";
    blockedOnBothAttempts: string[];
    probes: ProbeResult[];
  };
  rubric: { ok: boolean; itemCount: number; problems: string[] };
  achievability?: {
    everPassed: boolean;
    runs: {
      model: string;
      run: string;
      outcomeSuccess: boolean | null;
      processScore: number | null;
      steps: number;
    }[];
  };
  stopBeforePurchase: boolean;
  valid: boolean;
  invalid_reason?: string;
};

// ---------------------------------------------------------------------------
// Deep probe URLs. Bot-walls on these sites (CVS, Overstock, Home Depot, ...)
// let the homepage through and block search/category pages, so probing only
// the start URL would report "ok" for a task the agent cannot actually do.
// Derived from the pages the audited trajectories actually needed.
// ---------------------------------------------------------------------------
const DEEP_PROBES: Record<string, string[]> = {
  "47e314cc452c540524ffb7cf520285a3": [
    "https://www.recreation.gov/search?q=paddling&inventory_type=permits",
  ],
  "7e1047f4803237f319c004f7a7f6bccb": [
    "https://www.bestbuy.com/trade-in/r/choose?searchQuery=HP%20laptop",
  ],
  "7e6993f2c5cd72c44809024f0bc85dc1": ["https://imgur.com/meme-generator"],
  "84f806c7fc15576673915f195efa72df": [
    "https://www.adoptapet.com/shelter-search?postalCode=10012&radius=3500&adoptsOut[0]=birds&page=1",
  ],
  "864244b6969e0f8733b0eb1ca06cd51f": ["https://www.espn.com/f1/"],
  "92160852a6bbbc165cee4e14ab0b1d59": [
    "https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/flat-rate-shipping",
  ],
  a0a18ca6a3529f3e97c771aadd42d3a0: [
    "https://www.macys.com/shop/mens-clothing/mens-t-shirts?id=30423",
  ],
  // /reviews/board-games (the route past runs used) has answered HTTP 500 since
  // 2026-08-31; the task is still reachable through /reviews and /editors-choice.
  aa4b5cb7114fcc138ade82b4b9716d24: [
    "https://www.ign.com/reviews",
    "https://www.ign.com/editors-choice",
  ],
  afcebfed28bea091d58f49ea6cb8194b: [
    "https://www.cvs.com/shop/vitamins/multivitamins",
    "https://www.cvs.com/search?searchTerm=multivitamin",
  ],
  airasia_88: ["https://www.airasia.com/en/gb"],
  amazon_7859: ["https://www.amazon.com/s?k=Storm+Fury+Book+1"],
  amazon_comparison_shopping_77: [
    "https://www.target.com/s?searchTerm=NECA+Dungeons+Dragons+Ultimate+Strongheart",
    "https://www.walmart.com/search?q=NECA+Dungeons+Dragons+Ultimate+Strongheart",
  ],
  apply_apply_2317: ["https://jobs.thermofisher.com/global/en/search-results"],
  apply_apply_2864: ["https://www.roberthalf.com/us/en/jobs/los-angeles-ca/accounting"],
  b2f4fde2fce122a93c7b578086cb0585: [
    "https://www.booking.com/",
    "https://www.expedia.com/Vacation-Packages",
  ],
  b3f8bd9198d9d157e0848109563c4b23: [
    "https://jobs.ohiomeansjobs.applygovt.com/Search.aspx?pg=1&sid=68&rad=20&rad_units=miles&q=Logistics",
  ],
  bestbuy_comparison_shopping_45: [
    "https://www.bestbuy.com/site/searchpage.jsp?st=xbox+series+x+console",
    "https://www.xbox.com/en-US/consoles/xbox-series-x",
  ],
  c1d6ea6f2196d25782cc3646ff3090db: ["https://www.target.com/s?searchTerm=drip+coffee+maker"],
  colgate_1: ["https://shop.colgate.com/"],
  dd44c665cec1e9c929a4c5f074e7844a: [
    "https://spothero.com/search?q=San%20Francisco%20Museum%20of%20Modern%20Art",
  ],
  "disneyworld.disney.go_plan_a_trip_2": ["https://disneyworld.disney.go.com/admission/tickets/"],
  eventbrite_tickets_book_51: ["https://discoverbaltimorecounty.com/events/"],
  eventbrite_tickets_book_76: [
    "https://www.eventbrite.com/d/fl--fort-lauderdale/african-american-research-library-and-cultural-center/",
  ],
  fiestafactorydirect_1: [
    "https://fiestafactorydirect.com/",
    "https://fiestafactorydirect.com/collections/all",
  ],
  heb_comparison_shopping_1: [
    "https://www.heb.com/search?q=cherry%20nighttime%20cold%20flu%20relief%20liquid",
    "https://www.amazon.com/s?k=nighttime+cold+and+flu+relief+liquid+cherry",
  ],
  homedepot_comparison_shopping_18: [
    "https://www.homedepot.com/s/3%20way%20coaxial%20cable%20splitter",
    "https://www.homedepot.com/b/Electronics-Cables-Cable-Accessories-Cable-Splitters-Signal-Amplifiers/3-Way/N-5yc1vZc657Z1z10pyo",
  ],
  // Barnes & Noble deliberately omitted: it answers "Not Found" to bots, but the
  // task only needs *some* retailers (Amazon, ThriftBooks worked in past runs).
  homedepot_comparison_shopping_20: [
    "https://www.amazon.com/s?k=a+tale+of+two+cities+dickens",
    "https://www.thriftbooks.com/browse/?b.search=a%20tale%20of%20two%20cities",
  ],
  housebeautiful_2: ["https://www.amazon.com/s?k=outdoor+smoker"],
  "indytoday.6amcity_8": ["https://yazshindy.com/"],
  metmuseum_find_24: [
    "https://www.metmuseum.org/tickets",
    "https://engage.metmuseum.org/admission/",
  ],
  michaels_2250: ["https://www.michaels.com/search?q=baby+fabric"],
  nothingbundtcakes_6: [
    "https://www.nothingbundtcakes.com/",
    "https://www.nothingbundtcakes.com/cakes/bundt-cakes/",
  ],
  oceanstatejoblot_4: ["https://www.oceanstatejoblot.com/search?q=rug"],
  overstock_8717: [
    "https://www.overstock.com/",
    "https://www.overstock.com/wall-hung-bathroom-sink,/k,/results.html",
  ],
  recwatches_1: ["https://www.recwatches.com/"],
  rockauto_1225: ["https://www.rockauto.com/"],
  rockauto_4460: ["https://www.rockauto.com/en/catalog/ford,2000,e-450,6.8l+v10,1375848"],
  simpletire_5: ["https://simpletire.com/"],
  tagwoodbbq_1: ["https://tagwoodbbq.com/"],
  tiqets_tickets_book_5: [
    "https://www.tiqets.com/en/search?q=Odeon+of+Herodes+Atticus",
    "https://aefestival.gr/?lang=en",
  ],
  tripadvisor_plan_a_trip_118: ["https://www.tripadvisor.com/", "https://laventanaweb.com/en"],
  tripadvisor_question_answering_185: [
    "https://www.tripadvisor.com/Search?q=Volcano%20Winery%20Hawaii",
  ],
  underarmour_7483: ["https://www.underarmour.com/en-us/c/mens/accessories/beanies-gloves/"],
  walgreens_10: ["https://www.walgreens.com/search/results.jsp?Ntt=heated+foot+spa"],
  walmart_comparison_shopping_375: [
    "https://www.walmart.com/search?q=kids+bumper+car",
    "https://www.amazon.com/s?k=kids+bumper+car",
  ],
  wayfair_comparison_shopping_3: [
    "https://www.wayfair.com/keyword.php?keyword=california+king+burgundy+bedspread",
    "https://www.amazon.com/s?k=california+king+burgundy+bedspread",
  ],
};

// ---------------------------------------------------------------------------
// Classification heuristics
// ---------------------------------------------------------------------------
const WAF_RE =
  /access denied|captcha|verify you are (a )?human|are you a robot|not a robot|pardon our interruption|request (was )?blocked|attention required|just a moment|press ?& ?hold|unusual traffic|bot detection|something went wrong|reference #\d|403 forbidden|security check|human verification|robot or human|blocked|verify to continue|too many requests|please enable (js|javascript) and cookies|checking your browser|cf-chl|hcaptcha|recaptcha|perimeterx|incapsula|datadome/i;
const DEAD_RE =
  /page not found|404|this site can.t be reached|server not found|not available|dns_probe|err_name_not_resolved|err_connection|502 bad gateway|503 service unavailable|domain (is )?for sale|this domain has expired/i;
const LOGIN_RE =
  /sign in to continue|log in to continue|please (sign|log) in|login required|you must (sign|log) in/i;

function classify(input: {
  httpStatus: number | null;
  title: string;
  treeHead: string;
  error?: string;
  treeLength: number;
}): ProbeClass {
  const { httpStatus, title, treeHead, error, treeLength } = input;
  const text = `${title}\n${treeHead}`;
  if (error) {
    if (/session:|CDP connection|socket-close|Browserbase|deadline/i.test(error)) return "error";
    if (/net::|ERR_|timeout|Timeout|navigat/i.test(error) && treeLength === 0) return "dead";
    // Snapshot failed but navigation may have landed on a challenge page
    if (WAF_RE.test(text)) return "captcha-or-WAF";
    return "dead";
  }
  // Real challenge pages are tiny; content pages are not. Look at the head only
  // so that a product page mentioning "blocked" drains does not trip the check.
  const head = text.slice(0, 1200);
  if (httpStatus !== null && (httpStatus === 403 || httpStatus === 429 || httpStatus === 503)) {
    // A 429/403 with a fully rendered page (e.g. metmuseum.org/tickets) is
    // rate-limit noise the agent never sees; only a thin or challenge page counts.
    if (treeLength < 6000 || WAF_RE.test(head)) return "captcha-or-WAF";
  }
  if (httpStatus !== null && (httpStatus === 404 || httpStatus === 410 || httpStatus >= 500))
    return "dead";
  if (WAF_RE.test(head) && treeLength < 6000) return "captcha-or-WAF";
  if (DEAD_RE.test(head) && treeLength < 4000) return "dead";
  if (LOGIN_RE.test(head) && treeLength < 4000) return "login-wall";
  if (treeLength < 80) return "dead";
  return "ok";
}

// ---------------------------------------------------------------------------
// Browserbase session helpers
// ---------------------------------------------------------------------------
type Session = { stagehand: Stagehand; page: Page; sessionId: string; close: () => Promise<void> };

async function openSession(opts: { proxies: boolean }): Promise<Session> {
  const apiKey = process.env.BROWSERBASE_API_KEY || process.env.BB_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID || process.env.BB_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required");
  }
  const browser = await browserbase.launch({
    apiKey,
    projectId,
    ...(process.env.BROWSERBASE_BASE_URL ? { baseUrl: process.env.BROWSERBASE_BASE_URL } : {}),
    ...(process.env.BROWSERBASE_REGION ? { region: process.env.BROWSERBASE_REGION } : {}),
    proxies: opts.proxies,
    timeout: 10 * 60,
    browserSettings: {
      // "verified" is the eval env's bot-wall posture (see initV3 in the eval
      // env); the audit must reproduce what the agent will actually see.
      verified: true,
      viewport: { width: 1288, height: 711 },
    },
    userMetadata: { stagehand: "true", evals: "true", audit: "hardbenchmark" },
  } as Parameters<typeof browserbase.launch>[0]);
  const stagehand = await Stagehand.create({ browser });
  const pages = await browser.context.pages();
  const page = pages[0] ?? (await browser.context.newPage());
  return {
    stagehand,
    page,
    sessionId: browser.sessionId ?? "",
    close: async () => {
      await stagehand.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function probe(
  session: Session,
  url: string,
  attempt: 1 | 2,
  proxies: boolean,
): Promise<ProbeResult> {
  const result: ProbeResult = {
    url,
    attempt,
    proxies,
    classification: "dead",
    httpStatus: null,
    finalUrl: "",
    title: "",
    treeHead: "",
    sessionId: session.sessionId,
  };
  let treeLength = 0;
  try {
    const response = await session.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    result.httpStatus = response ? response.status() : null;
    // Challenge pages (Akamai, Cloudflare, PerimeterX) render after DOM ready.
    await session.page.waitForTimeout(4_000);
    result.finalUrl = await session.page.url();
    result.title = await session.page.title();
    let snap = await session.page.snapshot();
    if (snap.formattedTree.length < 400) {
      // Proxied first loads and JS challenges can leave a bare <html> for a
      // while; give the page one more chance before calling it blank.
      await session.page.waitForTimeout(8_000);
      snap = await session.page.snapshot();
      result.title = await session.page.title();
      result.finalUrl = await session.page.url();
    }
    treeLength = snap.formattedTree.length;
    result.treeHead = snap.formattedTree.slice(0, 1500);
  } catch (error) {
    result.error =
      error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
  }
  result.classification = classify({
    httpStatus: result.httpStatus,
    title: result.title,
    treeHead: result.treeHead,
    error: result.error,
    treeLength,
  });
  return result;
}

async function probeTask(id: string, urls: string[]): Promise<TaskAudit["reachability"]> {
  const probes: ProbeResult[] = [];
  let session: Session | undefined;
  try {
    session = await openSession({ proxies: false });
    for (const url of urls) probes.push(await probe(session, url, 1, false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const url of urls.slice(probes.length)) {
      probes.push({
        url,
        attempt: 1,
        proxies: false,
        classification: "error",
        httpStatus: null,
        finalUrl: "",
        title: "",
        treeHead: "",
        error: `session: ${message.slice(0, 300)}`,
      });
    }
  } finally {
    await session?.close();
  }

  const retry = probes.filter((p) => p.classification === "captcha-or-WAF").map((p) => p.url);
  if (retry.length > 0) {
    let proxied: Session | undefined;
    try {
      proxied = await openSession({ proxies: true });
      for (const url of retry) probes.push(await probe(proxied, url, 2, true));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const url of retry.slice(probes.filter((p) => p.attempt === 2).length)) {
        probes.push({
          url,
          attempt: 2,
          proxies: true,
          classification: "error",
          httpStatus: null,
          finalUrl: "",
          title: "",
          treeHead: "",
          error: `session: ${message.slice(0, 300)}`,
        });
      }
    } finally {
      await proxied?.close();
    }
  }

  // Final per-URL verdict = attempt 2 if it ran, else attempt 1.
  const finalByUrl = new Map<string, ProbeResult>();
  for (const p of probes) {
    const prev = finalByUrl.get(p.url);
    if (!prev || p.attempt > prev.attempt) finalByUrl.set(p.url, p);
  }
  const finals = [...finalByUrl.values()];
  const blockedOnBothAttempts = finals
    .filter((p) => p.attempt === 2 && p.classification === "captcha-or-WAF")
    .map((p) => p.url);
  let classification: ProbeClass = "ok";
  if (blockedOnBothAttempts.length > 0) classification = "captcha-or-WAF";
  else if (finals.some((p) => p.classification === "dead")) classification = "dead";
  else if (finals.some((p) => p.classification === "login-wall")) classification = "login-wall";
  else if (finals.some((p) => p.classification === "error")) classification = "error";
  void id;
  return { classification, blockedOnBothAttempts, probes };
}

// ---------------------------------------------------------------------------
// Offline checks
// ---------------------------------------------------------------------------
function checkRubric(row: Row): TaskAudit["rubric"] {
  const problems: string[] = [];
  const items = row.precomputed_rubric?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, itemCount: 0, problems: ["precomputed_rubric.items missing or empty"] };
  }
  items.forEach((it, i) => {
    if (typeof it.criterion !== "string" || it.criterion.trim() === "")
      problems.push(`item ${i}: criterion missing`);
    if (typeof it.description !== "string" || it.description.trim() === "")
      problems.push(`item ${i}: description missing`);
    if (it.maxPoints !== undefined && (typeof it.maxPoints !== "number" || it.maxPoints <= 0))
      problems.push(`item ${i}: maxPoints not a positive number`);
  });
  const criteria = items.map((it) =>
    String(it.criterion ?? "")
      .trim()
      .toLowerCase(),
  );
  if (new Set(criteria).size !== criteria.length) problems.push("duplicate criterion text");
  return { ok: problems.length === 0, itemCount: items.length, problems };
}

const PURCHASE_WORDING_RE = /\b(purchase|buy|order|book|preorder|pre-order|reserve)\b/i;
const STOP_RUBRIC_RE =
  /critical point|up to \(but not beyond\)|without crossing|do not (complete|submit|place)|stop before|not beyond/i;

const PURCHASE_FLOW_RE =
  /(purchas\w*|order(ing)?|checkout|booking) (flow|workflow)|binding checkout/i;

function checkStopBeforePurchase(row: Row): boolean {
  const items = row.precomputed_rubric?.items ?? [];
  const stopItems = items.filter((it) =>
    STOP_RUBRIC_RE.test(`${it.criterion ?? ""} ${it.description ?? ""}`),
  );
  if (stopItems.length === 0) return false;
  if (PURCHASE_WORDING_RE.test(row.ques)) return true;
  // "I'd like to get X" style wording: the criterion itself names the purchase flow.
  return stopItems.some((it) => PURCHASE_FLOW_RE.test(String(it.criterion ?? "")));
}

function loadAchievability(
  trajRoot: string,
  onlyDirs?: string[],
): Map<string, NonNullable<TaskAudit["achievability"]>> {
  const out = new Map<string, NonNullable<TaskAudit["achievability"]>>();
  const modelDirs = readdirSync(trajRoot)
    .filter(
      (d) => d.startsWith("agent_hardbenchmark__") && statSync(join(trajRoot, d)).isDirectory(),
    )
    .filter((d) => !onlyDirs || onlyDirs.includes(d))
    .sort();
  modelDirs.forEach((dir, idx) => {
    const alias = `model-${idx + 1}`;
    for (const task of readdirSync(join(trajRoot, dir))) {
      const taskDir = join(trajRoot, dir, task);
      if (!statSync(taskDir).isDirectory()) continue;
      for (const run of readdirSync(taskDir)) {
        const runDir = join(taskDir, run);
        if (!statSync(runDir).isDirectory()) continue;
        let steps = 0;
        try {
          const traj = JSON.parse(readFileSync(join(runDir, "trajectory.json"), "utf8")) as {
            steps?: unknown[];
          };
          steps = traj.steps?.length ?? 0;
        } catch {
          /* unreadable trajectory: still record the run */
        }
        let outcomeSuccess: boolean | null = null;
        let processScore: number | null = null;
        const scorePath = join(runDir, "scores", "result.json");
        if (existsSync(scorePath)) {
          try {
            const score = JSON.parse(readFileSync(scorePath, "utf8")) as {
              outcomeSuccess?: boolean;
              processScore?: number;
            };
            outcomeSuccess = score.outcomeSuccess ?? null;
            processScore = score.processScore ?? null;
          } catch {
            /* ignore */
          }
        }
        const entry = out.get(task) ?? { everPassed: false, runs: [] };
        entry.runs.push({ model: alias, run, outcomeSuccess, processScore, steps });
        entry.everPassed = entry.everPassed || outcomeSuccess === true;
        out.set(task, entry);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

async function main() {
  const concurrency = Math.min(4, Number(arg("--concurrency") ?? 4) || 4);
  const only = arg("--only")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const skipReach = flag("--skip-reachability");
  const trajRoot = arg("--trajectories");
  const apply = flag("--apply");
  const date = new Date().toISOString().slice(0, 10);
  const outPath = arg("--out") ?? join(DATASET_DIR, `audit-${date}.json`);

  const lines = readFileSync(DATASET_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const rows: Row[] = lines.map((l) => JSON.parse(l) as Row);
  const targets = only ? rows.filter((r) => only.includes(r.id)) : rows;
  const trajDirs = arg("--trajectory-dirs")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const achievability = trajRoot ? loadAchievability(trajRoot, trajDirs) : undefined;

  console.log(
    `auditing ${targets.length}/${rows.length} tasks (concurrency ${concurrency}, reachability ${skipReach ? "skipped" : "on"})`,
  );

  const audits = await runPool(targets, concurrency, async (row): Promise<TaskAudit> => {
    const startUrl = row.web && row.web.length > 0 ? row.web : GOOGLE_FALLBACK;
    const deep = DEEP_PROBES[row.id] ?? [];
    const probeUrls = [...new Set([...(startUrl === GOOGLE_FALLBACK ? [] : [startUrl]), ...deep])];
    if (probeUrls.length === 0) probeUrls.push(startUrl);

    const t0 = Date.now();
    const reachability: TaskAudit["reachability"] = skipReach
      ? { classification: "skipped", blockedOnBothAttempts: [], probes: [] }
      : await probeTask(row.id, probeUrls);
    const rubric = checkRubric(row);
    const stopBeforePurchase = checkStopBeforePurchase(row);

    let valid = true;
    let invalid_reason: string | undefined;
    if (reachability.classification === "captcha-or-WAF") {
      valid = false;
      invalid_reason = `bot-wall (verified+proxy): ${reachability.blockedOnBothAttempts.join(", ")}`;
    } else if (reachability.classification === "dead") {
      const dead = reachability.probes.filter((p) => p.classification === "dead").map((p) => p.url);
      valid = false;
      invalid_reason = `dead: ${dead.join(", ")}`;
    } else if (!rubric.ok) {
      valid = false;
      invalid_reason = `rubric: ${rubric.problems.join("; ")}`;
    }

    const audit: TaskAudit = {
      id: row.id,
      category: row.category,
      startUrl,
      probeUrls,
      reachability,
      rubric,
      achievability: achievability?.get(row.id),
      stopBeforePurchase,
      valid,
      invalid_reason,
    };
    const summary = reachability.probes
      .map((p) => `${p.attempt}${p.proxies ? "p" : ""}:${p.classification}`)
      .join(" ");
    console.log(
      `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${row.id.padEnd(36)} ${reachability.classification.padEnd(14)} rubric=${rubric.ok ? "ok" : "BAD"} sbp=${stopBeforePurchase ? "flag" : "-"} passed=${audit.achievability ? (audit.achievability.everPassed ? "yes" : "NO") : "?"}  ${summary}`,
    );
    return audit;
  });

  // A partial re-run (--only) merges into the existing report instead of replacing it.
  let allAudits = audits;
  if (only && existsSync(outPath)) {
    const previous = JSON.parse(readFileSync(outPath, "utf8")) as { tasks?: TaskAudit[] };
    const merged = new Map((previous.tasks ?? []).map((t) => [t.id, t]));
    for (const a of audits) merged.set(a.id, a);
    allAudits = rows.map((r) => merged.get(r.id)).filter((t): t is TaskAudit => Boolean(t));
  }
  const summary = {
    date,
    total: rows.length,
    audited: allAudits.length,
    invalid: allAudits.filter((a) => !a.valid).map((a) => ({ id: a.id, reason: a.invalid_reason })),
    stopBeforePurchase: allAudits.filter((a) => a.stopBeforePurchase).map((a) => a.id),
    neverPassed: allAudits
      .filter((a) => a.achievability && !a.achievability.everPassed)
      .map((a) => a.id),
  };
  writeFileSync(outPath, JSON.stringify({ summary, tasks: allAudits }, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));

  if (apply) {
    const byId = new Map(audits.map((a) => [a.id, a]));
    // Untouched rows keep their original text so the jsonl diff shows only real changes.
    const updated = rows.map((row, i) => {
      const a = byId.get(row.id);
      if (!a) return lines[i];
      const next: Row = { ...row };
      const scriptSet = /^(bot-wall|dead|rubric)\b/.test(row.invalid_reason ?? "");
      if (!a.valid && (row.valid !== false || scriptSet)) {
        next.valid = false;
        next.invalid_reason = a.invalid_reason;
      } else if (a.valid && row.valid === false && scriptSet) {
        // A re-audit cleared a quarantine this script set earlier (hand-set reasons are kept).
        delete next.valid;
        delete next.invalid_reason;
      }
      if (a.stopBeforePurchase && !next.verdict_review)
        next.verdict_review = "stop-before-purchase";
      return JSON.stringify(next) === JSON.stringify(row) ? lines[i] : JSON.stringify(next);
    });
    writeFileSync(DATASET_PATH, updated.join("\n") + "\n");
    console.log(`applied flags to ${DATASET_PATH}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
