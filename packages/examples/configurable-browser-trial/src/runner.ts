import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { classify, type PageSignals } from "./classify.js";
import { resolveModelKey, effectiveFeatures } from "./config.js";
import type { AttemptResult, Defaults, Features, Site } from "./types.js";

const REPLAY_BASE = "https://www.browserbase.com/sessions";

/** Build the Browserbase session create params from the resolved feature flags. */
function sessionParams(features: Features, region: string, projectId: string) {
  const browserSettings: Record<string, unknown> = {
    advancedStealth: features.advancedStealth,
    blockAds: features.blockAds,
    solveCaptchas: features.solveCaptchas,
  };
  // Geo-targeted residential proxies need the array form; plain `true` otherwise.
  let proxies: unknown = features.proxies;
  if (features.proxies && features.proxyCountry) {
    proxies = [{ type: "browserbase", geolocation: { country: features.proxyCountry } }];
  }
  return { projectId, region, proxies, browserSettings, keepAlive: false };
}

const GraderSchema = z.object({
  success: z.boolean().describe("True only if the stated goal was clearly achieved."),
  blocked: z
    .boolean()
    .describe("True if the page shows bot-detection, access-denied, or an unsolved CAPTCHA."),
  evidence: z.string().describe("One sentence of evidence for the judgment."),
});

async function captureSignals(page: any): Promise<PageSignals | undefined> {
  try {
    const [title, text] = await Promise.all([
      page.title().catch(() => ""),
      page.evaluate(() => (document.body?.innerText || "").slice(0, 4000)).catch(() => ""),
    ]);
    return { title, url: page.url(), text };
  } catch {
    return undefined;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "__timeout__"> {
  return Promise.race([
    p,
    new Promise<"__timeout__">((res) => setTimeout(() => res("__timeout__"), ms)),
  ]);
}

/**
 * Run ONE attempt against ONE site in a fresh session (= fresh proxy IP, which
 * is exactly the "retry to rotate the proxy" pattern CEs recommend).
 */
export async function runAttempt(
  site: Site,
  defaults: Defaults,
  attempt: number,
): Promise<AttemptResult> {
  const start = Date.now();
  const name = site.name ?? new URL(site.url).hostname.replace(/^www\./, "");
  const features = effectiveFeatures(defaults.features, site.features);
  const expect = site.expect ?? site.task;
  const model = defaults.model;
  const modelKey = resolveModelKey(model)!;

  const base: Omit<AttemptResult, "outcome" | "success" | "reason"> = {
    site: name,
    url: site.url,
    attempt,
    durationMs: 0,
  };

  let stagehand: Stagehand | null = null;
  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      modelName: model,
      modelClientOptions: { apiKey: modelKey.key },
      verbose: 0,
      browserbaseSessionCreateParams: sessionParams(
        features,
        defaults.region,
        process.env.BROWSERBASE_PROJECT_ID!,
      ) as any,
    });

    await stagehand.init();
    const sessionId = (stagehand as any).browserbaseSessionID as string | undefined;
    const replayUrl = sessionId ? `${REPLAY_BASE}/${sessionId}` : undefined;
    const page = stagehand.page;

    // Drive the task, bounded by the per-attempt time budget.
    let timedOut = false;
    const work = (async () => {
      await page.goto(site.url, { waitUntil: "domcontentloaded" });
      const agent = stagehand!.agent();
      await agent.execute({ instruction: site.task, maxSteps: defaults.maxSteps });
    })();

    const raced = await withTimeout(work, defaults.timeoutMs);
    if (raced === "__timeout__") timedOut = true;

    const signals = await captureSignals(page);

    // Grade the result with the model (separate from the doing).
    let graderSuccess = false;
    let graderBlocked = false;
    try {
      const verdict = await withTimeout(
        page.extract({
          instruction:
            `Goal: "${expect}".\n` +
            `Judge ONLY from the current page. Did the goal succeed? ` +
            `Set blocked=true if you see bot-detection, access-denied, or an unsolved CAPTCHA.`,
          schema: GraderSchema,
        }),
        30_000,
      );
      if (verdict !== "__timeout__") {
        graderSuccess = verdict.success;
        graderBlocked = verdict.blocked;
      }
    } catch {
      /* grading failed; classifier falls back to page signals */
    }

    const { outcome, detected, reason } = classify({
      graderSuccess,
      graderBlocked,
      timedOut,
      errored: false,
      signals,
    });

    return {
      ...base,
      outcome,
      success: outcome === "pass",
      reason,
      detected,
      sessionId,
      replayUrl,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // Make the enterprise-gating failure mode unmissable.
    const stealthGated =
      /stealth|enterprise|not.*allowed|forbidden|plan/i.test(message) && features.advancedStealth;
    return {
      ...base,
      outcome: "error",
      success: false,
      reason: stealthGated
        ? `Session failed — advanced stealth is Enterprise/Scale-plan only. Ask your Browserbase contact to enable it, or run with --preset baseline. (${message})`
        : `Session error: ${message}`,
      durationMs: Date.now() - start,
    };
  } finally {
    try {
      await stagehand?.close();
    } catch {
      /* ignore */
    }
  }
}
