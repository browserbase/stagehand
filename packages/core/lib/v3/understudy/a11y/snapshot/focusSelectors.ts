import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { buildLocatorInvocation } from "../../locatorInvocation.js";
import { StagehandIframeError } from "../../../types/public/sdkErrors.js";
import type {
  Axis,
  FrameParentIndex,
  ResolvedCssFocus,
  ResolvedFocusFrame,
  Step,
} from "../../../types/private/snapshot.js";
import { prefixXPath } from "./xpathUtils.js";

/**
 * Parse a cross-frame XPath into discrete steps. Each step tracks whether it
 * represents a descendant hop (“//”) or a single-child hop (“/”).
 */
export function parseXPathToSteps(path: string): Step[] {
  const s = path.trim();
  let i = 0;
  const steps: Step[] = [];
  while (i < s.length) {
    let axis: Axis = "child";
    if (s.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (s[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    while (i < s.length && s[i] !== "/") i++;
    const raw = s.slice(start, i).trim();
    if (!raw) continue;
    const name = raw.replace(/\[\d+\]\s*$/u, "").toLowerCase();
    steps.push({ axis, raw, name });
  }
  return steps;
}

/** Rebuild an XPath string from parsed steps. */
export function buildXPathFromSteps(steps: ReadonlyArray<Step>): string {
  let out = "";
  for (const st of steps) {
    out += st.axis === "desc" ? "//" : "/";
    out += st.raw;
  }
  return out || "/";
}

export const IFRAME_STEP_RE = /^i?frame(?:\[\d+])?$/i;

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
): Promise<ResolvedFocusFrame> {
  const steps = parseXPathToSteps(absoluteXPath);
  let ctxFrameId = rootId;
  let buf: Step[] = [];
  let absPrefix = "";

  const flushIntoChild = async (): Promise<void> => {
    if (!buf.length) return;
    const selectorForIframe = buildXPathFromSteps(buf);
    const parentSess = page.getSessionForFrame(ctxFrameId);
    const objectId = await resolveObjectIdForXPath(
      parentSess,
      selectorForIframe,
      ctxFrameId,
    );
    if (!objectId)
      throw new StagehandIframeError(
        selectorForIframe,
        "Failed to resolve iframe element by XPath",
      );

    try {
      await parentSess.send("DOM.enable").catch(() => {});
      const desc = await parentSess.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;

      let childFrameId: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, ctxFrameId)) {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!childFrameId)
        throw new StagehandIframeError(
          selectorForIframe,
          "Could not map iframe to child frameId",
        );

      absPrefix = prefixXPath(absPrefix || "/", selectorForIframe);
      ctxFrameId = childFrameId;
    } finally {
      await parentSess
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }

    buf = [];
  };

  for (const st of steps) {
    buf.push(st);
    if (IFRAME_STEP_RE.test(st.name)) {
      await flushIntoChild();
    }
  }

  const tailXPath = buildXPathFromSteps(buf);
  return { targetFrameId: ctxFrameId, tailXPath, absPrefix };
}

/** Resolve focus frame and tail CSS selector using '>>' to hop iframes. */
export async function resolveCssFocusFrameAndTail(
  page: Page,
  rawSelector: string,
  parentByFrame: FrameParentIndex,
  rootId: string,
): Promise<ResolvedCssFocus> {
  const parts = rawSelector
    .split(">>")
    .map((s) => s.trim())
    .filter(Boolean);
  let ctxFrameId = rootId;
  const absPrefix = "";

  for (let i = 0; i < Math.max(0, parts.length - 1); i++) {
    const parentSess = page.getSessionForFrame(ctxFrameId);
    const objectId = await resolveObjectIdForCss(
      parentSess,
      parts[i]!,
      ctxFrameId,
    );
    if (!objectId)
      throw new StagehandIframeError(
        parts[i]!,
        "Failed to resolve iframe via CSS hop",
      );
    try {
      await parentSess.send("DOM.enable").catch(() => {});
      const desc = await parentSess.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;
      let childFrameId: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, ctxFrameId)) {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!childFrameId)
        throw new StagehandIframeError(
          parts[i]!,
          "Could not map CSS iframe hop to child frameId",
        );
      ctxFrameId = childFrameId;
    } finally {
      await parentSess
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  const tailSelector = parts[parts.length - 1] ?? "*";
  return { targetFrameId: ctxFrameId, tailSelector, absPrefix };
}

/** Resolve an XPath to a Runtime remoteObjectId in the given CDP session. */
export async function resolveObjectIdForXPath(
  session: CDPSessionLike,
  xpath: string,
  frameId?: string,
): Promise<string | null> {
  let contextId: number | undefined;
  try {
    if (frameId) {
      contextId = await executionContexts
        .waitForMainWorld(session, frameId, 800)
        .catch(
          () => executionContexts.getMainWorld(session, frameId) ?? undefined,
        );
    }
  } catch {
    contextId = undefined;
  }
  const expr = buildLocatorInvocation("resolveXPathMainWorld", [
    JSON.stringify(xpath),
    "0",
  ]);
  const { result, exceptionDetails } = await session.send<{
    result: { objectId?: string | undefined };
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
  }>("Runtime.evaluate", {
    expression: expr,
    returnByValue: false,
    contextId,
    awaitPromise: true,
  });
  if (exceptionDetails) return null;
  return result?.objectId ?? null;
}

/** Resolve a CSS selector (supports '>>' within the same frame only) to a Runtime objectId. */
export async function resolveObjectIdForCss(
  session: CDPSessionLike,
  selector: string,
  frameId?: string,
): Promise<string | null> {
  let contextId: number | undefined;
  try {
    if (frameId) {
      contextId = await executionContexts
        .waitForMainWorld(session, frameId, 800)
        .catch(
          () => executionContexts.getMainWorld(session, frameId) ?? undefined,
        );
    }
  } catch {
    contextId = undefined;
  }
  const primaryExpr = buildLocatorInvocation("resolveCssSelector", [
    JSON.stringify(selector),
    "0",
  ]);
  const fallbackExpr = buildLocatorInvocation("resolveCssSelectorPierce", [
    JSON.stringify(selector),
    "0",
  ]);

  const evaluate = async (expression: string): Promise<string | null> => {
    const { result, exceptionDetails } = await session.send<{
      result: { objectId?: string | undefined };
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: false,
      contextId,
      awaitPromise: true,
    });
    if (exceptionDetails) return null;
    return result?.objectId ?? null;
  };

  const primary = await evaluate(primaryExpr);
  if (primary) return primary;
  return evaluate(fallbackExpr);
}

export function listChildrenOf(
  parentByFrame: FrameParentIndex,
  parentId: string,
): string[] {
  const out: string[] = [];
  for (const [fid, p] of parentByFrame.entries()) {
    if (p === parentId) out.push(fid);
  }
  return out;
}
