import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { type Progress, runLocatorStep } from "../../progress.js";
import type { Page } from "../../page.js";
import { Frame } from "../../frame.js";
import { FrameSelectorResolver } from "../../selectorResolver.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { buildLocatorInvocation } from "../../locatorInvocation.js";
import type {
  FrameParentIndex,
  ResolvedCssFocus,
  ResolvedFocusFrame,
} from "../../../types/private/snapshot.js";
import { normalizeXPath } from "./xpathUtils.js";
import { decodeLocatorQuery } from "../../../types/private/semanticLocator.js";
import { SelectorEvaluationError } from "../../selectorEvaluationError.js";
import { planLocatorTarget, planXPathSnapshotTarget } from "../../locatorTarget.js";

/**
 * Given a cross-frame XPath, walk iframe steps to resolve:
 * - the target frameId (last iframe hop)
 * - the tail XPath (within the target frame)
 * - the absolute XPath prefix up to the iframe element hosting that frame
 */
export async function resolveFocusFrameAndTail(
  page: Page,
  absoluteXPath: string,
  parentByFrame: FrameParentIndex,
  rootId: string,
  progress?: Progress,
): Promise<ResolvedFocusFrame> {
  progress?.throwIfStopped();
  const plan = planXPathSnapshotTarget(absoluteXPath);
  const targetFrameId = await resolveSnapshotFrameHops(
    page,
    plan.frameHopSelectors,
    parentByFrame,
    rootId,
    progress,
  );
  return {
    targetFrameId,
    tailXPath: normalizeXPath(plan.finalSelector),
    absPrefix: plan.xpathPrefix ?? "",
  };
}

/** Resolve focus frame and tail CSS selector using '>>' to hop iframes. */
export async function resolveCssFocusFrameAndTail(
  page: Page,
  rawSelector: string,
  parentByFrame: FrameParentIndex,
  rootId: string,
  progress?: Progress,
): Promise<ResolvedCssFocus> {
  progress?.throwIfStopped();
  const plan = planLocatorTarget(rawSelector.trim() || "*");
  const targetFrameId = await resolveSnapshotFrameHops(
    page,
    plan.frameHopSelectors,
    parentByFrame,
    rootId,
    progress,
  );
  return {
    targetFrameId,
    tailSelector: plan.finalSelector,
    absPrefix: plan.xpathPrefix ?? "",
  };
}

/** Snapshot lookup uses the captured frame tree and never waits for a new child frame. */
async function resolveSnapshotFrameHops(
  page: Page,
  frameHopSelectors: string[],
  parentByFrame: FrameParentIndex,
  rootId: string,
  progress?: Progress,
): Promise<string> {
  let ctxFrameId = rootId;
  for (const selector of frameHopSelectors) {
    progress?.throwIfStopped();
    const parentSess = page.getSessionForFrame(ctxFrameId);
    const frame = new Frame(parentSess, ctxFrameId, "", false, page.logger);
    const resolver = new FrameSelectorResolver(frame, { readinessRetries: "none" });
    const resolved = await resolver.resolveFirst(
      FrameSelectorResolver.parseSelector(selector),
      progress,
    );
    if (!resolved) {
      throw iframeResolutionError(selector, "Failed to resolve iframe element");
    }
    const { objectId } = resolved;
    try {
      await runLocatorStep(progress, "enabling DOM", () =>
        parentSess.send("DOM.enable").catch(() => {}),
      );
      const desc = await runLocatorStep(progress, "reading snapshot iframe", () =>
        parentSess.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
      );
      const iframeBackendNodeId = desc.node.backendNodeId;
      let childFrameId: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, ctxFrameId)) {
        try {
          const { backendNodeId } = await runLocatorStep(
            progress,
            "finding snapshot iframe owner",
            () => parentSess.send<{ backendNodeId: number }>("DOM.getFrameOwner", { frameId: fid }),
          );
          if (backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch {
          progress?.throwIfStopped();
          continue;
        }
      }
      if (!childFrameId) {
        throw iframeResolutionError(selector, "Could not map iframe to child frameId");
      }
      ctxFrameId = childFrameId;
    } finally {
      await releaseSnapshotObject(parentSess, objectId, progress);
    }
  }

  progress?.throwIfStopped();
  return ctxFrameId;
}

function iframeResolutionError(frameUrl: string, message: string): Error {
  return new Error(
    `Unable to resolve frameId for iframe with URL: ${frameUrl} Full error: ${message}`,
  );
}

/** Resolve an XPath to a Runtime remoteObjectId in the given CDP session. */
export async function resolveObjectIdForXPath(
  session: CDPSessionLike,
  xpath: string,
  frameId?: string,
  index = 0,
  progress?: Progress,
): Promise<string | null> {
  const expression = buildLocatorInvocation("resolveXPathMainWorld", [
    JSON.stringify(xpath),
    JSON.stringify(index),
  ]);
  return resolveObjectId(session, expression, frameId, progress);
}

/** Resolve a CSS selector or semantic query within one frame to a Runtime objectId. */
export async function resolveObjectIdForCss(
  session: CDPSessionLike,
  selector: string,
  frameId?: string,
  index = 0,
  progress?: Progress,
): Promise<string | null> {
  const steps = decodeLocatorQuery(selector);
  const expression = buildLocatorInvocation(
    steps ? "resolveSemanticSelector" : "resolveCssSelector",
    [JSON.stringify(steps ?? selector), JSON.stringify(index)],
  );
  return resolveObjectId(session, expression, frameId, progress, steps ? "throw" : "empty");
}

async function resolveObjectId(
  session: CDPSessionLike,
  expression: string,
  frameId: string | undefined,
  progress?: Progress,
  errorHandling: "empty" | "throw" = "empty",
): Promise<string | null> {
  progress?.throwIfStopped();
  // Scope can fall back to the full tree; unresolved exclusions can be skipped.
  // Avoid repeated readiness attempts, but still honor the caller's deadline.
  const contextId = frameId
    ? (
        await executionContexts.waitForLocatorWorld(session, frameId, 800, progress, {
          readinessRetries: "none",
        })
      ).contextId
    : undefined;
  const release = (response: Protocol.Runtime.EvaluateResponse) =>
    releaseSnapshotObject(session, response.result?.objectId, progress);
  const response = await runLocatorStep(
    progress,
    "resolving snapshot focus",
    () =>
      session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression,
        returnByValue: false,
        contextId,
        awaitPromise: true,
      }),
    release,
  );
  if (response.exceptionDetails) {
    await release(response);
    progress?.throwIfStopped();
    if (errorHandling === "throw") {
      const details = response.exceptionDetails;
      throw new SelectorEvaluationError(details);
    }
    return null;
  }
  return response.result?.objectId ?? null;
}

/** Release snapshot references even after expiry, without replacing the read error. */
export async function releaseSnapshotObject(
  session: CDPSessionLike,
  objectId: string | undefined,
  progress?: Progress,
): Promise<void> {
  if (!objectId) return;
  const release = () => session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  if (progress) await progress.cleanup(release);
  else await release();
}

export function listChildrenOf(parentByFrame: FrameParentIndex, parentId: string): string[] {
  const out: string[] = [];
  for (const [fid, p] of parentByFrame.entries()) {
    if (p === parentId) out.push(fid);
  }
  return out;
}
