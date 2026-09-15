import { z } from "zod";

/**
 * The feature flags that map 1:1 to what customers actually toggle during a
 * Browserbase verified / advanced-stealth trial. These are the knobs CEs spend
 * a week explaining over Slack — here they are defaults you can't get wrong.
 */
export const FeaturesSchema = z.object({
  /**
   * Advanced stealth ("Verified"). Enterprise/Scale-plan only. Default ON —
   * the single most common trial mistake is testing bot-detection WITHOUT it.
   */
  advancedStealth: z.boolean().default(true),
  /** Browserbase-managed residential proxies. Paired with stealth — "it's a must". */
  proxies: z.boolean().default(true),
  /** In-house CAPTCHA solving (Cloudflare, hCaptcha, FunCaptcha, reCAPTCHA…). */
  solveCaptchas: z.boolean().default(true),
  /** Block ads/trackers to cut noise + bandwidth. */
  blockAds: z.boolean().default(true),
  /**
   * ISO country code for residential proxy geo-targeting (e.g. "US", "BR",
   * "MX"). Many sites surface proxy location during MFA — match the customer's.
   */
  proxyCountry: z.string().optional(),
});
export type Features = z.infer<typeof FeaturesSchema>;

export const SiteSchema = z.object({
  /** Target URL to start from. */
  url: z.string().url(),
  /** Natural-language description of what the agent should accomplish. */
  task: z.string().min(1),
  /**
   * What "success" looks like, in plain English. Used to grade each attempt.
   * If omitted, falls back to `task`.
   */
  expect: z.string().optional(),
  /** Friendly label for reports. Defaults to the URL hostname. */
  name: z.string().optional(),
  /** Per-site success-rate target (0–1). Defaults to manifest-level target. */
  target: z.number().min(0).max(1).optional(),
  /** Informational: anti-bot vendor you expect to face (cloudflare, akamai…). */
  antibot: z.string().optional(),
  /** Per-site feature overrides (e.g. turn proxies off for one site). */
  features: FeaturesSchema.partial().optional(),
  /** Per-site attempt-count override. */
  attempts: z.number().int().positive().optional(),
});
export type Site = z.infer<typeof SiteSchema>;

export const DefaultsSchema = z.object({
  /** Times to run EACH site. Stability over N runs is the real bar, not 1-shot. */
  attempts: z.number().int().positive().default(3),
  /** How many sessions to run at once. */
  concurrency: z.number().int().positive().default(5),
  /** Browserbase region. */
  region: z.enum(["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]).default("us-west-2"),
  /** Default per-site success target (0–1). */
  target: z.number().min(0).max(1).default(0.8),
  /** Model that drives + grades each task. */
  model: z.string().default("anthropic/claude-sonnet-4-5"),
  /** Max agent steps per attempt before we call it a timeout. */
  maxSteps: z.number().int().positive().default(18),
  /** Per-attempt wall-clock budget in ms. */
  timeoutMs: z.number().int().positive().default(120_000),
  features: FeaturesSchema.default({}),
});
export type Defaults = z.infer<typeof DefaultsSchema>;

export const ManifestSchema = z.object({
  /** Name of the trial — shows up on the report. */
  name: z.string().default("Browserbase Verified Trial"),
  /** Customer / company name for branding the leadership report. */
  customer: z.string().optional(),
  defaults: DefaultsSchema.default({}),
  sites: z.array(SiteSchema).min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** How a single attempt ended. Drives the scorecard + guardrail warnings. */
export type Outcome =
  | "pass"
  | "blocked_antibot"
  | "captcha_unsolved"
  | "account_wall"
  | "timeout"
  | "error";

export interface AttemptResult {
  site: string;
  url: string;
  attempt: number;
  outcome: Outcome;
  /** True only for `pass`. */
  success: boolean;
  reason: string;
  /** Anti-bot / captcha vendor detected on the page, if any. */
  detected?: string;
  sessionId?: string;
  /** Browserbase session replay URL — the artifact CEs paste into Slack. */
  replayUrl?: string;
  durationMs: number;
}

export interface SiteScore {
  name: string;
  url: string;
  task: string;
  antibot?: string;
  attempts: number;
  passes: number;
  successRate: number;
  target: number;
  met: boolean;
  /** Most common non-pass outcome — the headline failure mode. */
  topFailure?: Outcome;
  detected: string[];
  results: AttemptResult[];
}

export interface Scorecard {
  name: string;
  customer?: string;
  startedAt: string;
  finishedAt: string;
  features: Features;
  region: string;
  model: string;
  sites: SiteScore[];
  totalAttempts: number;
  totalPasses: number;
  overallRate: number;
  sitesMet: number;
  siteCount: number;
}
