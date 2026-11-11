import { Locator } from "./locator.js";
import type { Progress } from "./progress.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
const IFRAME_STEP_RE = /^i?frame(?:\[\d+\])?$/i;

type Axis = "child" | "desc";
type Step = { axis: Axis; raw: string; name: string };

export type ResolvedLocatorTarget = {
  frame: Frame;
  selector: string;
};

/** Parse XPath into steps preserving '/' vs '//' and the raw token (with [n]) */
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
    out += st.raw; // keep predicates intact
  }
  return out || "/";
}

/** Build a Locator scoped to the correct frame for a deep XPath crossing iframes. */
export async function deepLocatorThroughIframes(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
  progress?: Progress,
): Promise<Locator> {
  const target = await resolveDeepXPathTarget(page, root, xpathOrSelector, progress);
  return new Locator(target.frame, target.selector);
}

/**
 * Unified resolver that supports '>>' hop notation, deep XPath across iframes,
 * and plain single-frame selectors. Keeps hop logic in one shared place.
 */
export async function resolveLocatorTarget(
  page: Page,
  root: Frame,
  selectorRaw: string,
  progress?: Progress,
): Promise<ResolvedLocatorTarget> {
  progress?.throwIfStopped();
  const sel = selectorRaw.trim();
  const parts = sel
    .split(">>")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    // Build a FrameLocator chain for all but the last segment
    let fl = frameLocatorFromFrame(page, root, parts[0]!);
    for (let i = 1; i < parts.length - 1; i++) {
      fl = fl.frameLocator(parts[i]!);
    }
    const targetFrame = await fl.resolveFrame(progress);
    return { frame: targetFrame, selector: parts[parts.length - 1]! };
  }

  // No hops — delegate to XPath-aware deep resolver when needed
  const isXPath = sel.startsWith("xpath=") || sel.startsWith("/");
  if (isXPath) {
    return resolveDeepXPathTarget(page, root, sel, progress);
  }
  return { frame: root, selector: sel };
}

export async function resolveLocatorWithHops(
  page: Page,
  root: Frame,
  selectorRaw: string,
  progress?: Progress,
): Promise<Locator> {
  const target = await resolveLocatorTarget(page, root, selectorRaw, progress);
  return new Locator(target.frame, target.selector);
}

/**
 * Plan deep-XPath frame hops without resolving frames.
 * An iframe/frame step becomes a hop only when further selector steps follow it,
 * so a trailing iframe remains a parent-frame element target.
 */
export function planDeepXPathTarget(xpathOrSelector: string): {
  frameHopSelectors: string[];
  finalSelector: string;
} {
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

async function resolveDeepXPathTarget(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
  progress?: Progress,
): Promise<ResolvedLocatorTarget> {
  progress?.throwIfStopped();
  const plan = planDeepXPathTarget(xpathOrSelector);
  let fl: FrameLocator | undefined;
  for (const hop of plan.frameHopSelectors) {
    fl = fl ? fl.frameLocator(hop) : frameLocatorFromFrame(page, root, hop);
  }
  const targetFrame = fl ? await fl.resolveFrame(progress) : root;
  return { frame: targetFrame, selector: plan.finalSelector };
}
