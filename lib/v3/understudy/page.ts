import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { Frame } from "./frame";
import { FrameGraph } from "./frameGraph";
import { LoadState } from "../types";

const LIFECYCLE_NAME: Record<LoadState, string> = {
  load: "load",
  domcontentloaded: "DOMContentLoaded",
  networkidle: "networkIdle",
};

/**
 * Page
 *
 * Purpose:
 * A single, top-level browser page abstraction (one per top-level target).
 * It owns the page’s **main CDP session** and **adopted OOPIF child sessions**,
 * and maintains a live, unified frame tree through a `FrameGraph`.
 *
 * What it does:
 * - Exposes convenience APIs (goto/reload/url/screenshot/locator).
 * - Tracks the **current** main frame id across cross-process swaps.
 * - Adopts/ detaches OOPIF sessions; seeds their current state; wires their events.
 * - Serializes the full, merged frame tree for inspection/debugging.
 *
 * What it does NOT do:
 * - Manage CDP target lifecycle (attach/detach/resume) — that is the Context’s job.
 * - Talk directly to Target domain (the Context feeds us Page domain events).
 */
export class Page {
  /** All CDP sessions owned by this Page (main + adopted OOPIF child sessions). */
  private readonly sessions = new Map<string, CDPSessionLike>(); // sessionId -> session
  /** Pure frame topology + last-seen CDP frames for this Page. */
  private readonly frameGraph: FrameGraph;

  /** Child session id -> its main frame id (for clean detaches). */
  private childSessionMainFrame = new Map<string, string>();

  /** Convenience wrapper bound to the current main frame id. */
  private mainFrameWrapper: Frame;

  /**
   * Construct a Page bound to a top-level target’s main session.
   * @param mainSession CDP session for the top-level target.
   * @param _targetId   Top-level target id (informational & for mapping).
   * @param mainFrameId Current main frame id (will change on root swaps).
   */
  private constructor(
    private readonly mainSession: CDPSessionLike,
    private readonly _targetId: string,
    mainFrameId: string,
  ) {
    this.sessions.set(mainSession.id!, mainSession);
    this.frameGraph = new FrameGraph(_targetId, mainFrameId);
    this.mainFrameWrapper = new Frame(mainSession, mainFrameId, _targetId);
  }

  /**
   * Factory: create a Page and seed the FrameGraph with the top-level target’s shallow tree.
   * Assumes Page domain is already enabled on the session.
   */
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

    // Seed topology + last-seen frames for nodes known at creation time.
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

  /**
   * Top-level target id for this Page (stable identifier for Context maps).
   */
  targetId(): string {
    return this._targetId;
  }

  /**
   * Return the **current** main frame id (changes on cross-process navigations).
   */
  mainFrameId(): string {
    return this.frameGraph.mainFrameId();
  }

  /**
   * Return a convenience `Frame` wrapper bound to the current main frame id.
   */
  mainFrame(): Frame {
    return this.mainFrameWrapper;
  }

  /**
   * Serialize the **full merged frame tree** (including OOPIF subtrees).
   */
  getFullFrameTree(): Protocol.Page.FrameTree {
    return this.asProtocolFrameTree(this.mainFrameId());
  }

  /**
   * Serialize the merged frame tree using an explicit root id.
   * @param rootMainFrameId Root frame id to serialize from (typically `mainFrameId()`).
   */
  asProtocolFrameTree(rootMainFrameId: string): Protocol.Page.FrameTree {
    return this.frameGraph.asProtocolFrameTree(rootMainFrameId);
  }

  /**
   * Adopt an OOPIF child session whose **main frame id** equals the parent iframe’s frame id.
   * - Wires child Page domain events into the FrameGraph.
   * - Performs a one-shot snapshot (`Page.getFrameTree`) to seed real frame data.
   * - Does **not** create the parent→child edge; the parent’s `frameAttached` is canonical.
   */
  adoptOopifSession(
    childSession: CDPSessionLike,
    childMainFrameId: string,
  ): void {
    console.log("attempting to adoptOopifSession");
    this.sessions.set(childSession.id!, childSession);
    this.childSessionMainFrame.set(childSession.id!, childMainFrameId);

    // Live updates from child session.
    childSession.on<Protocol.Page.FrameNavigatedEvent>(
      "Page.frameNavigated",
      (evt) => {
        this.frameGraph.onNavigated(evt.frame);
        // If top-level main changed, rebind wrapper.
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

    // One-shot seed: snapshot the child subtree and store real frames/topology.
    void (async () => {
      try {
        await childSession.send("Page.enable").catch(() => {});

        // Wait once for a potential commit if the snapshot looks pre-commit.
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

        // Snapshot current truth.
        let { frameTree } =
          await childSession.send<Protocol.Page.GetFrameTreeResponse>(
            "Page.getFrameTree",
          );

        // Reconcile root id if the child session reports a different one (rare).
        if (frameTree.frame.id !== childMainFrameId) {
          this.frameGraph.onNavigated({
            ...frameTree.frame,
            id: childMainFrameId,
          });
          frameTree = {
            ...frameTree,
            frame: { ...frameTree.frame, id: childMainFrameId },
          };
        }

        // If snapshot looks blank, wait briefly for a commit.
        const looksBlank =
          !frameTree.frame.url ||
          frameTree.frame.url === "about:blank" ||
          (typeof frameTree.frame.loaderId === "string" &&
            frameTree.frame.loaderId.length === 0);

        if (looksBlank) {
          const committed = await waitOnceForChildCommit(1200);
          if (committed) {
            frameTree = { ...frameTree, frame: { ...committed } };
          }
        }

        // Store real frames for the whole subtree.
        const seedFramesOnly = (tree: Protocol.Page.FrameTree) => {
          this.frameGraph.onNavigated(tree.frame);
          if (tree.childFrames)
            for (const c of tree.childFrames) seedFramesOnly(c);
        };
        seedFramesOnly(frameTree);

        const stored = this.frameGraph.getFrame(childMainFrameId);
        console.log("[seed] child root now:", {
          id: childMainFrameId,
          url: stored?.url,
          loaderId: stored?.loaderId,
        });

        // Attach topology for the subtree:
        //  - For the root, attach only if we know the external parent (the iframe element).
        //  - For internal children, attach under their parent within the child tree.
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
        } else if (frameTree.childFrames) {
          // Parent not known yet: avoid root attach (would trigger root-swap).
          for (const c of frameTree.childFrames)
            attachSubtree(c, frameTree.frame.id);
        }
      } catch {
        // If snapshot/commit wait races, live events will still keep the graph in sync.
      }
    })();
  }

  /**
   * Remove an adopted OOPIF session and prune its subtree from the FrameGraph.
   */
  detachOopifSession(sessionId: string): void {
    const mainFid = this.childSessionMainFrame.get(sessionId);
    if (mainFid) {
      this.frameGraph.onDetached(mainFid);
      this.childSessionMainFrame.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }

  /**
   * Bridge: parent/child session emitted a `frameAttached`.
   * Updates topology; does not fabricate frame metadata.
   */
  onFrameAttached(frameId: string, parentId: string | null): void {
    this.frameGraph.onAttached(frameId, parentId);
  }

  /**
   * Bridge: parent/child session emitted a `frameDetached`.
   * Treat `"swap"` as a handoff (no removal); otherwise prune subtree.
   */
  onFrameDetached(
    frameId: string,
    reason: "remove" | "swap" | string = "remove",
  ): void {
    if (reason === "swap") return;
    this.frameGraph.onDetached(frameId);
  }

  /**
   * Bridge: parent/child session emitted a `frameNavigated`.
   * Stores the real CDP frame and rebinds the main-frame wrapper on root change.
   */
  onFrameNavigated(frame: Protocol.Page.Frame): void {
    this.frameGraph.onNavigated(frame);
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

  /**
   * Helper: get current parent id for a frame (or null if unknown).
   */
  private frameGraphParentOf(fid: string): string | null {
    return this.frameGraph.getParent(fid);
  }

  // -------- Convenience APIs delegated to the current main frame --------

  /**
   * Navigate the page; optionally wait for a lifecycle state.
   * Waits on the **current** main frame and follows root swaps during navigation.
   */
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

  /**
   * Reload the page; optionally wait for a lifecycle state.
   */
  async reload(options?: {
    waitUntil?: Exclude<"networkidle", "networkidle">;
  }): Promise<void> {
    await this.mainSession.send("Page.reload", { ignoreCache: false });
    if (options?.waitUntil) {
      await this.mainFrameWrapper.waitForLoadState(options.waitUntil);
    }
  }

  /**
   * Return the current page URL (from navigation history).
   */
  async url(): Promise<string> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    return entries[currentIndex]?.url ?? "";
  }

  /**
   * Capture a screenshot (delegated to the current main frame).
   */
  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    return this.mainFrameWrapper.screenshot(options);
  }

  /**
   * Create a locator bound to the current main frame.
   */
  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.mainFrameWrapper.locator(selector);
  }

  // ---- Page-level lifecycle waiter that follows main frame id swaps ----

  /**
   * Create an isolated world for the **current** main frame and return its context id.
   */
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

  /**
   * Wait until the **current** main frame reaches a lifecycle state.
   * - Fast path via `document.readyState`.
   * - Event path listens at the session level and compares incoming `frameId`
   *   to `mainFrameId()` **at event time** to follow root swaps.
   */
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
