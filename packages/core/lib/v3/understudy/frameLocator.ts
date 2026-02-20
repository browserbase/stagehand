import type { Protocol } from "devtools-protocol";
import { Locator } from "./locator.js";
import type { Page } from "./page.js";
import { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";
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
            await ensureChildFrameReady(this.page, parentFrame, fid, 1200);
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

/**
 * Ensure we can evaluate in the child frame with minimal delay.
 * - If the child is same-process: parent session owns it and main world appears quickly.
 * - If OOPIF and adoption not finished: wait briefly for ownership change, then main world.
 */
async function ensureChildFrameReady(
  page: Page,
  parentFrame: Frame,
  childFrameId: string,
  budgetMs: number,
): Promise<void> {
  const parentSession = parentFrame.session;
  const deadline = Date.now() + Math.max(0, budgetMs);

  // If already owned by a different session (OOPIF adopted), wait briefly there.
  const owner = page.getSessionForFrame(childFrameId);
  if (owner && owner !== parentSession) {
    try {
      await executionContexts.waitForMainWorld(owner, childFrameId, 600);
    } catch {
      // best effort
    }
    return;
  }

  const hasMainWorldOnParent = (): boolean => {
    try {
      return (
        executionContexts.getMainWorld(parentSession, childFrameId) !== null
      );
    } catch {
      return false;
    }
  };

  if (hasMainWorldOnParent()) return;

  await parentSession
    .send("Page.setLifecycleEventsEnabled", { enabled: true })
    .catch(() => {});
  await parentSession.send("Runtime.enable").catch(() => {});

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      parentSession.off("Page.lifecycleEvent", onLifecycle);
      resolve();
    };
    const onLifecycle = (evt: Protocol.Page.LifecycleEventEvent) => {
      if (
        evt.frameId !== childFrameId ||
        (evt.name !== "DOMContentLoaded" &&
          evt.name !== "load" &&
          evt.name !== "networkIdle" &&
          evt.name !== "networkidle")
      ) {
        return;
      }
      if (hasMainWorldOnParent()) return finish();
      try {
        const nowOwner = page.getSessionForFrame(childFrameId);
        if (nowOwner && nowOwner !== parentSession) {
          const left = Math.max(150, deadline - Date.now());
          executionContexts
            .waitForMainWorld(nowOwner, childFrameId, left)
            .finally(finish);
        }
      } catch {
        // ignore
      }
    };
    parentSession.on("Page.lifecycleEvent", onLifecycle);

    const tick = () => {
      if (done) return;
      if (hasMainWorldOnParent()) return finish();
      try {
        const nowOwner = page.getSessionForFrame(childFrameId);
        if (nowOwner && nowOwner !== parentSession) {
          const left = Math.max(150, deadline - Date.now());
          executionContexts
            .waitForMainWorld(nowOwner, childFrameId, left)
            .finally(finish);
          return;
        }
      } catch {
        // ignore
      }
      if (Date.now() >= deadline) return finish();
      setTimeout(tick, 50);
    };
    tick();
  });
}
