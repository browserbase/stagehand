import type { Protocol } from "devtools-protocol";
import { isCdpClosedError } from "./cdp.js";
import { Locator } from "./locator.js";
import { type Progress, runLocatorStep } from "./progress.js";
import type { Page } from "./page.js";
import { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";

const FRAME_LOCATOR_READY_TIMEOUT_MS = 1_200;
const LOCATOR_WORLD_ATTEMPT_TIMEOUT_MS = 200;

export class FrameLocator {
  readonly parent?: FrameLocator;
  readonly selector: string;
  readonly page: Page;
  readonly root?: Frame;

  constructor(page: Page, selector: string, parent?: FrameLocator, root?: Frame) {
    this.page = page;
    this.selector = selector;
    this.parent = parent;
    this.root = root;
  }

  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this.page, selector, this);
  }

  async resolveFrame(progress?: Progress): Promise<Frame> {
    progress?.throwIfStopped();
    const parentFrame: Frame = this.parent
      ? await this.parent.resolveFrame(progress)
      : (this.root ?? this.page.mainFrame());

    const tmp = parentFrame.locator(this.selector);
    const parentSession = parentFrame.session;
    const { objectId } = await tmp.resolveNode(progress);

    try {
      await runLocatorStep(progress, "enabling DOM", () =>
        parentSession.send("DOM.enable").catch((error) => {
          if (progress && isCdpClosedError(error)) throw error;
        }),
      );
      const desc = await runLocatorStep(progress, "describing iframe", () =>
        parentSession.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
      );
      const iframeBackendNodeId = desc.node.backendNodeId;

      const childId = await findContentFrameId(
        this.page,
        parentFrame,
        iframeBackendNodeId,
        progress,
      );
      if (!childId)
        throw new Error(`Unable to obtain a content frame for selector: ${this.selector}`);
      await ensureChildFrameReady(this.page, childId, FRAME_LOCATOR_READY_TIMEOUT_MS, progress);
      return this.page.frameForId(childId);
    } finally {
      const release = () =>
        parentSession.send("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  locator(selector: string): LocatorDelegate {
    return new LocatorDelegate(this, selector);
  }
}

class LocatorDelegate {
  constructor(
    readonly fl: FrameLocator,
    readonly sel: string,
    readonly nthIndex: number = -1,
  ) {}

  async real(progress?: Progress): Promise<Locator> {
    const frame = await this.fl.resolveFrame(progress);
    const locator = frame.locator(this.sel);
    if (this.nthIndex < 0) return locator;
    return locator.nth(this.nthIndex);
  }

  async click(
    options?: { button?: "left" | "right" | "middle"; clickCount?: number },
    progress?: Progress,
  ) {
    return (await this.real(progress)).click(options, progress);
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
  async count(progress?: Progress) {
    return (await this.real(progress)).count(progress);
  }
  first(): LocatorDelegate {
    return this.nth(0);
  }
  nth(index: number): LocatorDelegate {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("locator().nth() expects a non-negative index");
    }

    const nextIndex = Math.floor(value);
    if (nextIndex === this.nthIndex) return this;

    return new LocatorDelegate(this.fl, this.sel, nextIndex);
  }
}

export function frameLocatorFromFrame(page: Page, root: Frame, selector: string): FrameLocator {
  return new FrameLocator(page, selector, undefined, root);
}

export async function findContentFrameId(
  page: Page,
  parentFrame: Pick<Frame, "session" | "frameId">,
  backendNodeId: Protocol.DOM.BackendNodeId,
  progress?: Progress,
  discoveryTimeout = progress ? Infinity : 1000,
): Promise<string | undefined> {
  const parentSession = parentFrame.session;
  const childIds = await listDirectChildFrameIdsFromRegistry(
    page,
    parentFrame.frameId,
    discoveryTimeout,
    progress,
  );
  for (const frameId of childIds) {
    let owner: Protocol.DOM.GetFrameOwnerResponse;
    try {
      owner = await runLocatorStep(progress, "finding frame owner", () =>
        parentSession.send<Protocol.DOM.GetFrameOwnerResponse>("DOM.getFrameOwner", { frameId }),
      );
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      continue;
    }
    if (owner.backendNodeId === backendNodeId) return frameId;
  }
  return undefined;
}

async function listDirectChildFrameIdsFromRegistry(
  page: Page,
  parentFrameId: string,
  timeout: number,
  progress?: Progress,
): Promise<string[]> {
  progress?.throwIfStopped();
  const deadline = Date.now() + timeout;
  while (true) {
    progress?.throwIfStopped();
    try {
      const tree = page.getFullFrameTree();
      const node = findFrameNode(tree, parentFrameId);
      const ids = node?.childFrames?.map((c) => c.frame.id as string) ?? [];
      if (ids.length > 0 || Date.now() >= deadline) return ids;
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
    }
    if (progress) await progress.delay(50);
    else await new Promise((r) => setTimeout(r, 50));
  }
}

function findFrameNode(
  tree: Protocol.Page.FrameTree,
  targetId: string,
): Protocol.Page.FrameTree | undefined {
  if (tree.frame.id === targetId) return tree;
  for (const c of tree.childFrames ?? []) {
    const hit = findFrameNode(c, targetId);
    if (hit) return hit;
  }
  return undefined;
}

async function ensureChildFrameReady(
  page: Page,
  childFrameId: string,
  budgetMs: number,
  progress?: Progress,
): Promise<void> {
  progress?.throwIfStopped();
  const deadline = Date.now() + Math.max(0, budgetMs);
  let lastError: unknown;

  while (progress || Date.now() < deadline) {
    progress?.throwIfStopped();
    const session = page.getSessionForFrame(childFrameId);
    const remaining = progress?.remainingMs() ?? deadline - Date.now();
    if (remaining <= 0) break;
    try {
      await executionContexts.waitForLocatorWorld(
        session,
        childFrameId,
        Math.min(remaining, LOCATOR_WORLD_ATTEMPT_TIMEOUT_MS),
        progress,
        { readinessRetries: "none" },
      );
      progress?.throwIfStopped();
      if (page.getSessionForFrame(childFrameId) === session) return;
    } catch (error) {
      progress?.throwIfStopped();
      if (
        progress &&
        isCdpClosedError(error) &&
        (error.message.startsWith("CDP connection closed:") ||
          page.getSessionForFrame(childFrameId) === session)
      ) {
        throw error;
      }
      lastError = error;
    }
  }

  throw new Error(
    `Locator world not ready for frame ${childFrameId}: exhausted ${budgetMs} ms frame-readiness budget`,
    { cause: lastError },
  );
}
