import type { Protocol } from "devtools-protocol";
import { isCdpClosedError } from "./cdp.js";
import { Locator } from "./locator.js";
import { type Progress, runLocatorStep } from "./progress.js";
import type { Page } from "./page.js";
import { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";

/** Best-effort readiness budget for frame transitions, not an overall operation timeout. */
const FRAME_LOCATOR_READY_TIMEOUT_MS = 1_200;
/**
 * Best-effort timeout for each locator-world attempt. Fallback eligibility can
 * extend an attempt while it waits for the main world.
 */
const LOCATOR_WORLD_ATTEMPT_TIMEOUT_MS = 200;

/**
 * FrameLocator: resolves iframe elements to their child Frames and allows
 * creating locators scoped to that frame. Supports chaining.
 */
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

  /** Create a nested FrameLocator under this one. */
  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this.page, selector, this);
  }

  /** Resolve to the concrete Frame for this FrameLocator chain. */
  async resolveFrame(progress?: Progress): Promise<Frame> {
    progress?.throwIfStopped();
    const parentFrame: Frame = this.parent
      ? await this.parent.resolveFrame(progress)
      : (this.root ?? this.page.mainFrame());

    // Resolve the iframe element inside the parent frame
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

      // Find direct child frames under the parent by consulting the Page's registry
      const childIds = await listDirectChildFrameIdsFromRegistry(
        this.page,
        parentFrame.frameId,
        1000,
        progress,
      );

      for (const fid of childIds) {
        let owner: {
          backendNodeId: Protocol.DOM.BackendNodeId;
          nodeId?: Protocol.DOM.NodeId;
        };
        try {
          owner = await runLocatorStep(progress, "finding frame owner", () =>
            parentSession.send<{
              backendNodeId: Protocol.DOM.BackendNodeId;
              nodeId?: Protocol.DOM.NodeId;
            }>("DOM.getFrameOwner", { frameId: fid as Protocol.Page.FrameId }),
          );
        } catch (error) {
          progress?.throwIfStopped();
          if (progress && isCdpClosedError(error)) throw error;
          // ignore and try next
          continue;
        }
        if (owner.backendNodeId === iframeBackendNodeId) {
          // Readiness failures must propagate after the matching child is identified.
          await ensureChildFrameReady(this.page, fid, FRAME_LOCATOR_READY_TIMEOUT_MS, progress);
          return this.page.frameForId(fid);
        }
      }
      throw new Error(`Unable to obtain a content frame for selector: ${this.selector}`);
    } finally {
      const release = () =>
        parentSession.send("Runtime.releaseObject", { objectId }).catch(() => {});
      if (progress) await progress.cleanup(release);
      else await release();
      progress?.throwIfStopped();
    }
  }

  /** Return a Locator scoped to this frame. Methods delegate to the frame lazily. */
  locator(selector: string): LocatorDelegate {
    return new LocatorDelegate(this, selector);
  }
}

/** A small delegating wrapper that resolves the frame lazily per call. */
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

  // Locator API delegates
  async click(options?: { button?: "left" | "right" | "middle"; clickCount?: number }) {
    return (await this.real()).click(options);
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
  async count() {
    return (await this.real()).count();
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

/** Factory to start a FrameLocator chain from an arbitrary root Frame. */
export function frameLocatorFromFrame(page: Page, root: Frame, selector: string): FrameLocator {
  return new FrameLocator(page, selector, undefined, root);
}

async function listDirectChildFrameIdsFromRegistry(
  page: Page,
  parentFrameId: string,
  timeout: number,
  progress?: Progress,
): Promise<string[]> {
  progress?.throwIfStopped();
  const deadline = progress ? Infinity : Date.now() + timeout;
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
      // ignore
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

/**
 * Block until the Stagehand locator/extension world is usable in the child frame.
 * Re-resolves CDP session ownership on each attempt so OOPIF adoption cannot pin
 * the wait to a stale session for the full budget.
 */
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
        false, // Recheck session ownership between attempts.
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
