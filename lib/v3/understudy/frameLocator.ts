import type { Protocol } from "devtools-protocol";
import { Locator } from "./locator";
import type { Page } from "./page";
import { Frame } from "./frame";

/**
 * FrameLocator: resolves iframe elements to their child Frames and allows
 * creating locators scoped to that frame. Supports chaining.
 */
export class FrameLocator {
  private readonly parent?: FrameLocator;
  private readonly selector: string;
  private readonly page: Page;

  constructor(page: Page, selector: string, parent?: FrameLocator) {
    this.page = page;
    this.selector = selector;
    this.parent = parent;
  }

  /** Create a nested FrameLocator under this one. */
  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this.page, selector, this);
  }

  /** Resolve to the concrete Frame for this FrameLocator chain. */
  async resolveFrame(): Promise<Frame> {
    const parentFrame: Frame = this.parent
      ? await this.parent.resolveFrame()
      : this.page.mainFrame();

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
            return this.page.frameForId(fid);
          }
        } catch {
          // ignore and try next
        }
      }
      throw new Error(
        `frameLocator: could not resolve child frame for selector: ${this.selector}`,
      );
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
  ) {}

  private async real(): Promise<Locator> {
    const frame = await this.fl.resolveFrame();
    return frame.locator(this.sel);
  }

  // Locator API delegates
  async click(options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
  }) {
    return (await this.real()).click(options);
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
  first(): LocatorDelegate {
    // Underlying querySelector already returns the first; keep chaining stable
    return this;
  }
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
