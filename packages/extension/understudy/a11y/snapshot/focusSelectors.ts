import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { type Progress, runLocatorStep } from "../../progress.js";
import { Page } from "../../page.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { buildLocatorInvocation } from "../../locatorInvocation.js";
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
  progress?: Progress,
): Promise<ResolvedFocusFrame> {
  progress?.throwIfStopped();
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
      0,
      progress,
    );
    if (!objectId) {
      throw iframeResolutionError(selectorForIframe, "Failed to resolve iframe element by XPath");
    }

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
        throw iframeResolutionError(selectorForIframe, "Could not map iframe to child frameId");
      }

      absPrefix = prefixXPath(absPrefix || "/", selectorForIframe);
      ctxFrameId = childFrameId;
    } finally {
      await releaseSnapshotObject(parentSess, objectId, progress);
    }

    buf = [];
  };

  for (const st of steps) {
    progress?.throwIfStopped();
    buf.push(st);
    if (IFRAME_STEP_RE.test(st.name)) {
      await flushIntoChild();
    }
  }

  progress?.throwIfStopped();
  const tailXPath = buildXPathFromSteps(buf);
  return { targetFrameId: ctxFrameId, tailXPath, absPrefix };
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
  const parts = rawSelector
    .split(">>")
    .map((s) => s.trim())
    .filter(Boolean);
  let ctxFrameId = rootId;
  const absPrefix = "";

  for (let i = 0; i < Math.max(0, parts.length - 1); i++) {
    const parentSess = page.getSessionForFrame(ctxFrameId);
    const objectId = await resolveObjectIdForCss(parentSess, parts[i]!, ctxFrameId, 0, progress);
    if (!objectId) {
      throw iframeResolutionError(parts[i]!, "Failed to resolve iframe via CSS hop");
    }
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
        throw iframeResolutionError(parts[i]!, "Could not map CSS iframe hop to child frameId");
      }
      ctxFrameId = childFrameId;
    } finally {
      await releaseSnapshotObject(parentSess, objectId, progress);
    }
  }

  progress?.throwIfStopped();
  const tailSelector = parts[parts.length - 1] ?? "*";
  return { targetFrameId: ctxFrameId, tailSelector, absPrefix };
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

/** Resolve a CSS selector (supports '>>' within the same frame only) to a Runtime objectId. */
export async function resolveObjectIdForCss(
  session: CDPSessionLike,
  selector: string,
  frameId?: string,
  index = 0,
  progress?: Progress,
): Promise<string | null> {
  const expression = buildLocatorInvocation("resolveCssSelector", [
    JSON.stringify(selector),
    JSON.stringify(index),
  ]);
  return resolveObjectId(session, expression, frameId, progress);
}

async function resolveObjectId(
  session: CDPSessionLike,
  expression: string,
  frameId: string | undefined,
  progress?: Progress,
): Promise<string | null> {
  progress?.throwIfStopped();
  const contextId = frameId
    ? (await executionContexts.waitForLocatorWorld(session, frameId, 800, progress)).contextId
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
