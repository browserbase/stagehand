import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { type Progress, runLocatorStep } from "../../progress.js";
import { Page } from "../../page.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { buildLocatorInvocation } from "../../locatorInvocation.js";
import type {
  FrameParentIndex,
  ResolvedCssFocus,
  ResolvedFocusFrame,
  Step,
} from "../../../types/private/snapshot.js";
import { prefixXPath } from "./xpathUtils.js";
import { IFRAME_STEP_RE, parseXPathToSteps, buildXPathFromSteps } from "../../selectorQuery.js";

export { IFRAME_STEP_RE, parseXPathToSteps, buildXPathFromSteps } from "../../selectorQuery.js";

export async function resolveFocusFrameAndTail(
  page: Page,
  absoluteXPath: string,
  parentByFrame: FrameParentIndex,
  rootId: string,
  progress?: Progress,
): Promise<ResolvedFocusFrame> {
  progress?.throwIfStopped();
  const stripped = absoluteXPath
    .trim()
    .replace(/^xpath=/i, "")
    .trim();
  const steps = parseXPathToSteps(stripped);
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

  let activeQuote: "'" | '"' | null = null;
  let bracketDepth = 0;

  for (const st of steps) {
    progress?.throwIfStopped();
    const startsAtTopLevel = activeQuote === null && bracketDepth === 0;
    for (let i = 0; i < st.raw.length; i++) {
      const ch = st.raw[i]!;
      if (activeQuote !== null) {
        if (ch === activeQuote) activeQuote = null;
      } else if (ch === "'" || ch === '"') {
        activeQuote = ch;
      } else if (ch === "[") {
        bracketDepth += 1;
      } else if (ch === "]" && bracketDepth > 0) {
        bracketDepth -= 1;
      }
    }
    const endsAtTopLevel = activeQuote === null && bracketDepth === 0;
    buf.push(st);
    if (startsAtTopLevel && endsAtTopLevel && IFRAME_STEP_RE.test(st.name)) {
      await flushIntoChild();
    }
  }

  progress?.throwIfStopped();
  const tailXPath = buildXPathFromSteps(buf);
  return { targetFrameId: ctxFrameId, tailXPath, absPrefix };
}

function splitCssFrameHops(rawSelector: string): string[] {
  const parts: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let inComment = false;
  let start = 0;

  for (let i = 0; i < rawSelector.length; i++) {
    const ch = rawSelector[i]!;
    if (inComment) {
      if (ch === "*" && rawSelector[i + 1] === "/") {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && rawSelector[i + 1] === "*") {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ">" && rawSelector[i + 1] === ">") {
      const segment = rawSelector.slice(start, i).trim();
      if (segment) parts.push(segment);
      i += 1;
      start = i + 1;
    }
  }

  const tail = rawSelector.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export async function resolveCssFocusFrameAndTail(
  page: Page,
  rawSelector: string,
  parentByFrame: FrameParentIndex,
  rootId: string,
  progress?: Progress,
): Promise<ResolvedCssFocus> {
  progress?.throwIfStopped();
  const parts = splitCssFrameHops(rawSelector);
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
    return null;
  }
  return response.result?.objectId ?? null;
}

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
