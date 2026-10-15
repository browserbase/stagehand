import { Locator } from "./locator.js";
import type { Progress } from "./progress.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
import type { MouseButton } from "@browserbasehq/stagehand-protocol/types";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";
import { planDeepXPathTarget, planLocatorTarget, type LocatorTargetPlan } from "./locatorTarget.js";

export type ResolvedLocatorTarget = {
  frame: Frame;
  selector: string;
};

/** Build a Locator scoped to the correct frame for a deep XPath crossing iframes. */
export async function deepLocatorThroughIframes(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
  progress?: Progress,
): Promise<Locator> {
  progress?.throwIfStopped();
  const target = await resolveTargetPlan(
    page,
    root,
    planDeepXPathTarget(xpathOrSelector),
    progress,
  );
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
  return resolveTargetPlan(page, root, planLocatorTarget(selectorRaw), progress);
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
 * DeepLocatorDelegate: a lightweight wrapper that looks like a Locator and
 * resolves to the correct frame/element on each call using hop/deep-XPath logic.
 *
 * Returned by `page.deepLocator()` for ergonomic, await-free chaining:
 *   page.deepLocator('iframe#ifrA >> #btn').click()
 */
export class DeepLocatorDelegate {
  constructor(
    readonly page: Page,
    readonly root: Frame,
    readonly selector: string,
    // -1 preserves every match for operations such as screenshot masking while
    // ordinary single-element operations still resolve their first match.
    readonly nthIndex: number = -1,
  ) {}

  async real(progress?: Progress): Promise<Locator> {
    const base = await resolveLocatorWithHops(this.page, this.root, this.selector, progress);
    return this.nthIndex < 0 ? base : base.nth(this.nthIndex);
  }

  // Locator API delegates
  async click(options?: { button?: MouseButton; clickCount?: number }, progress?: Progress) {
    return (await this.real(progress)).click(options, progress);
  }
  async count(progress?: Progress) {
    return (await this.real(progress)).count(progress);
  }
  async hover(progress?: Progress) {
    return (await this.real(progress)).hover(progress);
  }
  async fill(value: string, progress?: Progress) {
    return (await this.real(progress)).fill(value, progress);
  }
  async type(text: string, options?: { delay?: number }, progress?: Progress) {
    return (await this.real(progress)).type(text, options, progress);
  }
  async selectOption(values: string | string[], progress?: Progress) {
    return (await this.real(progress)).selectOption(values, progress);
  }
  async scrollTo(percent: number | string, progress?: Progress) {
    return (await this.real(progress)).scrollTo(percent, progress);
  }
  async isVisible(progress?: Progress) {
    return (await this.real(progress)).isVisible(progress);
  }
  async isChecked(progress?: Progress) {
    return (await this.real(progress)).isChecked(progress);
  }
  async inputValue(progress?: Progress) {
    return (await this.real(progress)).inputValue(progress);
  }
  async textContent(progress?: Progress) {
    return (await this.real(progress)).textContent(progress);
  }
  async innerHtml(progress?: Progress) {
    return (await this.real(progress)).innerHtml(progress);
  }
  async innerText(progress?: Progress) {
    return (await this.real(progress)).innerText(progress);
  }
  async centroid(progress?: Progress) {
    return (await this.real(progress)).centroid(progress);
  }
  async backendNodeId(progress?: Progress) {
    return (await this.real(progress)).backendNodeId(progress);
  }
  async highlight(
    options?: {
      durationMs?: number;
      borderColor?: { r: number; g: number; b: number; a?: number };
      contentColor?: { r: number; g: number; b: number; a?: number };
    },
    progress?: Progress,
  ) {
    return (await this.real(progress)).highlight(options, progress);
  }
  async sendClickEvent(
    options?: {
      bubbles?: boolean;
      cancelable?: boolean;
      composed?: boolean;
      detail?: number;
    },
    progress?: Progress,
  ) {
    return (await this.real(progress)).sendClickEvent(options, progress);
  }
  async setInputFiles(files: SetInputFilesArgument, progress?: Progress) {
    return (await this.real(progress)).setInputFiles(files, progress);
  }
  first() {
    return this.nth(0);
  }
  nth(index: number): DeepLocatorDelegate {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("deepLocator().nth() expects a non-negative index");
    }

    const nextIndex = Math.floor(value);
    if (nextIndex === this.nthIndex) return this;

    return new DeepLocatorDelegate(this.page, this.root, this.selector, nextIndex);
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

async function resolveTargetPlan(
  page: Page,
  root: Frame,
  plan: LocatorTargetPlan,
  progress?: Progress,
): Promise<ResolvedLocatorTarget> {
  progress?.throwIfStopped();
  let fl: FrameLocator | undefined;
  for (const hop of plan.frameHopSelectors) {
    fl = fl ? fl.frameLocator(hop) : frameLocatorFromFrame(page, root, hop);
  }
  const targetFrame = fl ? await fl.resolveFrame(progress) : root;
  return {
    frame: targetFrame,
    selector: plan.finalSelector,
  };
}
