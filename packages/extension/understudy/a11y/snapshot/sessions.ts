import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import type { FrameParentIndex } from "../../../types/private/snapshot.js";

/**
 * Session helpers ensure DOM lookups are always executed against the session
 * that actually owns a frame. Keeping this logic centralized prevents subtle
 * bugs when OOPIF adoption changes session ownership mid-capture.
 */

/** Return the owning session for a frame as registered on the Page. */
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
