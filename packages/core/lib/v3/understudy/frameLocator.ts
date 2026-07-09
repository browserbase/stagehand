import type { Protocol } from "devtools-protocol";
import { Locator } from "./locator.js";
import type { Page } from "./page.js";
import { Frame } from "./frame.js";
import { executionContexts, DEFAULT_MAIN_WORLD_TIMEOUT_MS } from "./executionContextRegistry.js";
import {
  ContentFrameNotFoundError,
  StagehandInvalidArgumentError,
} from "../types/public/sdkErrors.js";

/**
 * FrameLocator: resolves iframe elements to their child Frames and allows
 * creating locators scoped to that frame. Supports chaining.
 */
export class FrameLocator {
  private readonly parent?: FrameLocator;
  private readonly selector: string;
  private readonly page: Page;
  private readonly root?: Frame;

  constructor(
    page: Page,
    selector: string,
    parent?: FrameLocator,
    root?: Frame,
  ) {
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
  async resolveFrame(): Promise<Frame> {
    const parentFrame: Frame = this.parent
      ? await this.parent.resolveFrame()
      : (this.root ?? this.page.mainFrame());

    // Resolve the iframe element inside the parent frame
    const tmp = parentFrame.locator(this.selector);
    const parentSession = parentFrame.session;
    const { objectId } = await tmp.resolveNode();

    try {
      await parentSession.send("DOM.enable").catch(() => {});
      const desc = await parentSession.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;

      // Find direct child frames under the parent by consulting the Page's registry
      const childIds = await listDirectChildFrameIdsFromRegistry(
        this.page,
        parentFrame.frameId,
        1000,
      );

      for (const fid of childIds) {
        try {
          const owner = await parentSession.send<{
            backendNodeId: Protocol.DOM.BackendNodeId;
            nodeId?: Protocol.DOM.NodeId;
          }>("DOM.getFrameOwner", { frameId: fid as Protocol.Page.FrameId });
          if (owner.backendNodeId === iframeBackendNodeId) {
            // Ensure child frame is ready (handles OOPIF adoption or same-process)
            await ensureChildFrameReady(this.page, fid);
            return this.page.frameForId(fid);
          }
        } catch {
          // ignore and try next
        }
      }
      throw new ContentFrameNotFoundError(this.selector);
    } finally {
      await parentSession
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
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
    private readonly fl: FrameLocator,
    private readonly sel: string,
    private readonly nthIndex: number = -1,
  ) {}

  private async real(): Promise<Locator> {
    const frame = await this.fl.resolveFrame();
    const locator = frame.locator(this.sel);
    if (this.nthIndex < 0) return locator;
    return locator.nth(this.nthIndex);
  }

  // Locator API delegates
  async click(options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
  }) {
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
      throw new StagehandInvalidArgumentError(
        "locator().nth() expects a non-negative index",
      );
    }

    const nextIndex = Math.floor(value);
    if (nextIndex === this.nthIndex) return this;

    return new LocatorDelegate(this.fl, this.sel, nextIndex);
  }
}

/** Factory to start a FrameLocator chain from an arbitrary root Frame. */
export function frameLocatorFromFrame(
  page: Page,
  root: Frame,
  selector: string,
): FrameLocator {
  return new FrameLocator(page, selector, undefined, root);
}

async function listDirectChildFrameIdsFromRegistry(
  page: Page,
  parentFrameId: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const tree = page.getFullFrameTree();
      const node = findFrameNode(tree, parentFrameId);
      const ids = node?.childFrames?.map((c) => c.frame.id as string) ?? [];
      if (ids.length > 0 || Date.now() >= deadline) return ids;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 50));
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

/** Re-poll session ownership while waiting so OOPIF adoption can switch owners mid-wait. */
const SESSION_RECHECK_MS = 200;

/**
 * Block until the child frame's main-world execution context is available.
 * Handles same-process iframes and OOPIF adoption (session may change mid-wait).
 */
async function ensureChildFrameReady(
  page: Page,
  childFrameId: string,
  budgetMs: number = DEFAULT_MAIN_WORLD_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, budgetMs);

  while (Date.now() < deadline) {
    const owner = page.getSessionForFrame(childFrameId);
    await owner.send("Runtime.enable").catch(() => {});

    const cached = executionContexts.getMainWorld(owner, childFrameId);
    if (cached) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const attemptMs = Math.min(remaining, SESSION_RECHECK_MS);
    try {
      await executionContexts.waitForMainWorld(owner, childFrameId, attemptMs);
      return;
    } catch {
      // Re-resolve owner on the next iteration; adoption may have moved the frame.
    }
  }

  const owner = page.getSessionForFrame(childFrameId);
  const remaining = Math.max(0, deadline - Date.now());
  await executionContexts.waitForMainWorld(owner, childFrameId, remaining);
}
