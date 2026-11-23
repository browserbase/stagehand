export type CssSelectorQuery = { kind: "css"; value: string };
export type XPathSelectorQuery = { kind: "xpath"; value: string };
/** The existing text= substring engine, not the future getByText contract. */
export type LegacyTextSelectorQuery = { kind: "text"; value: string };
export type SelectorQuery = CssSelectorQuery | XPathSelectorQuery | LegacyTextSelectorQuery;

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

  const steps = parseXPath(path);
  const frameHopSelectors: string[] = [];
  let buf: Step[] = [];

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

type Axis = "child" | "desc";
type Step = { axis: Axis; raw: string; name: string };

function parseXPath(path: string): Step[] {
  const s = path.trim();
  let i = 0;
  const steps: Step[] = [];
  while (i < s.length) {
    let axis: Axis = "child";
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

function buildXPathFromSteps(steps: ReadonlyArray<Step>): string {
  let out = "";
  for (const st of steps) {
    out += st.axis === "desc" ? "//" : "/";
    out += st.raw;
  }
  return out || "/";
}
