import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import { DeepLocatorDelegate } from "./deepLocator.js";
import type { ElementChainTarget } from "./elementChainResolver.js";
import { Frame } from "./frame.js";
import { FrameChainResolver } from "./frameChainResolver.js";
import { Locator } from "./locator.js";
import type { Page } from "./page.js";
import { type Progress, runLocatorStep } from "./progress.js";

export class ChainLocatorDelegate extends DeepLocatorDelegate {
  constructor(
    page: Page,
    readonly chain: LocatorChain,
  ) {
    super(page, page.mainFrame(), "*");
  }

  override async real(progress?: Progress): Promise<Locator> {
    const result = await new FrameChainResolver(this.page).resolve(
      this.chain,
      { mode: "selected", index: 0 },
      progress,
    );
    if (result.mode === "count" || !result.targets.length)
      throw new Error("Locator chain did not match an element");
    return this.locators(result.targets)[0];
  }

  override async count(progress?: Progress): Promise<number> {
    const result = await new FrameChainResolver(this.page).resolve(
      this.chain,
      { mode: "count" },
      progress,
    );
    if (result.mode !== "count") throw new Error("Expected locator chain count");
    return result.count;
  }

  async all(progress: Progress): Promise<Locator[]> {
    const result = await new FrameChainResolver(this.page).resolve(
      this.chain,
      { mode: "all" },
      progress,
    );
    if (result.mode === "count") throw new Error("Expected locator chain targets");
    return this.locators(result.targets);
  }

  override nth(index: number): ChainLocatorDelegate {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new RangeError("Locator index must be a non-negative integer");
    return new ChainLocatorDelegate(this.page, {
      steps: [...this.chain.steps, { type: "nth", index }],
    });
  }

  private locators(targets: ElementChainTarget[]): Locator[] {
    const frames = new Map<string, Frame>();
    return targets.map((target) => {
      let frame = frames.get(target.frameId);
      if (!frame) {
        frame = new Frame(
          target.session,
          target.frameId,
          this.page.pageId,
          this.page.browserIsRemote,
          this.page.logger,
        );
        frames.set(target.frameId, frame);
      }
      return new TargetLocator(frame, target.backendNodeId);
    });
  }
}

class TargetLocator extends Locator {
  constructor(
    frame: Frame,
    private readonly targetId: Protocol.DOM.BackendNodeId,
  ) {
    super(frame, "*");
  }

  override async resolveNode(progress?: Progress) {
    const session = this.frame.session;
    const release = (response: Protocol.DOM.ResolveNodeResponse) =>
      response.object.objectId
        ? session.send("Runtime.releaseObject", { objectId: response.object.objectId })
        : Promise.resolve();
    const response = await runLocatorStep(
      progress,
      "resolving chain target",
      () =>
        session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
          backendNodeId: this.targetId,
        }),
      release,
    );
    if (!response.object.objectId) throw new Error("Locator chain target is no longer available");
    return { objectId: response.object.objectId, nodeId: null };
  }

  override async resolveNodesForMask(progress: Progress) {
    const session = this.frame.session;
    const node = await this.resolveNode(progress);
    return {
      nodes: [node],
      release: () =>
        progress.cleanup(() => session.send("Runtime.releaseObject", { objectId: node.objectId })),
    };
  }
}
