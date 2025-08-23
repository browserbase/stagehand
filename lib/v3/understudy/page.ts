// lib/v3/understudy/page.ts
import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { Frame } from "./frame";

type LoadState = "load" | "domcontentloaded" | "networkidle";
const LIFECYCLE_NAME: Record<LoadState, string> = {
  load: "load",
  domcontentloaded: "DOMContentLoaded",
  networkidle: "networkIdle",
};

/**
 * A live frame graph that aggregates frame events from the page’s main session
 * and any adopted OOPIF child sessions.
 *
 * Playwright-style rules:
 * - On frameAttached: record only topology (parent/children). DO NOT fabricate a full frame object.
 * - On frameNavigated: store the real Protocol.Page.Frame (last-seen).
 * - On frameDetached: remove the subtree — EXCEPT when reason === 'swap' (handoff).
 * - On parent==null attach: treat as main-frame id reassignment (rename root id).
 */
class FrameGraph {
  /** frameId -> parentId (null for root) */
  private parents = new Map<string, string | null>();
  /** parentId -> children set */
  private children = new Map<string, Set<string>>();
  /** frameId -> last-seen full CDP frame */
  private frames = new Map<string, Protocol.Page.Frame>();

  constructor(
    private readonly ownerTargetId: string,
    private rootFrameId: string,
  ) {
    this.ensureNode(rootFrameId);
  }

  mainFrameId(): string {
    return this.rootFrameId;
  }

  getParent(frameId: string): string | null {
    return this.parents.get(frameId) ?? null;
  }

  /** Handle attach; if parentId is null and this isn't the current root, rename the root id. */
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

  /** Keep the real CDP frame details verbatim. */
  onNavigated(frame: Protocol.Page.Frame): void {
    this.ensureNode(frame.id);
    this.frames.set(frame.id, frame);
    if (!frame.parentId && frame.id !== this.rootFrameId) {
      // main-frame id swap via navigation — ensure graphs agree
      this.renameNodeId(this.rootFrameId, frame.id);
      this.rootFrameId = frame.id;
    }
  }

  /** Serialize with real CDP frames when known; otherwise a minimal shell. */
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

  private ensureNode(fid: string): void {
    if (!this.parents.has(fid)) this.parents.set(fid, null);
    if (!this.children.has(fid)) this.children.set(fid, new Set<string>());
  }

  /** Rename a node id throughout the graph (used for main-frame id reassignment). */
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

/**
 * V3 Page: one per top-level target. Owns one "main" session and any number of
 * adopted OOPIF child sessions. Exposes a live frame graph.
 */
export class Page {
  private readonly sessions = new Map<string, CDPSessionLike>(); // sessionId -> session
  private readonly frameGraph: FrameGraph;

  /** Keep a mapping child session id -> its main frame id for clean detach. */
  private childSessionMainFrame = new Map<string, string>();

  /** The main frame is represented via a Frame wrapper for convenience APIs (screenshot, etc.). */
  private mainFrameWrapper: Frame;

  private constructor(
    private readonly mainSession: CDPSessionLike,
    private readonly _targetId: string,
    mainFrameId: string,
  ) {
    this.sessions.set(mainSession.id!, mainSession);
    this.frameGraph = new FrameGraph(_targetId, mainFrameId);
    this.mainFrameWrapper = new Frame(mainSession, mainFrameId, _targetId);
  }

  /** Expose top-level target id to V3Context for mapping updates. */
  targetId(): string {
    return this._targetId;
  }

  /** Create a V3 Page bound to the top (main) CDP frame of the top-level target. */
  static async create(
    session: CDPSessionLike,
    targetId: string,
  ): Promise<Page> {
    await session.send("Page.enable").catch(() => {});
    await session
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});
    const { frameTree } = await session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const mainFrameId = frameTree.frame.id;
    const page = new Page(session, targetId, mainFrameId);

    // Seed topology (and store real frames present in this snapshot)
    const seed = (tree: Protocol.Page.FrameTree, parent: string | null) => {
      page.frameGraph.onAttached(tree.frame.id, parent);
      page.frameGraph.onNavigated(tree.frame);
      if (tree.childFrames)
        for (const c of tree.childFrames) seed(c, tree.frame.id);
    };
    seed(frameTree, null);

    return page;
  }

  // -------- MAIN APIs --------

  mainFrameId(): string {
    return this.frameGraph.mainFrameId();
  }

  mainFrame(): Frame {
    return this.mainFrameWrapper;
  }

  getFullFrameTree(): Protocol.Page.FrameTree {
    return this.asProtocolFrameTree(this.mainFrameId());
  }

  asProtocolFrameTree(rootMainFrameId: string): Protocol.Page.FrameTree {
    return this.frameGraph.asProtocolFrameTree(rootMainFrameId);
  }

  /** Adopt an OOPIF child session whose main frame id equals the iframe element’s frame id. */
  adoptOopifSession(
    childSession: CDPSessionLike,
    childMainFrameId: string,
  ): void {
    console.log("attempting to adoptOopifSession");
    this.sessions.set(childSession.id!, childSession);
    this.childSessionMainFrame.set(childSession.id!, childMainFrameId);

    // Do NOT force-attach the root edge here; the parent session's frameAttached is the canonical edge.

    // Wire child events so future updates flow.
    childSession.on<Protocol.Page.FrameNavigatedEvent>(
      "Page.frameNavigated",
      (evt) => {
        this.frameGraph.onNavigated(evt.frame);
        if (
          !evt.frame.parentId &&
          evt.frame.id !== this.mainFrameWrapper.frameId
        ) {
          this.mainFrameWrapper = new Frame(
            this.mainSession,
            evt.frame.id,
            this._targetId,
          );
        }
      },
    );
    childSession.on<Protocol.Page.FrameAttachedEvent>(
      "Page.frameAttached",
      (evt) => {
        this.frameGraph.onAttached(evt.frameId, evt.parentFrameId ?? null);
      },
    );
    childSession.on<Protocol.Page.FrameDetachedEvent>(
      "Page.frameDetached",
      (evt) => {
        // Parent side treats 'swap' specially; here we hard-prune child-side subtree edges.
        this.frameGraph.onDetached(evt.frameId);
      },
    );

    // ---- One-shot seed of real frame data for this child session ----
    // 1) Try a snapshot. If it looks like pre-commit (blank url/loader), wait once for a commit.
    void (async () => {
      try {
        // Ensure Page is enabled on the child (should be already by Context, but harmless)
        await childSession.send("Page.enable").catch(() => {});

        // Helper: wait for next frameNavigated for this child root (short timeout)
        const waitOnceForChildCommit = (ms: number) =>
          new Promise<Protocol.Page.Frame | null>((resolve) => {
            let timer: NodeJS.Timeout | null = setTimeout(() => {
              timer = null;
              off();
              resolve(null);
            }, ms);
            const handler = (evt: Protocol.Page.FrameNavigatedEvent) => {
              if (evt.frame.id === childMainFrameId) {
                if (timer) clearTimeout(timer);
                off();
                resolve(evt.frame);
              }
            };
            const off = () => childSession.off("Page.frameNavigated", handler);
            childSession.on("Page.frameNavigated", handler);
          });

        // Snapshot current truth
        let { frameTree } =
          await childSession.send<Protocol.Page.GetFrameTreeResponse>(
            "Page.getFrameTree",
          );

        // If the child root has changed id (very rare), reconcile to expected id
        if (frameTree.frame.id !== childMainFrameId) {
          // Renaming here guarantees our stored frames key matches the topology id used by parent
          this.frameGraph.onNavigated({
            ...frameTree.frame,
            id: childMainFrameId,
          });
          // Re-map subtree ids if needed (conservative: keep child ids, only fix root id)
          frameTree = {
            ...frameTree,
            frame: { ...frameTree.frame, id: childMainFrameId },
          };
        }

        const looksBlank =
          !frameTree.frame.url ||
          frameTree.frame.url === "about:blank" ||
          (typeof frameTree.frame.loaderId === "string" &&
            frameTree.frame.loaderId.length === 0);

        if (looksBlank) {
          // Wait briefly for a commit so we get a real URL/loaderId instead of placeholders
          const committed = await waitOnceForChildCommit(1200);
          if (committed) {
            // Update snapshot root with committed data
            frameTree = { ...frameTree, frame: { ...committed } };
          }
        }

        // 2) Store real frames first (for the whole subtree)
        const seedFramesOnly = (tree: Protocol.Page.FrameTree) => {
          this.frameGraph.onNavigated(tree.frame);
          if (tree.childFrames)
            for (const c of tree.childFrames) seedFramesOnly(c);
        };
        seedFramesOnly(frameTree);
        const stored = this.frameGraph["frames"].get(childMainFrameId);
        console.log("[seed] child root now:", {
          id: childMainFrameId,
          url: stored?.url,
          loaderId: stored?.loaderId,
        });

        // 3) Attach topology for the subtree:
        //    - For the root, attach ONLY if we know the external parent (the iframe element).
        //    - For internal children, it's safe to attach under their parent within the child tree.
        const parentOfRoot = this.frameGraphParentOf(childMainFrameId);
        const attachSubtree = (
          tree: Protocol.Page.FrameTree,
          parentId: string | null,
        ) => {
          if (parentId !== null) {
            this.frameGraph.onAttached(tree.frame.id, parentId);
          }
          if (tree.childFrames) {
            for (const c of tree.childFrames) attachSubtree(c, tree.frame.id);
          }
        };

        if (parentOfRoot) {
          attachSubtree(frameTree, parentOfRoot);
        } else {
          // Parent not known yet: do not attach the root here (to avoid root-swap path).
          // Still attach internal children under the root so the subtree is ready when the parent links the root.
          if (frameTree.childFrames) {
            for (const c of frameTree.childFrames)
              attachSubtree(c, frameTree.frame.id);
          }
        }
      } catch {
        // If snapshot/commit wait races, live events will still keep the graph in sync.
      }
    })();
  }

  /** Detach an adopted OOPIF session and prune its subtree. */
  detachOopifSession(sessionId: string): void {
    const mainFid = this.childSessionMainFrame.get(sessionId);
    if (mainFid) {
      this.frameGraph.onDetached(mainFid);
      this.childSessionMainFrame.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }

  // Events bridged from V3Context for every routed session
  onFrameAttached(frameId: string, parentId: string | null): void {
    this.frameGraph.onAttached(frameId, parentId);
  }

  onFrameDetached(
    frameId: string,
    reason: "remove" | "swap" | string = "remove",
  ): void {
    if (reason === "swap") {
      // Handoff: do NOT remove node; a new session will re-attach the same frameId.
      return;
    }
    this.frameGraph.onDetached(frameId);
  }

  onFrameNavigated(frame: Protocol.Page.Frame): void {
    this.frameGraph.onNavigated(frame);
    // Rebind wrapper if top-level main frame id changed
    if (!("parentId" in frame) || !frame.parentId) {
      const newMainId = frame.id;
      if (newMainId !== this.mainFrameWrapper.frameId) {
        this.mainFrameWrapper = new Frame(
          this.mainSession,
          newMainId,
          this._targetId,
        );
      }
    }
  }

  private frameGraphParentOf(fid: string): string | null {
    return this.frameGraph.getParent(fid);
  }

  // -------- Convenience APIs delegated to the current main frame --------

  async goto(
    url: string,
    options?: { waitUntil?: LoadState; timeoutMs?: number },
  ): Promise<void> {
    await this.mainSession.send<Protocol.Page.NavigateResponse>(
      "Page.navigate",
      { url },
    );
    if (options?.waitUntil) {
      await this.waitForMainLoadState(
        options.waitUntil,
        options.timeoutMs ?? 15000,
      );
    }
  }

  async reload(options?: {
    waitUntil?: Exclude<"networkidle", "networkidle">;
  }): Promise<void> {
    await this.mainSession.send("Page.reload", { ignoreCache: false });
    if (options?.waitUntil) {
      await this.mainFrameWrapper.waitForLoadState(options.waitUntil);
    }
  }

  async url(): Promise<string> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    return entries[currentIndex]?.url ?? "";
  }

  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    return this.mainFrameWrapper.screenshot(options);
  }

  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.mainFrameWrapper.locator(selector);
  }

  // ---- Page-level lifecycle waiter that follows main frame id swaps ----

  private async createIsolatedWorldForCurrentMain(): Promise<number> {
    await this.mainSession.send("Runtime.enable").catch(() => {});
    const { executionContextId } = await this.mainSession.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId: this.mainFrameId(),
      worldName: "v3-world",
    });
    return executionContextId;
  }

  private async waitForMainLoadState(
    state: LoadState,
    timeoutMs = 15000,
  ): Promise<void> {
    await this.mainSession
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

    // Fast path: check the *current* main frame's readyState.
    try {
      const ctxId = await this.createIsolatedWorldForCurrentMain();
      const { result } =
        await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            contextId: ctxId,
            returnByValue: true,
          },
        );
      const rs = String(result?.value ?? "");
      if (
        (state === "domcontentloaded" &&
          (rs === "interactive" || rs === "complete")) ||
        (state === "load" && rs === "complete")
      ) {
        return;
      }
    } catch {
      // ignore fast-path failures
    }

    const wanted = LIFECYCLE_NAME[state];
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const off = () => {
        this.mainSession.off("Page.lifecycleEvent", onLifecycle);
        this.mainSession.off("Page.domContentEventFired", onDomContent);
        this.mainSession.off("Page.loadEventFired", onLoad);
      };

      const finish = () => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        off();
        resolve();
      };

      const onLifecycle = (evt: Protocol.Page.LifecycleEventEvent) => {
        if (evt.name !== wanted) return;
        // Compare against the *current* main frame id when the event arrives.
        if (evt.frameId === this.mainFrameId()) finish();
      };

      const onDomContent = () => {
        if (state === "domcontentloaded") finish();
      };

      const onLoad = () => {
        if (state === "load") finish();
      };

      this.mainSession.on("Page.lifecycleEvent", onLifecycle);
      // Backups for sites that don't emit lifecycle consistently
      this.mainSession.on("Page.domContentEventFired", onDomContent);
      this.mainSession.on("Page.loadEventFired", onLoad);

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(
          new Error(
            `waitForMainLoadState(${state}) timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }
}
