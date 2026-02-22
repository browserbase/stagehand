import { Locator } from "./locator.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors.js";
import { IFRAME_STEP_RE } from "./a11y/snapshot/focusSelectors.js";

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
): Promise<Locator> {
  const target = await resolveDeepXPathTarget(page, root, xpathOrSelector);
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
): Promise<ResolvedLocatorTarget> {
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
    return { frame: targetFrame, selector: parts[parts.length - 1]! };
  }

  // No hops — delegate to XPath-aware deep resolver when needed
  const isXPath = sel.startsWith("xpath=") || sel.startsWith("/");
  if (isXPath) {
    return resolveDeepXPathTarget(page, root, sel);
  }
  return { frame: root, selector: sel };
}

export async function resolveLocatorWithHops(
  page: Page,
  root: Frame,
  selectorRaw: string,
): Promise<Locator> {
  const target = await resolveLocatorTarget(page, root, selectorRaw);
  return new Locator(target.frame, target.selector);
}

/**
 * DeepLocatorDelegate: a lightweight wrapper that looks like a Locator and
 * resolves to the correct frame/element on each call using hop/deep-XPath logic.
 *
 * Returned by `page.deepLocator()` for ergonomic, await-free chaining:
 *   page.deepLocator('iframe#ifrA >> #btn').click()
 */
export class DeepLocatorDelegate {
  constructor(
    private readonly page: Page,
    private readonly root: Frame,
    private readonly selector: string,
    private readonly nthIndex: number = 0,
  ) {}

  private async real(): Promise<Locator> {
    const base = await resolveLocatorWithHops(
      this.page,
      this.root,
      this.selector,
    );
    return base.nth(this.nthIndex);
  }

  // Locator API delegates
  async click(options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
  }) {
    return (await this.real()).click(options);
  }
  async count() {
    return (await this.real()).count();
  }
  async hover() {
    return (await this.real()).hover();
  }
  async fill(value: string) {
    return (await this.real()).fill(value);
  }
  async type(text: string, options?: { delay?: number }) {
    return (await this.real()).type(text, options);
  }
  async selectOption(values: string | string[]) {
    return (await this.real()).selectOption(values);
  }
  async scrollTo(percent: number | string) {
    return (await this.real()).scrollTo(percent);
  }
  async isVisible() {
    return (await this.real()).isVisible();
  }
  async isChecked() {
    return (await this.real()).isChecked();
  }
  async inputValue() {
    return (await this.real()).inputValue();
  }
  async textContent() {
    return (await this.real()).textContent();
  }
  async innerHtml() {
    return (await this.real()).innerHtml();
  }
  async innerText() {
    return (await this.real()).innerText();
  }
  async centroid() {
    return (await this.real()).centroid();
  }
  async backendNodeId() {
    return (await this.real()).backendNodeId();
  }
  async highlight(options?: {
    durationMs?: number;
    borderColor?: { r: number; g: number; b: number; a?: number };
    contentColor?: { r: number; g: number; b: number; a?: number };
  }) {
    return (await this.real()).highlight(options);
  }
  async sendClickEvent(options?: {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
    detail?: number;
  }) {
    return (await this.real()).sendClickEvent(options);
  }
  async setInputFiles(
    files:
      | string
      | string[]
      | {
          name: string;
          mimeType: string;
          buffer: ArrayBuffer | Uint8Array | Buffer | string;
        }
      | Array<{
          name: string;
          mimeType: string;
          buffer: ArrayBuffer | Uint8Array | Buffer | string;
        }>,
  ) {
    return (await this.real()).setInputFiles(files);
  }
  first() {
    return this.nth(0);
  }
  nth(index: number): DeepLocatorDelegate {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) {
      throw new StagehandInvalidArgumentError(
        "deepLocator().nth() expects a non-negative index",
      );
    }

    const nextIndex = Math.floor(value);
    if (nextIndex === this.nthIndex) return this;

    return new DeepLocatorDelegate(
      this.page,
      this.root,
      this.selector,
      nextIndex,
    );
  }
}

/** Factory to create a deep locator delegate from a Page + root frame. */
export function deepLocatorFromPage(
  page: Page,
  root: Frame,
  selector: string,
): DeepLocatorDelegate {
  return new DeepLocatorDelegate(page, root, selector);
}

async function resolveDeepXPathTarget(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
): Promise<ResolvedLocatorTarget> {
  let path = xpathOrSelector.trim();
  if (path.startsWith("xpath=")) path = path.slice("xpath=".length).trim();
  if (!path.startsWith("/")) path = "/" + path;

  const steps = parseXPath(path);
  let fl: FrameLocator | undefined;
  let buf: Step[] = [];

  const flushIntoFrameLocator = () => {
    if (!buf.length) return;
    const selectorForIframe = "xpath=" + buildXPathFromSteps(buf);
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
  return { frame: targetFrame, selector: finalSelector };
}
