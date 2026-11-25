import type { Protocol } from "devtools-protocol";

type FrameId = string;
type SessionId = string;

type FrameInfo = {
  parentId: FrameId | null;
  children: Set<FrameId>;
  lastSeen?: Protocol.Page.Frame;

  ownerSessionId?: SessionId;

  ownerBackendNodeId?: number;
};

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
  readonly ownerTargetId: string;

  rootFrameId: FrameId;

  frames = new Map<FrameId, FrameInfo>();

  framesBySession = new Map<SessionId, Set<FrameId>>();

  constructor(ownerTargetId: string, mainFrameId: FrameId) {
    this.ownerTargetId = ownerTargetId;
    this.rootFrameId = mainFrameId;
    this.ensureNode(mainFrameId);
  }

  onFrameAttached(frameId: FrameId, parentId: FrameId | null, sessionId: SessionId): void {
    if (!parentId && frameId !== this.rootFrameId) {
      this.renameNodeId(this.rootFrameId, frameId);
      this.rootFrameId = frameId;
      this.setOwnerSessionIdInternal(frameId, sessionId);
      return;
    }

    this.ensureNode(frameId);
    if (parentId) this.ensureNode(parentId);

    const info = this.frames.get(frameId)!;
    info.parentId = parentId ?? null;

    if (parentId) {
      this.frames.get(parentId)!.children.add(frameId);
    }

    this.setOwnerSessionIdInternal(frameId, sessionId);
  }

  onFrameNavigated(frame: Protocol.Page.Frame, sessionId: SessionId): void {
    this.ensureNode(frame.id);
    const info = this.frames.get(frame.id)!;
    info.lastSeen = frame;

    this.setOwnerSessionIdInternal(frame.id, sessionId);

    if (!("parentId" in frame) || !frame.parentId) {
      if (frame.id !== this.rootFrameId) {
        this.renameNodeId(this.rootFrameId, frame.id);
        this.rootFrameId = frame.id;
      }
    }
  }

  onNavigatedWithinDocument(frameId: FrameId, url: string, sessionId: SessionId): void {
    this.ensureNode(frameId);
    const info = this.frames.get(frameId)!;
    const lastSeen = info.lastSeen ?? shellFrame(frameId);
    info.lastSeen = { ...lastSeen, url };
    this.setOwnerSessionIdInternal(frameId, sessionId);
  }

  onFrameDetached(frameId: FrameId, reason: string = "remove"): void {
    if (reason === "swap") return;

    const toRemove: FrameId[] = [];
    const collect = (fid: FrameId) => {
      toRemove.push(fid);
      const kids = this.frames.get(fid)?.children ?? new Set<FrameId>();
      for (const k of kids) collect(k);
    };
    collect(frameId);

    for (const fid of toRemove) {
      const info = this.frames.get(fid);
      if (!info) continue;

      if (info.parentId) {
        const p = this.frames.get(info.parentId);
        p?.children.delete(fid);
      }

      if (info.ownerSessionId) {
        const bag = this.framesBySession.get(info.ownerSessionId);
        bag?.delete(fid);
        if (bag && bag.size === 0) this.framesBySession.delete(info.ownerSessionId);
      }

      this.frames.delete(fid);
    }

    if (!this.frames.has(this.rootFrameId)) {
      const iter = this.frames.keys().next();
      if (!iter.done) this.rootFrameId = iter.value;
    }
  }

  adoptChildSession(childSessionId: SessionId, childMainFrameId: FrameId): void {
    this.setOwnerSessionIdInternal(childMainFrameId, childSessionId);
  }

  seedFromFrameTree(sessionId: SessionId, frameTree: Protocol.Page.FrameTree): void {
    const walk = (tree: Protocol.Page.FrameTree, parent: FrameId | null) => {
      this.ensureNode(tree.frame.id);
      const info = this.frames.get(tree.frame.id)!;
      const previousParent = info.parentId;
      const nextParent = parent ?? tree.frame.parentId ?? previousParent ?? null;

      if (previousParent && previousParent !== nextParent) {
        this.frames.get(previousParent)?.children.delete(tree.frame.id);
      }
      info.parentId = nextParent;
      if (nextParent) {
        this.ensureNode(nextParent);
        this.frames.get(nextParent)!.children.add(tree.frame.id);
      }
      info.lastSeen =
        nextParent && !tree.frame.parentId ? { ...tree.frame, parentId: nextParent } : tree.frame;
      if (!info.ownerSessionId) {
        this.setOwnerSessionIdInternal(tree.frame.id, sessionId);
      }
      for (const c of tree.childFrames ?? []) walk(c, tree.frame.id);
    };
    walk(frameTree, null);
  }

  setOwnerBackendNodeId(childFrameId: FrameId, backendNodeId: number): void {
    this.ensureNode(childFrameId);
    this.frames.get(childFrameId)!.ownerBackendNodeId = backendNodeId;
  }

  mainFrameId(): FrameId {
    return this.rootFrameId;
  }

  getOwnerSessionId(frameId: FrameId): SessionId | undefined {
    return this.frames.get(frameId)?.ownerSessionId;
  }

  getOwnerBackendNodeId(frameId: FrameId): number | undefined {
    return this.frames.get(frameId)?.ownerBackendNodeId;
  }

  getParent(frameId: FrameId): FrameId | null {
    return this.frames.get(frameId)?.parentId ?? null;
  }

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

  sessionsForFrame(frameId: FrameId): SessionId[] {
    const info = this.frames.get(frameId);
    return info?.ownerSessionId ? [info.ownerSessionId] : [];
  }

  framesForSession(sessionId: SessionId): FrameId[] {
    return [...(this.framesBySession.get(sessionId) ?? new Set())];
  }

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

  renameNodeId(oldId: FrameId, newId: FrameId): void {
    if (oldId === newId) return;
    this.ensureNode(oldId);

    const info = this.frames.get(oldId)!;

    this.frames.delete(oldId);
    this.frames.set(newId, { ...info });

    if (info.parentId) {
      const p = this.frames.get(info.parentId);
      if (p) {
        p.children.delete(oldId);
        p.children.add(newId);
      }
    }

    for (const c of info.children) {
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

    if (info.ownerSessionId === sessionId) return;

    if (info.ownerSessionId) {
      const prev = this.framesBySession.get(info.ownerSessionId);
      prev?.delete(frameId);
      if (prev && prev.size === 0) this.framesBySession.delete(info.ownerSessionId);
    }

    info.ownerSessionId = sessionId;
    const bag = this.framesBySession.get(sessionId) ?? new Set<FrameId>();
    bag.add(frameId);
    this.framesBySession.set(sessionId, bag);
  }
}
