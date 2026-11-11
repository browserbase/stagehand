import { ChainTargetLocator, resolveLocatorChain } from "./locatorChain.js";
import { Locator } from "./locator.js";
import type { Progress } from "./progress.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import type { LocatorDescriptor, MouseButton } from "@browserbasehq/stagehand-protocol/types";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";

/** Lazily resolve a structured locator chain for each operation. */
export class DeepLocatorDelegate {
  constructor(
    readonly page: Page,
    readonly root: Frame,
    readonly selector: LocatorDescriptor["selector"],
  ) {}

  async real(progress?: Progress): Promise<Locator> {
    const [first] = await this.chainTargets(progress);
    if (!first) throw new Error("Could not find an element for the locator chain");
    return first;
  }

  async click(options?: { button?: MouseButton; clickCount?: number }, progress?: Progress) {
    return (await this.real(progress)).click(options, progress);
  }

  async count(progress?: Progress) {
    return (await this.chainTargets(progress)).length;
  }

  async allForMask(progress: Progress): Promise<Locator[]> {
    return this.chainTargets(progress);
  }

  private async chainTargets(progress?: Progress): Promise<Locator[]> {
    const targets = await resolveLocatorChain(this.page, this.root, this.selector, progress);
    const selector = this.selector.steps.at(-1)!.selector;
    return targets.map((target) => new ChainTargetLocator(target, selector));
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
}

/** Factory to create a deep locator delegate from a Page + root frame. */
export function deepLocatorFromPage(
  page: Page,
  root: Frame,
  selector: LocatorDescriptor["selector"],
): DeepLocatorDelegate {
  return new DeepLocatorDelegate(page, root, selector);
}
