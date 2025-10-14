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
  private readonly ownerTargetId: string;

  /** Current main/root frame id (changes on root swaps) */
  private rootFrameId: FrameId;

  /** frameId → FrameInfo */
  private frames = new Map<FrameId, FrameInfo>();

  /** sessionId → Set<frameId> (inverse map for diagnostics/fast membership checks) */
  private framesBySession = new Map<SessionId, Set<FrameId>>();

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
   * IMPORTANT: The emitter's `sessionId` is the **owner** for the new/attached frame.
   */
  onFrameAttached(
    frameId: FrameId,
    parentId: FrameId | null,
    sessionId: SessionId,
  ): void {
    // Root swap (parentId === null for main frames).
    if (!parentId && frameId !== this.rootFrameId) {
      this.renameNodeId(this.rootFrameId, frameId);
      this.rootFrameId = frameId;
      // ownership moves to this session as well
      this.setOwnerSessionIdInternal(frameId, sessionId);
      return;
    }

    // Normal attach
    this.ensureNode(frameId);
    if (parentId) this.ensureNode(parentId);

    const info = this.frames.get(frameId)!;
    info.parentId = parentId ?? null;

    if (parentId) {
      this.frames.get(parentId)!.children.add(frameId);
    }

    // Ownership: the session that emitted frameAttached owns this frame.
    this.setOwnerSessionIdInternal(frameId, sessionId);
  }

  /**
   * Record a navigation with the full CDP `Frame`. Also updates ownership based on the emitting
   * session id. Handles root swap if the navigated frame is the new main (no parentId).
   */
  onFrameNavigated(frame: Protocol.Page.Frame, sessionId: SessionId): void {
    this.ensureNode(frame.id);
    const info = this.frames.get(frame.id)!;
    info.lastSeen = frame;

    // Ownership follows the session that reported the navigation
    this.setOwnerSessionIdInternal(frame.id, sessionId);

    // If this frame has no parent, it might be the (new) main/root
    if (!("parentId" in frame) || !frame.parentId) {
      if (frame.id !== this.rootFrameId) {
        // carry ordinal semantics by renaming the root id
        this.renameNodeId(this.rootFrameId, frame.id);
        this.rootFrameId = frame.id;
      }
    }
  }

  onNavigatedWithinDocument(
    frameId: FrameId,
    url: string,
    sessionId: SessionId,
  ): void {
    this.ensureNode(frameId);
    const info = this.frames.get(frameId)!;
    const lastSeen = info.lastSeen ?? shellFrame(frameId);
    info.lastSeen = { ...lastSeen, url };
    this.setOwnerSessionIdInternal(frameId, sessionId);
  }

  /**
   * Record that a frame detached. If `reason !== "swap"`, remove the subtree from the graph,
   * and clean the inverse maps. For “swap” we keep the node to preserve continuity.
   */
  onFrameDetached(
    frameId: FrameId,
    reason: "remove" | "swap" | string = "remove",
  ): void {
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
        if (bag && bag.size === 0)
          this.framesBySession.delete(info.ownerSessionId);
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
  adoptChildSession(
    childSessionId: SessionId,
    childMainFrameId: FrameId,
  ): void {
    // The child session will emit its own navigations/attachments; as a seed,
    // mark the root frame as owned by the child session.
    this.setOwnerSessionIdInternal(childMainFrameId, childSessionId);
  }

  /**
   * Seed topology and ownership from an existing `Page.getFrameTree` snapshot, typically right after
   * a session is attached. This is a best-effort: we record frames and set the provided `sessionId`
   * as owner for the subtree **if** an owner isn't already set.
   */
  seedFromFrameTree(
    sessionId: SessionId,
    frameTree: Protocol.Page.FrameTree,
  ): void {
    const walk = (tree: Protocol.Page.FrameTree, parent: FrameId | null) => {
      this.ensureNode(tree.frame.id);
      // topology
      this.frames.get(tree.frame.id)!.parentId = parent;
      if (parent) this.frames.get(parent)!.children.add(tree.frame.id);
      // last-seen frame
      this.frames.get(tree.frame.id)!.lastSeen = tree.frame;
      // ownership (only if unknown)
      if (!this.frames.get(tree.frame.id)!.ownerSessionId) {
        this.setOwnerSessionIdInternal(tree.frame.id, sessionId);
      }
      for (const c of tree.childFrames ?? []) walk(c, tree.frame.id);
    };
    walk(frameTree, null);
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
      const childFrames = kids.size
        ? [...kids].map((k) => build(k))
        : undefined;

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

  private ensureNode(fid: FrameId): void {
    if (this.frames.has(fid)) return;
    this.frames.set(fid, {
      parentId: null,
      children: new Set<FrameId>(),
      lastSeen: shellFrame(fid),
      ownerSessionId: undefined,
      ownerBackendNodeId: undefined,
    });
  }

  private renameNodeId(oldId: FrameId, newId: FrameId): void {
    if (oldId === newId) return;
    this.ensureNode(oldId);

    const info = this.frames.get(oldId)!;

    // Move info under new id
    this.frames.delete(oldId);
    this.frames.set(newId, { ...info });

    // Fix parent’s children set
    if (info.parentId) {
      const p = this.frames.get(info.parentId);
      if (p) {
        p.children.delete(oldId);
        p.children.add(newId);
      }
    }

    // Fix children’s parent pointers
    for (const c of info.children) {
      const ci = this.frames.get(c);
      if (ci) ci.parentId = newId;
    }

    // Fix inverse map (session -> frames)
    if (info.ownerSessionId) {
      const bag = this.framesBySession.get(info.ownerSessionId);
      if (bag) {
        bag.delete(oldId);
        bag.add(newId);
      }
    }

    // If root moved, keep the root id updated is handled by caller
  }

  private setOwnerSessionIdInternal(
    frameId: FrameId,
    sessionId: SessionId,
  ): void {
    this.ensureNode(frameId);
    const info = this.frames.get(frameId)!;

    // If the owner is unchanged, do nothing
    if (info.ownerSessionId === sessionId) return;

    // Remove from previous owner bag
    if (info.ownerSessionId) {
      const prev = this.framesBySession.get(info.ownerSessionId);
      prev?.delete(frameId);
      if (prev && prev.size === 0)
        this.framesBySession.delete(info.ownerSessionId);
    }

    // Set new owner and update bag
    info.ownerSessionId = sessionId;
    const bag = this.framesBySession.get(sessionId) ?? new Set<FrameId>();
    bag.add(frameId);
    this.framesBySession.set(sessionId, bag);
  }
}
