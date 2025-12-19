import type { Protocol } from "devtools-protocol";
import { Page } from "../../page";
import { executionContexts } from "../../executionContextRegistry";
import { buildA11yInvocation } from "../../a11yInvocation";
import { a11yScriptSources } from "../../../dom/build/a11yScripts.generated";
import {
  absoluteXPathForBackendNode,
  normalizeXPath,
  prefixXPath,
} from "./xpathUtils";

/**
 * Compute the absolute XPath for the currently focused element.
 * - Detects which frame has focus via document.hasFocus().
 * - Finds the deepest activeElement (dives into shadow DOM).
 * - Builds an absolute, cross-frame XPath by prefixing iframe hosts.
 */
export async function computeActiveElementXpath(
  page: Page,
): Promise<string | null> {
  const tree = page.getFullFrameTree();
  const parentByFrame = new Map<string, string | null>();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(tree, null);

  const frames = page.listAllFrameIds();
  let focusedFrameId: string | null = null;
  for (const fid of frames) {
    const sess = page.getSessionForFrame(fid);
    try {
      await sess.send("Runtime.enable").catch(() => {});
      const ctxId = await executionContexts
        .waitForMainWorld(sess, fid, 1000)
        .catch(() => {});
      const hasFocusExpr = buildA11yInvocation("documentHasFocusStrict", []);
      const evalParams = ctxId
        ? {
            contextId: ctxId,
            expression: hasFocusExpr,
            returnByValue: true,
          }
        : { expression: hasFocusExpr, returnByValue: true };
      const { result } = await sess.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        evalParams,
      );
      if (result?.value === true) {
        focusedFrameId = fid;
        break;
      }
    } catch {
      //
    }
  }
  if (!focusedFrameId) focusedFrameId = page.mainFrameId();
  const focusedSession = page.getSessionForFrame(focusedFrameId);

  let objectId: string | undefined;
  try {
    await focusedSession.send("Runtime.enable").catch(() => {});
    const ctxId = await executionContexts
      .waitForMainWorld(focusedSession, focusedFrameId, 1000)
      .catch(() => {});
    const activeExpr = buildA11yInvocation("resolveDeepActiveElement", []);
    const evalParams = ctxId
      ? {
          contextId: ctxId,
          expression: activeExpr,
          returnByValue: false,
        }
      : { expression: activeExpr, returnByValue: false };
    const { result } =
      await focusedSession.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        evalParams,
      );
    objectId = result?.objectId as string | undefined;
  } catch {
    objectId = undefined;
  }
  if (!objectId) return null;

  const leafXPath = await (async () => {
    try {
      const { result } = await focusedSession.send<{
        result: { value?: string };
      }>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: a11yScriptSources.nodeToAbsoluteXPath,
        returnByValue: true,
      });
      try {
        await focusedSession.send("Runtime.releaseObject", { objectId });
      } catch {
        //
      }
      const xp = result?.value || "";
      return typeof xp === "string" && xp ? xp : null;
    } catch {
      try {
        await focusedSession.send("Runtime.releaseObject", { objectId });
      } catch {
        //
      }
      return null;
    }
  })();

  if (!leafXPath) return null;

  let prefix = "";
  let cur: string | null | undefined = focusedFrameId;
  while (cur) {
    const parent = parentByFrame.get(cur) ?? null;
    if (!parent) break;
    const parentSess = page.getSessionForFrame(parent);
    try {
      const { backendNodeId } = await parentSess.send<{
        backendNodeId?: number;
      }>("DOM.getFrameOwner", { frameId: cur });
      if (typeof backendNodeId === "number") {
        const xp = await absoluteXPathForBackendNode(parentSess, backendNodeId);
        if (xp) prefix = prefix ? prefixXPath(prefix, xp) : normalizeXPath(xp);
      }
    } catch {
      //
    }
    cur = parent;
  }

  return prefix ? prefixXPath(prefix, leafXPath) : normalizeXPath(leafXPath);
}
