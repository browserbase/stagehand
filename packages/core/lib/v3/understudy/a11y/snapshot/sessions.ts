import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import type { FrameParentIndex } from "../../../types/private/snapshot.js";
import type { Protocol } from "devtools-protocol";
import { withTimeout } from "../../../timeoutConfig.js";

/**
 * Session helpers ensure DOM lookups are always executed against the session
 * that actually owns a frame. Keeping this logic centralized prevents subtle
 * bugs when OOPIF adoption changes session ownership mid-capture.
 */

/** Return the owning session for a frame as registered on the Page. */
export function ownerSession(page: Page, frameId: string): CDPSessionLike {
  return page.getSessionForFrame(frameId);
}

function findFrameDepth(
  tree: Protocol.Page.FrameTree,
  frameId: string,
  depth = 0,
): number | null {
  if (tree.frame.id === frameId) return depth;
  for (const child of tree.childFrames ?? []) {
    const childDepth = findFrameDepth(child, frameId, depth + 1);
    if (childDepth !== null) return childDepth;
  }
  return null;
}

async function sessionFrameDepth(
  session: CDPSessionLike,
  frameId: string,
): Promise<number | null> {
  const probeTimeoutMs = 500;
  try {
    await withTimeout(
      session.send("Page.enable").catch(() => {}),
      probeTimeoutMs,
      "snapshot session Page.enable",
    );
    const { frameTree } = await withTimeout(
      session.send<Protocol.Page.GetFrameTreeResponse>("Page.getFrameTree"),
      probeTimeoutMs,
      "snapshot session Page.getFrameTree",
    );
    return findFrameDepth(frameTree, frameId);
  } catch {
    return null;
  }
}

/**
 * Resolve the live owning session for a frame by probing active sessions when
 * the registry's current answer is stale. Backend node ids are only unique
 * within a CDP session, so snapshot capture must use the real owner session to
 * avoid pairing accessibility nodes with DOM nodes from the wrong process.
 */
export async function resolvedOwnerSession(
  page: Page,
  frameId: string,
): Promise<CDPSessionLike> {
  const preferred = page.getSessionForFrame(frameId);
  let bestSession = preferred;
  let bestDepth = await sessionFrameDepth(preferred, frameId);

  for (const session of page.allSessions()) {
    if (session === preferred) continue;
    const depth = await sessionFrameDepth(session, frameId);
    if (depth === null) continue;
    if (bestDepth === null || depth < bestDepth) {
      bestSession = session;
      bestDepth = depth;
    }
  }

  return bestSession;
}

/**
 * DOM.getFrameOwner must be called against the parent frame's session.
 * This helper hides the lookup (including main-frame fallback) so callers
 * always reach for the correct connection.
 */
export function parentSession(
  page: Page,
  parentByFrame: FrameParentIndex,
  frameId: string,
): CDPSessionLike {
  const parentId = parentByFrame.get(frameId) ?? null;
  if (!parentId) {
    return page.getSessionForFrame(frameId);
  }
  return page.getSessionForFrame(parentId);
}
