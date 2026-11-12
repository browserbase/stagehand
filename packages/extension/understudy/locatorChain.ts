import type { LocatorChain, LocatorQuerySelector } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import { Locator } from "./locator.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { resolveContentFrame } from "./frameLocator.js";
import { FrameSelectorResolver, type ResolvedNode } from "./selectorResolver.js";
import { executionContexts } from "./executionContextRegistry.js";
import { type Progress, runLocatorStep } from "./progress.js";

export type ChainTarget = { frame: Frame; backendNodeId: number };
type ChainNode = ChainTarget & { objectId: string; isFrame: boolean };

/** Evaluate once per operation; remote handles never escape the query plan. */
export async function resolveLocatorChain(
  page: Page,
  root: Frame,
  chain: LocatorChain,
  progress?: Progress,
): Promise<ChainTarget[]> {
  const owned: Array<{ frame: Frame; objectId: string }> = [];
  const track = (frame: Frame, node: { objectId: string }) => {
    owned.push({ frame, objectId: node.objectId });
  };
  const describe = async (frame: Frame, objectId: string): Promise<ChainNode> => {
    const { node } = await runLocatorStep(progress, "describing chain match", () =>
      frame.session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
    );
    return {
      frame,
      objectId,
      backendNodeId: node.backendNodeId,
      isFrame: /^(iframe|frame)$/i.test(node.localName || node.nodeName),
    };
  };
  const query = async (
    frame: Frame,
    selector: LocatorQuerySelector,
    scope?: ChainNode,
  ): Promise<ChainNode[]> => {
    const parsed = FrameSelectorResolver.parseSelector(selector);
    if (!scope) {
      const resolver = new FrameSelectorResolver(frame);
      const nodes = await resolver.resolveAll(parsed, {}, progress);
      nodes.forEach((node) => track(frame, node));
      const result: ChainNode[] = [];
      for (const node of nodes) result.push(await describe(frame, node.objectId));
      return result;
    }
    const helper =
      parsed.kind === "css"
        ? "resolveCssSelector"
        : parsed.kind === "text"
          ? "resolveTextSelector"
          : "resolveXPathMainWorld";
    const result: ChainNode[] = [];
    for (let index = 0; ; index++) {
      const response = await runLocatorStep(
        progress,
        "querying locator scope",
        () =>
          frame.session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
            objectId: scope.objectId,
            functionDeclaration: `function(value, index) {
            return globalThis.__stagehandLocatorScripts[${JSON.stringify(helper)}](value, index, this);
          }`,
            arguments: [{ value: selector.value }, { value: index }],
            returnByValue: false,
          }),
        (late) =>
          late.result.objectId
            ? frame.session.send("Runtime.releaseObject", { objectId: late.result.objectId })
            : undefined,
      );
      if (response.result.objectId) track(frame, { objectId: response.result.objectId });
      if (response.exceptionDetails) {
        throw new Error(
          response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
        );
      }
      if (!response.result.objectId || response.result.subtype === "null") break;
      result.push(await describe(frame, response.result.objectId));
    }
    return result;
  };

  try {
    let matches: ChainNode[] = [];
    for (let index = 0; index < chain.steps.length; index++) {
      progress?.throwIfStopped();
      const step = chain.steps[index]!;
      let next: ChainNode[] = [];
      if (index === 0) {
        if (step.type === "frame")
          throw new Error("A frame step requires a preceding iframe query");
        next = await query(root, step.selector);
      } else {
        for (const match of matches) {
          if (step.type === "frame" && !match.isFrame) {
            throw new Error("A frame step requires an iframe or frame element");
          }
          if (match.isFrame) {
            const child = await resolveContentFrame(
              page,
              match.frame,
              match.backendNodeId,
              progress,
            );
            next.push(...(await query(child, step.selector)));
          } else {
            next.push(...(await query(match.frame, step.selector, match)));
          }
        }
      }
      const seen = new Set<string>();
      matches = next.filter((node) => {
        const key = `${node.frame.frameId}:${node.backendNodeId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (step.nth !== undefined) matches = matches[step.nth] ? [matches[step.nth]!] : [];
      if (!matches.length) break;
    }
    return matches.map(({ frame, backendNodeId }) => ({ frame, backendNodeId }));
  } finally {
    const release = () =>
      Promise.all(
        owned.map(({ frame, objectId }) =>
          frame.session.send("Runtime.releaseObject", { objectId }).catch(() => {}),
        ),
      );
    if (progress) await progress.cleanup(release);
    else await release();
    progress?.throwIfStopped();
  }
}

/** Reuse ordinary actions without turning a resolved target back into a selector. */
export class ChainTargetLocator extends Locator {
  constructor(target: ChainTarget, selector: LocatorQuerySelector) {
    super(target.frame, selector);
    this.backendId = target.backendNodeId;
  }
  private readonly backendId: number;

  override async resolveNode(progress?: Progress): Promise<ResolvedNode> {
    const { contextId } = await executionContexts.waitForLocatorWorld(
      this.frame.session,
      this.frame.frameId,
      1000,
      progress,
    );
    const { object } = await runLocatorStep(
      progress,
      "resolving chain target",
      () =>
        this.frame.session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
          backendNodeId: this.backendId,
          executionContextId: contextId,
        }),
      (late) =>
        late.object.objectId
          ? this.frame.session.send("Runtime.releaseObject", { objectId: late.object.objectId })
          : undefined,
    );
    if (!object.objectId) throw new Error("Locator chain target is no longer attached");
    return { objectId: object.objectId, nodeId: null };
  }

  override async resolveNodesForMask(progress: Progress): Promise<ResolvedNode[]> {
    return [await this.resolveNode(progress)];
  }
}
