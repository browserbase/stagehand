import type { AttemptResult, Manifest, Outcome, Scorecard, SiteScore } from "./types.js";

function topFailure(results: AttemptResult[]): Outcome | undefined {
  const counts = new Map<Outcome, number>();
  for (const r of results) {
    if (r.outcome === "pass") continue;
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  }
  let best: Outcome | undefined;
  let bestN = 0;
  for (const [o, n] of counts) {
    if (n > bestN) {
      best = o;
      bestN = n;
    }
  }
  return best;
}

/** Fold the flat attempt list into a per-site + overall scorecard. */
export function buildScorecard(
  manifest: Manifest,
  attempts: AttemptResult[],
  startedAt: string,
  finishedAt: string,
): Scorecard {
  const bySite = new Map<string, AttemptResult[]>();
  for (const a of attempts) {
    const arr = bySite.get(a.url) ?? [];
    arr.push(a);
    bySite.set(a.url, arr);
  }

  const sites: SiteScore[] = manifest.sites.map((s) => {
    const results = bySite.get(s.url) ?? [];
    const name = s.name ?? new URL(s.url).hostname.replace(/^www\./, "");
    const passes = results.filter((r) => r.success).length;
    const successRate = results.length ? passes / results.length : 0;
    const target = s.target ?? manifest.defaults.target;
    const detected = [...new Set(results.map((r) => r.detected).filter(Boolean) as string[])];
    return {
      name,
      url: s.url,
      task: s.task,
      antibot: s.antibot,
      attempts: results.length,
      passes,
      successRate,
      target,
      met: successRate >= target,
      topFailure: topFailure(results),
      detected,
      results,
    };
  });

  const totalAttempts = attempts.length;
  const totalPasses = attempts.filter((a) => a.success).length;
  const sitesMet = sites.filter((s) => s.met).length;

  return {
    name: manifest.name,
    customer: manifest.customer,
    startedAt,
    finishedAt,
    features: manifest.defaults.features,
    region: manifest.defaults.region,
    model: manifest.defaults.model,
    sites,
    totalAttempts,
    totalPasses,
    overallRate: totalAttempts ? totalPasses / totalAttempts : 0,
    sitesMet,
    siteCount: sites.length,
  };
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  pass: "Pass",
  blocked_antibot: "Blocked (anti-bot)",
  captcha_unsolved: "CAPTCHA unsolved",
  account_wall: "Account/OTP wall",
  timeout: "Timed out",
  error: "Error",
};
