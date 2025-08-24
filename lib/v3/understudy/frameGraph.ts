import { Protocol } from "devtools-protocol";

/**
 * FrameGraph
 *
 * Purpose:
 * A pure, in-memory representation of a page’s frame topology and metadata.
 * It aggregates frame events coming from the page’s main CDP session and
 * any adopted OOPIF child sessions, while remaining completely CDP-agnostic.
 *
 * What it does:
 * - Tracks the parent/children relationships between frames.
 * - Stores the last-seen full `Protocol.Page.Frame` object per frameId.
 * - Handles cross-process main-frame handoffs by renaming the root id.
 * - Serializes the current state into `Protocol.Page.FrameTree`.
 *
 * What it does NOT do:
 * - It does not talk to CDP or own timers.
 * - It does not decide when frames attach/detach—callers must feed events.
 */
export class FrameGraph {
  /** frameId -> parentId (null for root) */
  private parents = new Map<string, string | null>();
  /** parentId -> children set */
  private children = new Map<string, Set<string>>();
  /** frameId -> last-seen full CDP frame */
  private frames = new Map<string, Protocol.Page.Frame>();

  /**
   * Create a new frame graph with a known root frame id.
   * @param ownerTargetId Top-level target id (informational; not used for logic).
   * @param rootFrameId Current main frame id for this page.
   */
  constructor(
    private readonly ownerTargetId: string,
    private rootFrameId: string,
  ) {
    this.ensureNode(rootFrameId);
  }

  /**
   * Get the current main-frame id for this page (after any renames/swaps).
   */
  mainFrameId(): string {
    return this.rootFrameId;
  }

  /**
   * Return the current parentId for a frame (or null for root). Undefined frames return null.
   */
  getParent(frameId: string): string | null {
    return this.parents.get(frameId) ?? null;
  }

  /**
   * Register that a frame has attached.
   * - Normal case: add/ensure nodes and parent→child link.
   * - Root handoff: if parentId is null and a different id attaches, rename the root id.
   */
  onAttached(frameId: string, parentId: string | null): void {
    // Root swap: parentId === null and a different id shows up — reassign root id.
    if (!parentId && frameId !== this.rootFrameId) {
      this.renameNodeId(this.rootFrameId, frameId);
      this.rootFrameId = frameId;
      return;
    }

    // Normal attach
    this.ensureNode(frameId);
    if (parentId) this.ensureNode(parentId);
    this.parents.set(frameId, parentId ?? null);
    if (parentId) this.children.get(parentId)!.add(frameId);
  }

  /**
   * Remove a frame and its entire subtree from the graph.
   * Callers should decide if a detach is a hard remove or a swap handoff before invoking this.
   */
  onDetached(frameId: string): void {
    const toRemove: string[] = [];
    const collect = (fid: string) => {
      toRemove.push(fid);
      const kids = this.children.get(fid);
      if (kids) for (const k of kids) collect(k);
    };
    collect(frameId);

    for (const fid of toRemove) {
      const parent = this.parents.get(fid);
      if (parent) this.children.get(parent)?.delete(fid);
      this.parents.delete(fid);
      this.children.delete(fid);
      this.frames.delete(fid);
    }
  }

  /**
   * Record the last-seen full CDP frame object.
   * Also handles root swaps that are signaled via a top-level navigation.
   */
  onNavigated(frame: Protocol.Page.Frame): void {
    this.ensureNode(frame.id);
    this.frames.set(frame.id, frame);
    if (!frame.parentId && frame.id !== this.rootFrameId) {
      // main-frame id swap via navigation — ensure graphs agree
      this.renameNodeId(this.rootFrameId, frame.id);
      this.rootFrameId = frame.id;
    }
  }

  /**
   * Serialize the current graph into a `Protocol.Page.FrameTree`.
   * If a frame has no stored CDP frame yet, emits a minimal shell with only ids populated.
   */
  asProtocolFrameTree(rootId: string): Protocol.Page.FrameTree {
    const build = (fid: string): Protocol.Page.FrameTree => {
      const stored = this.frames.get(fid);
      const frame: Protocol.Page.Frame =
        stored ??
        ({
          id: fid,
          loaderId: "",
          url: "",
          domainAndRegistry: "",
          securityOrigin: "",
          mimeType: "text/html",
          secureContextType: "InsecureScheme",
          crossOriginIsolatedContextType: "NotIsolated",
          gatedAPIFeatures: [],
        } as Protocol.Page.Frame);

      const kids = this.children.get(fid);
      const childFrames =
        kids && kids.size ? [...kids].map((k) => build(k)) : undefined;

      return childFrames ? { frame, childFrames } : { frame };
    };
    return build(rootId);
  }

  public getFrame(frameId: string): Protocol.Page.Frame {
    return this.frames.get(frameId);
  }

  /**
   * Ensure bookkeeping maps contain entries for a frame id (no-op if present).
   */
  private ensureNode(fid: string): void {
    if (!this.parents.has(fid)) this.parents.set(fid, null);
    if (!this.children.has(fid)) this.children.set(fid, new Set<string>());
  }

  /**
   * Rename a node id everywhere (parents/children/frames) to support main-frame handoffs.
   * Safe to call when oldId === newId (no-op).
   */
  private renameNodeId(oldId: string, newId: string): void {
    if (oldId === newId) return;

    // Parents map
    const parent = this.parents.get(oldId) ?? null;
    this.parents.delete(oldId);
    this.parents.set(newId, parent);

    // Children map
    const kids = this.children.get(oldId) ?? new Set<string>();
    this.children.delete(oldId);
    this.children.set(newId, kids);

    // Fix all parents' children sets that referenced oldId
    for (const set of this.children.values()) {
      if (set.has(oldId)) {
        set.delete(oldId);
        set.add(newId);
      }
    }

    // Frames map
    const f = this.frames.get(oldId);
    if (f) {
      this.frames.delete(oldId);
      const updated: Protocol.Page.Frame = { ...f, id: newId };
      this.frames.set(newId, updated);
    }
  }
}
