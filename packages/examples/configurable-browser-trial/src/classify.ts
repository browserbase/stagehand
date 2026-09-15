import type { Outcome } from "./types.js";

/**
 * Signatures of common anti-bot / challenge pages. We classify a failure as an
 * anti-bot block (vs. agent logic or a timeout) so the scorecard tells the
 * customer the truth: "you weren't blocked by us, you were blocked by Akamai."
 */
const VENDOR_SIGNATURES: { vendor: string; patterns: RegExp[] }[] = [
  {
    vendor: "Cloudflare",
    patterns: [
      /cloudflare/i,
      /cf-chl/i,
      /attention required/i,
      /checking your browser/i,
      /cf-ray/i,
    ],
  },
  { vendor: "Akamai", patterns: [/akamai/i, /reference #\d+\.\w+/i, /access denied.*akamai/i] },
  {
    vendor: "PerimeterX / HUMAN",
    patterns: [/perimeterx/i, /px-captcha/i, /press (?:and|&) hold/i, /human challenge/i],
  },
  { vendor: "DataDome", patterns: [/datadome/i, /geo\.captcha-delivery/i] },
  { vendor: "Kasada", patterns: [/kasada/i, /kpsdk/i] },
  { vendor: "reCAPTCHA", patterns: [/recaptcha/i, /i'?m not a robot/i, /g-recaptcha/i] },
  { vendor: "hCaptcha", patterns: [/hcaptcha/i] },
  { vendor: "FunCaptcha / Arkose", patterns: [/funcaptcha/i, /arkose/i] },
  { vendor: "Shape / F5", patterns: [/shape security/i, /imperva/i] },
];

const CAPTCHA_HINTS = [
  /captcha/i,
  /verify you are (?:a )?human/i,
  /are you a robot/i,
  /complete the security check/i,
];
const BLOCK_HINTS = [
  /access denied/i,
  /forbidden/i,
  /403/i,
  /unusual traffic/i,
  /blocked/i,
  /bot detected/i,
  /request blocked/i,
  /you have been blocked/i,
];
const WALL_HINTS = [
  /sign in/i,
  /log in to continue/i,
  /create (?:an )?account/i,
  /one[- ]time (?:pass)?code/i,
  /enter the code/i,
  /verification code/i,
  /please log in/i,
];

export interface PageSignals {
  title: string;
  url: string;
  /** A chunk of body text (first ~4k chars is plenty). */
  text: string;
}

/** Returns the detected anti-bot / captcha vendor on the page, if any. */
export function detectVendor(s: PageSignals): string | undefined {
  const hay = `${s.title}\n${s.url}\n${s.text}`;
  for (const { vendor, patterns } of VENDOR_SIGNATURES) {
    if (patterns.some((p) => p.test(hay))) return vendor;
  }
  return undefined;
}

function anyMatch(s: PageSignals, hints: RegExp[]): boolean {
  const hay = `${s.title}\n${s.text}`;
  return hints.some((p) => p.test(hay));
}

/**
 * Decide the outcome of an attempt from (a) the model's success judgment and
 * (b) hard signals scraped off the page. Page signals win for failures so we
 * can attribute the failure to a vendor rather than vague "agent failed".
 */
export function classify(opts: {
  graderSuccess: boolean;
  graderBlocked: boolean;
  timedOut: boolean;
  errored: boolean;
  signals?: PageSignals;
}): { outcome: Outcome; detected?: string; reason: string } {
  const { graderSuccess, graderBlocked, timedOut, errored, signals } = opts;
  const detected = signals ? detectVendor(signals) : undefined;

  if (errored && !signals) {
    return {
      outcome: "error",
      reason: "Session/runtime error before the page could be evaluated.",
    };
  }

  if (graderSuccess && !graderBlocked) {
    return { outcome: "pass", detected, reason: "Task completed and success criteria met." };
  }

  // Failure path — attribute it as specifically as possible.
  if (signals) {
    if (anyMatch(signals, CAPTCHA_HINTS) || /captcha/i.test(detected ?? "")) {
      return {
        outcome: "captcha_unsolved",
        detected,
        reason: `CAPTCHA challenge not solved${detected ? ` (${detected})` : ""}.`,
      };
    }
    if (graderBlocked || anyMatch(signals, BLOCK_HINTS)) {
      return {
        outcome: "blocked_antibot",
        detected,
        reason: `Blocked by anti-bot${detected ? ` (${detected})` : ""}.`,
      };
    }
    if (anyMatch(signals, WALL_HINTS)) {
      return {
        outcome: "account_wall",
        detected,
        reason: "Stopped at a login / OTP / account wall.",
      };
    }
  }

  if (timedOut) {
    return {
      outcome: "timeout",
      detected,
      reason: "Ran out of steps / time before completing the task.",
    };
  }
  if (graderBlocked) {
    return {
      outcome: "blocked_antibot",
      detected,
      reason: `Blocked by anti-bot${detected ? ` (${detected})` : ""}.`,
    };
  }
  return { outcome: "error", detected, reason: "Task did not meet success criteria." };
}
