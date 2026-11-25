import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { getBoundingRectLite, getScrollOffsets } from "../../../dom/a11yScripts/index.js";
import type { ResolvedLocation } from "../../../types/private/snapshot.js";
import { listChildrenOf } from "./focusSelectors.js";
import { buildAbsoluteXPathFromChain } from "./xpathUtils.js";

function finiteOrZero(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export async function resolveXpathForLocation(
  page: Page,
  x: number,
  y: number,
): Promise<ResolvedLocation | null> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const tree = page.getFullFrameTree();
  const parentByFrame = new Map<string, string | null>();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    if (parentByFrame.has(n.frame.id)) return;
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(tree, null);

  const iframeChain: Array<{
    parentSession: CDPSessionLike;
    iframeBackendNodeId: number;
  }> = [];

  let curFrameId = page.mainFrameId();
  let curSession: CDPSessionLike;
  try {
    curSession = page.getSessionForFrame(curFrameId);
  } catch {
    return null;
  }
  let curX = x;
  let curY = y;

  for (let depth = 0; depth < 8; depth++) {
    try {
      await curSession.send("DOM.enable").catch(() => {});

      let sx = 0;
      let sy = 0;
      try {
        await curSession.send("Runtime.enable").catch(() => {});
        const ctxId = await executionContexts
          .waitForMainWorld(curSession, curFrameId)
          .catch(() => {});
        const scrollExpr = `(${getScrollOffsets.toString()})()`;
        const evalParams = ctxId
          ? {
              contextId: ctxId,
              expression: scrollExpr,
              returnByValue: true,
            }
          : { expression: scrollExpr, returnByValue: true };
        const { result } = await curSession.send<{
          result: { value?: { sx?: number; sy?: number } };
        }>("Runtime.evaluate", evalParams);
        sx = finiteOrZero(result?.value?.sx);
        sy = finiteOrZero(result?.value?.sy);
      } catch {}
      const rawXi = curX + sx;
      const rawYi = curY + sy;
      if (!Number.isFinite(rawXi) || !Number.isFinite(rawYi)) return null;
      const xi = Math.max(0, Math.floor(rawXi));
      const yi = Math.max(0, Math.floor(rawYi));

      let res: { backendNodeId?: number; frameId?: string } | undefined;
      try {
        res = await curSession.send<{
          backendNodeId?: number;
          frameId?: string;
        }>("DOM.getNodeForLocation", {
          x: xi,
          y: yi,
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: false,
        });
      } catch {
        return null;
      }

      const be = res?.backendNodeId;
      const reportedFrameId = res?.frameId;
      if (typeof be === "number" && reportedFrameId && reportedFrameId !== curFrameId) {
        const abs = await buildAbsoluteXPathFromChain(iframeChain, curSession, be);
        return abs ? { frameId: reportedFrameId, backendNodeId: be, absoluteXPath: abs } : null;
      }

      if (typeof be !== "number") return null;

      let matchedChild: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, curFrameId)) {
        try {
          const { backendNodeId } = await curSession.send<{
            backendNodeId?: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === be) {
            matchedChild = fid;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!matchedChild) {
        const abs = await buildAbsoluteXPathFromChain(iframeChain, curSession, be);
        return abs ? { frameId: curFrameId, backendNodeId: be, absoluteXPath: abs } : null;
      }

      iframeChain.push({
        parentSession: curSession,
        iframeBackendNodeId: be,
      });

      let left = 0;
      let top = 0;
      try {
        const { object } = await curSession.send<{
          object: { objectId?: string };
        }>("DOM.resolveNode", { backendNodeId: be });
        const objectId = object?.objectId;
        if (objectId) {
          try {
            const { result } = await curSession.send<{
              result: { value?: { left: number; top: number } };
            }>("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: getBoundingRectLite.toString(),
              returnByValue: true,
            });
            left = finiteOrZero(result?.value?.left);
            top = finiteOrZero(result?.value?.top);
          } finally {
            await curSession.send("Runtime.releaseObject", { objectId }).catch(() => {});
          }
        }
      } catch {}
      const nextX = curX - left;
      const nextY = curY - top;
      curX = Number.isFinite(nextX) ? Math.max(0, nextX) : 0;
      curY = Number.isFinite(nextY) ? Math.max(0, nextY) : 0;
      curFrameId = matchedChild;
      curSession = page.getSessionForFrame(curFrameId);
    } catch {
      return null;
    }
  }
  return null;
}
