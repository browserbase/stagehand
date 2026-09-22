import { LocatorOperation, isClosedSessionError } from "./locatorOperation.js";
import type { Protocol } from "devtools-protocol";
import { Locator } from "./locator.js";
import type { Page } from "./page.js";
import { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";

/**
 * Best-effort timeout for each locator-world attempt. Fallback eligibility can
 * extend an attempt while it waits for the main world.
 */

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
  async resolveFrame(operation = new LocatorOperation()): Promise<Frame> {
    const parentFrame: Frame = this.parent
      ? await this.parent.resolveFrame(operation)
      : (this.root ?? this.page.mainFrame());

    // Resolve the iframe element inside the parent frame
    const tmp = parentFrame.locator(this.selector, undefined, operation);
    const { objectId } = await tmp.resolveNode();
    const parentSession = parentFrame.session;

    try {
      await operation.send(parentSession, "DOM.enable").catch(() => {});
      const desc = await operation.send<Protocol.DOM.DescribeNodeResponse>(
        parentSession,
        "DOM.describeNode",
        {
          objectId,
        },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;

      // Find direct child frames under the parent by consulting the Page's registry
      const childIds = await listDirectChildFrameIdsFromRegistry(
        this.page,
        parentFrame.frameId,
        operation,
      );

      for (const fid of childIds) {
        let owner: {
          backendNodeId: Protocol.DOM.BackendNodeId;
          nodeId?: Protocol.DOM.NodeId;
        };
        try {
          owner = await operation.send<{
            backendNodeId: Protocol.DOM.BackendNodeId;
            nodeId?: Protocol.DOM.NodeId;
          }>(parentSession, "DOM.getFrameOwner", { frameId: fid as Protocol.Page.FrameId });
        } catch (error) {
          operation.budget.throwIfExpired();
          if (isClosedSessionError(error)) throw error;
          // ignore and try next
          continue;
        }
        if (owner.backendNodeId === iframeBackendNodeId) {
          // Readiness failures must propagate after the matching child is identified.
          await ensureChildFrameReady(this.page, fid, operation);
          return this.page.frameForId(fid);
        }
      }
      throw new Error(`Unable to obtain a content frame for selector: ${this.selector}`);
    } finally {
      await operation.send(parentSession, "Runtime.releaseObject", { objectId }).catch(() => {});
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

  async real(operation = new LocatorOperation()): Promise<Locator> {
    const frame = await this.fl.resolveFrame(operation);
    const locator = frame.locator(this.sel, undefined, operation);
    if (this.nthIndex < 0) return locator;
    return locator.nth(this.nthIndex);
  }

  private perform<T>(action: (locator: Locator) => Promise<T>): Promise<T> {
    const operation = new LocatorOperation();
    return operation.run(async () => action(await this.real(operation)));
  }

  // Locator API delegates
  async click(options?: { button?: "left" | "right" | "middle"; clickCount?: number }) {
    return this.perform((locator) => locator.click(options));
  }
  async hover() {
    return this.perform((locator) => locator.hover());
  }
  async fill(value: string) {
    return this.perform((locator) => locator.fill(value));
  }
  async type(text: string, options?: { delay?: number }) {
    return this.perform((locator) => locator.type(text, options));
  }
  async selectOption(values: string | string[]) {
    return this.perform((locator) => locator.selectOption(values));
  }
  async scrollTo(percent: number | string) {
    return this.perform((locator) => locator.scrollTo(percent));
  }
  async isVisible() {
    return this.perform((locator) => locator.isVisible());
  }
  async isChecked() {
    return this.perform((locator) => locator.isChecked());
  }
  async inputValue() {
    return this.perform((locator) => locator.inputValue());
  }
  async textContent() {
    return this.perform((locator) => locator.textContent());
  }
  async innerHtml() {
    return this.perform((locator) => locator.innerHtml());
  }
  async innerText() {
    return this.perform((locator) => locator.innerText());
  }
  async count() {
    return this.perform((locator) => locator.count());
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
  operation: LocatorOperation,
): Promise<string[]> {
  while (true) {
    try {
      const tree = page.getFullFrameTree();
      const node = findFrameNode(tree, parentFrameId);
      const ids = node?.childFrames?.map((c) => c.frame.id as string) ?? [];
      if (ids.length > 0) return ids;
    } catch {
      // ignore
    }
    await operation.budget.wait(50);
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
  operation: LocatorOperation,
): Promise<void> {
  await executionContexts.waitForLocatorWorldReady(
    () => page.getSessionForFrame(childFrameId),
    childFrameId,
    operation.budget,
  );
}
