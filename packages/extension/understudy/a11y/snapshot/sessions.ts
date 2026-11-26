import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import type { FrameParentIndex } from "../../../types/private/snapshot.js";

export function ownerSession(page: Page, frameId: string): CDPSessionLike {
  return page.getSessionForFrame(frameId);
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
