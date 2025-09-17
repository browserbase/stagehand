import { Locator } from "./locator";
import type { Frame } from "./frame";
import type { Page } from "./page";
import { v3Logger } from "@/lib/v3/logger";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator";

/**
 * Recognize iframe steps like "iframe" or "iframe[2]" in an XPath.
 */
const IFRAME_STEP_RE = /^iframe(?:\[\d+])?$/i;

type Axis = "child" | "desc";
type Step = { axis: Axis; raw: string; name: string };

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
): Promise<Locator> {
  let path = xpathOrSelector.trim();
  if (path.startsWith("xpath=")) path = path.slice("xpath=".length).trim();
  if (!path.startsWith("/")) path = "/" + path;

  const steps = parseXPath(path);
  let fl: FrameLocator | undefined;
  let buf: Step[] = [];

  const flushIntoFrameLocator = () => {
    if (!buf.length) return;
    const selectorForIframe = "xpath=" + buildXPathFromSteps(buf);
    v3Logger({
      category: "deep-hop",
      message: "resolving iframe via FrameLocator",
      level: 2,
      auxiliary: {
        selectorForIframe: { value: selectorForIframe, type: "string" },
        rootFrameId: { value: String(root.frameId), type: "string" },
      },
    });
    fl = fl
      ? fl.frameLocator(selectorForIframe)
      : frameLocatorFromFrame(page, root, selectorForIframe);
    buf = [];
  };

  for (const st of steps) {
    buf.push(st);
    if (IFRAME_STEP_RE.test(st.name)) flushIntoFrameLocator();
  }

  const finalSelector = "xpath=" + buildXPathFromSteps(buf);
  const targetFrame = fl ? await fl.resolveFrame() : root;
  v3Logger({
    category: "deep-hop",
    message: "final tail",
    level: 2,
    auxiliary: {
      frameId: { value: String(targetFrame.frameId), type: "string" },
      finalSelector: { value: finalSelector, type: "string" },
    },
  });
  return new Locator(targetFrame, finalSelector);
}

/**
 * Unified resolver that supports '>>' hop notation, deep XPath across iframes,
 * and plain single-frame selectors. Keeps hop logic in one shared place.
 */
export async function resolveLocatorWithHops(
  page: Page,
  root: Frame,
  selectorRaw: string,
): Promise<Locator> {
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
    const targetFrame = await fl.resolveFrame();
    return new Locator(targetFrame, parts[parts.length - 1]!);
  }

  // No hops — delegate to XPath-aware deep resolver when needed
  const isXPath = sel.startsWith("xpath=") || sel.startsWith("/");
  if (isXPath) return deepLocatorThroughIframes(page, root, sel);
  return new Locator(root, sel);
}
