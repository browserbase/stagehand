import {
  GetByTextOptionsSchema,
  GetByRoleOptionsSchema,
  RoleSelectorQuerySchema,
  LocatorQuerySelectorSchema,
} from "./schemas.js";
import type {
  GetByTextOptions,
  GetByRoleOptions,
  AriaRole,
  LocatorChain,
  LocatorQuerySelector,
  LocatorQueryStep,
} from "./types.js";

export function textQueryStep(value: string, options: GetByTextOptions = {}): LocatorQueryStep {
  const { exact = false } = GetByTextOptionsSchema.parse(options);
  return {
    type: "query",
    selector: LocatorQuerySelectorSchema.parse({ kind: "textMatch", value, exact }),
  };
}

export function roleQueryStep(role: AriaRole, options: GetByRoleOptions = {}): LocatorQueryStep {
  return {
    type: "query",
    selector: RoleSelectorQuerySchema.parse({
      kind: "role",
      value: role,
      ...GetByRoleOptionsSchema.parse(options),
    }),
  };
}

export function locatorSteps(selector: string): LocatorChain["steps"] {
  const trimmed = selector.trim();
  // Legacy generated-path routing assumes an absolute XPath. Scoped expressions
  // must reach the query engine without acquiring a leading slash.
  const plan =
    trimmed.startsWith("xpath=") &&
    !trimmed.slice(6).trim().startsWith("/") &&
    !trimmed.includes(">>")
      ? { frameHopSelectors: [], finalSelector: trimmed }
      : planLegacySelector(selector);
  const [first, ...rest] = [...plan.frameHopSelectors, plan.finalSelector];
  return [
    { type: "query", selector: parseLegacySelector(first!) },
    ...rest.map((value) => ({ type: "frame" as const, selector: parseLegacySelector(value) })),
  ];
}

export type CssSelectorQuery = Extract<LocatorQuerySelector, { kind: "css" }>;
export type XPathSelectorQuery = Extract<LocatorQuerySelector, { kind: "xpath" }>;
/** The legacy text= substring engine, separate from getByText matching. */
export type LegacyTextSelectorQuery = Extract<LocatorQuerySelector, { kind: "text" }>;
export type SelectorQuery = Exclude<LocatorQuerySelector, { kind: "role" }>;

export type LegacySelectorPlan = {
  frameHopSelectors: string[];
  finalSelector: string;
};

export const IFRAME_STEP_RE = /^i?frame(?:\[\d+])?$/i;

/**
 * Interpret a legacy string within one frame. This does not resolve frame hops
 * or validate CSS/XPath syntax; the browser engine retains that responsibility.
 */
export function parseLegacySelector(raw: string): SelectorQuery {
  const trimmed = raw.trim();

  const isText = /^text=/i.test(trimmed);
  const looksLikeXPath =
    /^xpath=/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("(");
  const isCssPrefixed = /^css=/i.test(trimmed);

  if (isText) {
    let value = trimmed.replace(/^text=/i, "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return { kind: "text", value };
  }

  if (looksLikeXPath) {
    const value = trimmed.replace(/^xpath=/i, "");
    return { kind: "xpath", value };
  }

  let selector = isCssPrefixed ? trimmed.replace(/^css=/i, "") : trimmed;
  if (selector.includes(">>")) {
    selector = selector
      .split(">>")
      .map((piece) => piece.trim())
      .filter(Boolean)
      .join(" ");
  }

  return { kind: "css", value: selector };
}

/**
 * Plan frame routing before interpreting each frame-local selector. Preserve the
 * legacy precedence: >> splitting is not quote-aware, and XPath routing only
 * recognizes a lowercase xpath= prefix or a leading slash. Engine inference is
 * intentionally different (case-insensitive prefixes and parenthesized XPath).
 */
export function planLegacySelector(raw: string): LegacySelectorPlan {
  const selector = raw.trim();
  const parts = selector
    .split(">>")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return { frameHopSelectors: parts.slice(0, -1), finalSelector: parts[parts.length - 1]! };
  }

  if (selector.startsWith("xpath=") || selector.startsWith("/")) {
    return planDeepXPathTarget(selector);
  }
  return { frameHopSelectors: [], finalSelector: selector };
}

/**
 * Plan generated deep-XPath frame hops without resolving frames. A trailing
 * iframe/frame stays an element target; it is a hop only if more steps follow.
 * This is the existing path tokenizer, not a general XPath parser.
 */
export function planDeepXPathTarget(xpathOrSelector: string): LegacySelectorPlan {
  let path = xpathOrSelector.trim();
  if (path.startsWith("xpath=")) path = path.slice("xpath=".length).trim();
  if (!path.startsWith("/")) path = "/" + path;

  const steps = parseXPathToSteps(path);
  const frameHopSelectors: string[] = [];
  let buf: LegacyXPathStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    buf.push(st);
    const hasStepsAfter = i < steps.length - 1;
    if (IFRAME_STEP_RE.test(st.name) && hasStepsAfter) {
      frameHopSelectors.push("xpath=" + buildXPathFromSteps(buf));
      buf = [];
    }
  }

  return {
    frameHopSelectors,
    finalSelector: "xpath=" + buildXPathFromSteps(buf),
  };
}

export type LegacyXPathAxis = "child" | "desc";
export type LegacyXPathStep = { axis: LegacyXPathAxis; raw: string; name: string };

/** Tokenize generated paths; deliberately preserve legacy handling of slash literals. */
export function parseXPathToSteps(path: string): LegacyXPathStep[] {
  const s = path.trim();
  let i = 0;
  const steps: LegacyXPathStep[] = [];
  while (i < s.length) {
    let axis: LegacyXPathAxis = "child";
    if (s.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (s[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    while (i < s.length && s[i] !== "/") i++;
    const raw = s.slice(start, i).trim();
    if (!raw) continue;

    const name = raw.replace(/\[\d+\]\s*$/u, "").toLowerCase();
    steps.push({ axis, raw, name });
  }
  return steps;
}

/** Rebuild a generated path, preserving each nonempty step and its axis. */
export function buildXPathFromSteps(steps: ReadonlyArray<LegacyXPathStep>): string {
  let out = "";
  for (const st of steps) {
    out += st.axis === "desc" ? "//" : "/";
    out += st.raw;
  }
  return out || "/";
}
