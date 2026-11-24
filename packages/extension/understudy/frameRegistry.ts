// lib/v3/understudy/frameRegistry.ts
import type { Protocol } from "devtools-protocol";

/**
 * FrameRegistry
 *
 * Purpose:
 * A single, authoritative source of truth for **both**:
 *   1) Frame topology (parent/children, current main/root id, last-seen CDP `Frame`)
 *   2) Frame → Session ownership (which CDP session owns a given frameId)
 *   3) Optional iframe-owner metadata (backendNodeId of the <iframe> element in the parent doc)
 *
 *
 * Model:
 *  - This class is **CDP-agnostic**; it stores **sessionId strings** (not session objects).
 *  - Context bridges (wiring Target/Page events) must call the mutators below (onAttached,
 *    onNavigated, onDetached, adoptChildSession, seedFromFrameTree, setOwnerBackendNodeId).
 *  - Consumers ask read APIs (getOwnerSessionId, getParent, asProtocolFrameTree, listAll, …)
 *    and never probe ownership at run time.
 */

type FrameId = string;
type SessionId = string;

type PendingNavigation = {
  frame: Protocol.Page.Frame;
  parentId: FrameId;
  sessionId: SessionId;
};

const MAX_PENDING_NAVIGATIONS = 128;

type FrameInfo = {
  /** Parent frame id, or null for root */
  parentId: FrameId | null;
  /** Children frame ids (direct) */
  children: Set<FrameId>;
  /** Last-seen CDP Frame metadata for this id (may be a shell if never seen) */
  lastSeen?: Protocol.Page.Frame;

  /** Owning session id (CDP child session for OOPIF, top-level session for same-process) */
  ownerSessionId?: SessionId;

  /**
   * The backendNodeId of the <iframe> element **in the parent document** that hosts this frame.
   * Useful for building absolute XPath prefixes or DOM scoping in the parent session.
   */
  ownerBackendNodeId?: number;
};

/** Minimal “shell” CDP frame used when we haven’t yet seen a real Frame from events. */
function shellFrame(id: FrameId): Protocol.Page.Frame {
  return {
    id,
    loaderId: "",
    url: "",
    domainAndRegistry: "",
    securityOrigin: "",
    mimeType: "text/html",
    secureContextType: "InsecureScheme",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  } as Protocol.Page.Frame;
}

export class FrameRegistry {
  /** Owner target id (top-level target); informational only */
  readonly ownerTargetId: string;

  /** Current main/root frame id (changes on root swaps) */
  rootFrameId: FrameId;

  /** frameId → FrameInfo */
  frames = new Map<FrameId, FrameInfo>();

  /** sessionId → Set<frameId> (inverse map for diagnostics/fast membership checks) */
  framesBySession = new Map<SessionId, Set<FrameId>>();

  private pendingNavigatedByFrame = new Map<FrameId, PendingNavigation>();
  private pendingNavigatedByParent = new Map<FrameId, Set<FrameId>>();

  constructor(ownerTargetId: string, mainFrameId: FrameId) {
    this.ownerTargetId = ownerTargetId;
    this.rootFrameId = mainFrameId;
    this.ensureNode(mainFrameId);
  }

  // ---------------------- Mutators (called by Context/Page bridges) ----------------------

  /**
   * Record that a frame attached. If `parentId` is null and `frameId` differs from the current
   * root, this is a root swap and we rename the root id.
   *
   * The provided `sessionId` is the selected **owner** for the new/attached frame.
   */
  onFrameAttached(frameId: FrameId, parentId: FrameId | null, sessionId: SessionId): void {
    if (!parentId && frameId !== this.rootFrameId) {
      this.renameNodeId(this.rootFrameId, frameId);
      this.rootFrameId = frameId;
      this.deletePendingNavigation(frameId);
      this.setOwnerSessionIdInternal(frameId, sessionId);
      this.replayPendingNavigations(frameId);
      return;
    }

    this.ensureNode(frameId);
    if (parentId) this.ensureNode(parentId);
    this.deletePendingNavigation(frameId);
    if (parentId) this.deletePendingNavigation(parentId);

    const info = this.frames.get(frameId)!;
    const nextParent = parentId ?? null;
    if (
      nextParent &&
      (frameId === this.rootFrameId || this.isDescendantOrSelf(nextParent, frameId))
    ) {
      this.setOwnerSessionIdInternal(frameId, sessionId);
      this.replayPendingNavigations(nextParent);
      this.replayPendingNavigations(frameId);
      return;
    }

    if (info.parentId && info.parentId !== nextParent) {
      this.frames.get(info.parentId)?.children.delete(frameId);
    }
    info.parentId = nextParent;

    if (nextParent) {
      this.frames.get(nextParent)!.children.add(frameId);
    }

    this.setOwnerSessionIdInternal(frameId, sessionId);
    if (nextParent) this.replayPendingNavigations(nextParent);
    this.replayPendingNavigations(frameId);
  }

  /**
   * Record a navigation with the full CDP `Frame`. Also updates ownership based on the emitting
   * session id. Handles root swap if the navigated frame is the new main (no parentId).
   */
  onFrameNavigated(frame: Protocol.Page.Frame, sessionId: SessionId): void {
    const parentId = frame.parentId || null;

    if (!parentId) {
      if (frame.id !== this.rootFrameId) {
        this.renameNodeId(this.rootFrameId, frame.id);
        this.rootFrameId = frame.id;
      }
      this.ensureNode(frame.id);
      this.deletePendingNavigation(frame.id);
      const info = this.frames.get(frame.id)!;
      info.lastSeen = frame;
      this.setOwnerSessionIdInternal(frame.id, sessionId);
      this.replayPendingNavigations(frame.id);
      return;
    }

    if (!this.frames.has(parentId)) {
      const existing = this.frames.get(frame.id);
      if (!existing) {
        this.bufferPendingNavigation(frame, parentId, sessionId);
        return;
      }
      existing.lastSeen = frame;
      this.setOwnerSessionIdInternal(frame.id, sessionId);
      return;
    }

    this.deletePendingNavigation(frame.id);
    this.attachNavigatedChild(frame, parentId, sessionId);
    this.replayPendingNavigations(frame.id);
  }

  onNavigatedWithinDocument(frameId: FrameId, url: string, sessionId: SessionId): void {
    this.ensureNode(frameId);
    this.deletePendingNavigation(frameId);
    const info = this.frames.get(frameId)!;
    const lastSeen = info.lastSeen ?? shellFrame(frameId);
    info.lastSeen = { ...lastSeen, url };
    this.setOwnerSessionIdInternal(frameId, sessionId);
    this.replayPendingNavigations(frameId);
  }

  /**
   * Record that a frame detached. If `reason !== "swap"`, remove the subtree from the graph,
   * and clean the inverse maps. For “swap” we keep the node to preserve continuity.
   */
  onFrameDetached(frameId: FrameId, reason: string = "remove"): void {
    if (reason === "swap") return;

    // Collect subtree starting from frameId.
    const toRemove: FrameId[] = [];
    const collect = (fid: FrameId) => {
      toRemove.push(fid);
      const kids = this.frames.get(fid)?.children ?? new Set<FrameId>();
      for (const k of kids) collect(k);
    };
    collect(frameId);

    // Remove nodes, fix parents and inverse maps
    for (const fid of toRemove) {
      this.deletePendingSubtree(fid);
      const info = this.frames.get(fid);
      if (!info) continue;

      // unlink from parent
      if (info.parentId) {
        const p = this.frames.get(info.parentId);
        p?.children.delete(fid);
      }

      // unlink inverse session map
      if (info.ownerSessionId) {
        const bag = this.framesBySession.get(info.ownerSessionId);
        bag?.delete(fid);
        if (bag && bag.size === 0) this.framesBySession.delete(info.ownerSessionId);
      }

      this.frames.delete(fid);
    }

    // Guard root if we removed it; assign a placeholder root if needed
    if (!this.frames.has(this.rootFrameId)) {
      // Choose an arbitrary remaining node as root
      const iter = this.frames.keys().next();
      if (!iter.done) this.rootFrameId = iter.value;
    }
  }

  /**
   * An adopted OOPIF child session was created whose **main** frame id equals the parent iframe’s frameId.
   * We mark the entire child subtree as owned by `childSessionId`.
   * (Topology edges remain aligned by the parent session’s `frameAttached` events.)
   */
  adoptChildSession(childSessionId: SessionId, childMainFrameId: FrameId): void {
    // The child session will emit its own navigations/attachments; as a seed,
    // mark the root frame as owned by the child session.
    this.setOwnerSessionIdInternal(childMainFrameId, childSessionId);
  }

  /**
   * Seed topology and ownership from an existing `Page.getFrameTree` snapshot, typically right after
   * a session is attached. This is a best-effort: we record frames and set the provided `sessionId`
   * as owner for the subtree **if** an owner isn't already set.
   */
  seedFromFrameTree(sessionId: SessionId, frameTree: Protocol.Page.FrameTree): void {
    const seededIds: FrameId[] = [];
    const walk = (tree: Protocol.Page.FrameTree, parent: FrameId | null) => {
      this.ensureNode(tree.frame.id);
      this.deletePendingNavigation(tree.frame.id);
      seededIds.push(tree.frame.id);
      const info = this.frames.get(tree.frame.id)!;
      const previousParent = info.parentId;
      const nextParent = parent ?? tree.frame.parentId ?? previousParent ?? null;

      // topology
      if (previousParent && previousParent !== nextParent) {
        this.frames.get(previousParent)?.children.delete(tree.frame.id);
      }
      info.parentId = nextParent;
      if (nextParent) {
        this.ensureNode(nextParent);
        this.deletePendingNavigation(nextParent);
        seededIds.push(nextParent);
        this.frames.get(nextParent)!.children.add(tree.frame.id);
      }
      // last-seen frame
      info.lastSeen =
        nextParent && !tree.frame.parentId ? { ...tree.frame, parentId: nextParent } : tree.frame;
      // ownership (only if unknown)
      if (!info.ownerSessionId) {
        this.setOwnerSessionIdInternal(tree.frame.id, sessionId);
      }
      for (const c of tree.childFrames ?? []) walk(c, tree.frame.id);
    };
    walk(frameTree, null);
    for (const fid of seededIds) {
      this.replayPendingNavigations(fid);
    }
  }

  /**
   * Set the backendNodeId of the `<iframe>` element for a child frame **as seen from its parent**.
   * This is useful for building absolute XPath prefixes later (from the parent document).
   */
  setOwnerBackendNodeId(childFrameId: FrameId, backendNodeId: number): void {
    this.ensureNode(childFrameId);
    this.frames.get(childFrameId)!.ownerBackendNodeId = backendNodeId;
  }

  // ---------------------- Readers (consumed by Page/snapshot/locators) ----------------------

  mainFrameId(): FrameId {
    return this.rootFrameId;
  }

  /**
   * Return the owner session id for this frame. If unknown, returns `undefined`.
   */
  getOwnerSessionId(frameId: FrameId): SessionId | undefined {
    return this.frames.get(frameId)?.ownerSessionId;
  }

  /**
   * Return the owner backendNodeId (iframe element) if recorded.
   * This is in the **parent** document; pair it with `getParent`.
   */
  getOwnerBackendNodeId(frameId: FrameId): number | undefined {
    return this.frames.get(frameId)?.ownerBackendNodeId;
  }

  /**
   * Return the parent frame id, or null for root/unknown.
   */
  getParent(frameId: FrameId): FrameId | null {
    return this.frames.get(frameId)?.parentId ?? null;
  }

  /**
   * List frame ids in root-first DFS order (same shape as CDP’s FrameTree traversal).
   */
  listAllFrames(): FrameId[] {
    const out: FrameId[] = [];
    const dfs = (fid: FrameId) => {
      out.push(fid);
      const kids = this.frames.get(fid)?.children ?? new Set<FrameId>();
      for (const k of kids) dfs(k);
    };
    if (this.frames.has(this.rootFrameId)) dfs(this.rootFrameId);
    return out;
  }

  /**
   * Serialize to `Protocol.Page.FrameTree` starting at the given root id (typically mainFrameId()).
   */
  asProtocolFrameTree(rootId: FrameId): Protocol.Page.FrameTree {
    const build = (fid: FrameId): Protocol.Page.FrameTree => {
      const info = this.frames.get(fid);
      const frame = info?.lastSeen ?? shellFrame(fid);

      const kids = info?.children ?? new Set<FrameId>();
      const childFrames = kids.size ? [...kids].map((k) => build(k)) : undefined;

      return childFrames ? { frame, childFrames } : { frame };
    };

    return build(rootId);
  }

  /**
   * For diagnostics: return the current owner sessions for a frame id (0..n),
   * usually 0 or 1, but helpful to see potential inconsistencies during wiring.
   */
  sessionsForFrame(frameId: FrameId): SessionId[] {
    const info = this.frames.get(frameId);
    return info?.ownerSessionId ? [info.ownerSessionId] : [];
  }

  /**
   * For diagnostics: return current frame set per session.
   */
  framesForSession(sessionId: SessionId): FrameId[] {
    return [...(this.framesBySession.get(sessionId) ?? new Set())];
  }

  // ---------------------- Internal helpers ----------------------

  ensureNode(fid: FrameId): void {
    if (this.frames.has(fid)) return;
    this.frames.set(fid, {
      parentId: null,
      children: new Set<FrameId>(),
      lastSeen: shellFrame(fid),
      ownerSessionId: undefined,
      ownerBackendNodeId: undefined,
    });
  }

  private isDescendantOrSelf(candidateId: FrameId, ancestorId: FrameId): boolean {
    let current: FrameId | null = candidateId;
    const seen = new Set<FrameId>();
    while (current !== null && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = this.frames.get(current)?.parentId ?? null;
    }
    return false;
  }

  private attachNavigatedChild(
    frame: Protocol.Page.Frame,
    parentId: FrameId,
    sessionId: SessionId,
  ): void {
    this.ensureNode(frame.id);
    const info = this.frames.get(frame.id)!;
    if (frame.id !== this.rootFrameId && !this.isDescendantOrSelf(parentId, frame.id)) {
      if (info.parentId && info.parentId !== parentId) {
        this.frames.get(info.parentId)?.children.delete(frame.id);
      }
      info.parentId = parentId;
      this.frames.get(parentId)!.children.add(frame.id);
    }
    info.lastSeen = frame;
    this.setOwnerSessionIdInternal(frame.id, sessionId);
  }

  private bufferPendingNavigation(
    frame: Protocol.Page.Frame,
    parentId: FrameId,
    sessionId: SessionId,
  ): void {
    if (frame.id === parentId) return;
    this.deletePendingNavigation(frame.id);
    while (this.pendingNavigatedByFrame.size >= MAX_PENDING_NAVIGATIONS) {
      const oldest = this.pendingNavigatedByFrame.keys().next().value;
      if (oldest === undefined) break;
      this.deletePendingNavigation(oldest);
    }
    this.pendingNavigatedByFrame.set(frame.id, { frame, parentId, sessionId });
    let waiting = this.pendingNavigatedByParent.get(parentId);
    if (!waiting) {
      waiting = new Set<FrameId>();
      this.pendingNavigatedByParent.set(parentId, waiting);
    }
    waiting.add(frame.id);
  }

  private deletePendingNavigation(frameId: FrameId): void {
    const entry = this.pendingNavigatedByFrame.get(frameId);
    if (!entry) return;
    this.pendingNavigatedByFrame.delete(frameId);
    const waiting = this.pendingNavigatedByParent.get(entry.parentId);
    if (!waiting) return;
    waiting.delete(frameId);
    if (waiting.size === 0) {
      this.pendingNavigatedByParent.delete(entry.parentId);
    }
  }

  private deletePendingSubtree(rootId: FrameId): void {
    const queue: FrameId[] = [rootId];
    const seen = new Set<FrameId>();
    while (queue.length > 0) {
      const fid = queue.shift()!;
      if (seen.has(fid)) continue;
      seen.add(fid);
      this.deletePendingNavigation(fid);
      const waiting = this.pendingNavigatedByParent.get(fid);
      if (!waiting) continue;
      this.pendingNavigatedByParent.delete(fid);
      for (const childId of waiting) {
        if (this.pendingNavigatedByFrame.get(childId)?.parentId === fid) {
          this.pendingNavigatedByFrame.delete(childId);
        }
        queue.push(childId);
      }
    }
  }

  private replayPendingNavigations(rootParentId: FrameId): void {
    const queue: FrameId[] = [rootParentId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      if (!this.frames.has(parentId)) continue;
      const waiting = this.pendingNavigatedByParent.get(parentId);
      if (!waiting) continue;

      const childIds = [...waiting];
      this.pendingNavigatedByParent.delete(parentId);

      for (const childId of childIds) {
        const pending = this.pendingNavigatedByFrame.get(childId);
        if (!pending || pending.parentId !== parentId) continue;
        this.pendingNavigatedByFrame.delete(childId);
        this.attachNavigatedChild(pending.frame, parentId, pending.sessionId);
        if (this.pendingNavigatedByParent.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  renameNodeId(oldId: FrameId, newId: FrameId): void {
    if (oldId === newId) return;
    this.ensureNode(oldId);

    const info = this.frames.get(oldId)!;
    const existingTarget = this.frames.get(newId);

    if (existingTarget) {
      if (existingTarget.parentId) {
        this.frames.get(existingTarget.parentId)?.children.delete(newId);
      }
      if (existingTarget.ownerSessionId) {
        const existingBag = this.framesBySession.get(existingTarget.ownerSessionId);
        existingBag?.delete(newId);
        if (existingBag && existingBag.size === 0) {
          this.framesBySession.delete(existingTarget.ownerSessionId);
        }
      }
    }

    const nextParentId =
      info.parentId === newId ? (existingTarget?.parentId ?? null) : info.parentId;
    const movedChildren = new Set<FrameId>();
    for (const childId of info.children) {
      if (childId !== oldId && childId !== newId) {
        movedChildren.add(childId);
      }
    }
    if (existingTarget) {
      for (const childId of existingTarget.children) {
        if (childId !== oldId && childId !== newId) {
          movedChildren.add(childId);
        }
      }
    }

    this.frames.delete(oldId);
    this.frames.set(newId, {
      ...info,
      parentId: nextParentId,
      children: movedChildren,
    });

    if (nextParentId) {
      const p = this.frames.get(nextParentId);
      if (p) {
        p.children.delete(oldId);
        p.children.add(newId);
      }
    }

    for (const c of movedChildren) {
      const ci = this.frames.get(c);
      if (ci) ci.parentId = newId;
    }

    if (info.ownerSessionId) {
      const bag = this.framesBySession.get(info.ownerSessionId);
      if (bag) {
        bag.delete(oldId);
        bag.add(newId);
      }
    }
  }

  setOwnerSessionIdInternal(frameId: FrameId, sessionId: SessionId): void {
    this.ensureNode(frameId);
    const info = this.frames.get(frameId)!;

    // If the owner is unchanged, do nothing
    if (info.ownerSessionId === sessionId) return;

    // Remove from previous owner bag
    if (info.ownerSessionId) {
      const prev = this.framesBySession.get(info.ownerSessionId);
      prev?.delete(frameId);
      if (prev && prev.size === 0) this.framesBySession.delete(info.ownerSessionId);
    }

    // Set new owner and update bag
    info.ownerSessionId = sessionId;
    const bag = this.framesBySession.get(sessionId) ?? new Set<FrameId>();
    bag.add(frameId);
    this.framesBySession.set(sessionId, bag);
  }
}
