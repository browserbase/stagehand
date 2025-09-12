import { Protocol } from "devtools-protocol";
import { Locator } from "./locator";
import type { Frame } from "./frame";
import type { Page } from "./page";
import { executionContexts } from "./executionContextRegistry";
import { v3Logger } from "@/lib/v3/logger";

/**
 * Recognize iframe steps like "iframe" or "iframe[2]" in an XPath.
 */
const IFRAME_STEP_RE = /^iframe(?:\[\d+])?$/i;

type Axis = "child" | "desc";
type Step = { axis: Axis; raw: string; name: string };

/** Parse XPath into steps preserving '/' vs '//' and the raw token (with [n]) */
function parseXPath(path: string): Step[] {
  const s = path.trim();
  let i = 0;
  const steps: Step[] = [];
  while (i < s.length) {
    let axis: Axis = "child";
    if (s.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (s[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    while (i < s.length && s[i] !== "/") i++;
    const raw = s.slice(start, i).trim();
    if (!raw) continue;

    const name = raw.replace(/\[\d+\]\s*$/u, "").toLowerCase();
    steps.push({ axis, raw, name });
  }
  return steps;
}

function buildXPathFromSteps(steps: ReadonlyArray<Step>): string {
  let out = "";
  for (const st of steps) {
    out += st.axis === "desc" ? "//" : "/";
    out += st.raw; // keep predicates intact
  }
  return out || "/";
}

/**
 * Build a Locator that is scoped to the correct (possibly OOPIF) frame for a
 * deep XPath that crosses iframe boundaries.
 */
export async function deepLocatorThroughIframes(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
): Promise<Locator> {
  let path = xpathOrSelector.trim();
  if (path.startsWith("xpath=")) path = path.slice("xpath=".length).trim();
  if (!path.startsWith("/")) path = "/" + path;

  const steps = parseXPath(path);
  let ctx: Frame = root;
  let buf: Step[] = [];

  const flushIntoChildFrame = async (): Promise<void> => {
    if (!buf.length) return;

    const selectorForIframe = "xpath=" + buildXPathFromSteps(buf);
    v3Logger({
      category: "deep-hop",
      message: "resolving iframe in parent",
      level: 2,
      auxiliary: {
        parentFrameId: { value: String(ctx.frameId), type: "string" },
        selectorForIframe: { value: selectorForIframe, type: "string" },
      },
    });

    const tmp = new Locator(ctx, selectorForIframe);
    const parentSession = ctx.session;
    const { objectId } = await tmp.resolveNode();

    try {
      await parentSession.send("DOM.enable").catch(() => {});
      const desc = await parentSession.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;
      v3Logger({
        category: "deep-hop",
        message: "iframe backendNodeId",
        level: 2,
        auxiliary: {
          iframeBackendNodeId: {
            value: String(iframeBackendNodeId),
            type: "string",
          },
        },
      });

      const childIds = await listDirectChildFrameIdsFromRegistry(
        page,
        ctx.frameId,
        1000,
      );
      v3Logger({
        category: "deep-hop",
        message: "direct child frameIds",
        level: 2,
        auxiliary: {
          childIds: { value: JSON.stringify(childIds), type: "object" },
        },
      });

      let childFrameId: string | undefined;
      for (const fid of childIds) {
        try {
          const owner = await parentSession.send<{
            backendNodeId: Protocol.DOM.BackendNodeId;
            nodeId?: Protocol.DOM.NodeId;
          }>("DOM.getFrameOwner", { frameId: fid as Protocol.Page.FrameId });
          v3Logger({
            category: "deep-hop",
            message: "owner mapping",
            level: 2,
            auxiliary: {
              frameId: { value: String(fid), type: "string" },
              ownerBackendNodeId: {
                value: String(owner.backendNodeId),
                type: "string",
              },
            },
          });

          if (owner.backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch (e) {
          v3Logger({
            category: "deep-hop",
            message: "owner lookup failed",
            level: 2,
            auxiliary: {
              frameId: { value: String(fid), type: "string" },
              err: { value: String(e), type: "string" },
            },
          });
        }
      }

      if (!childFrameId) {
        throw new Error(
          `Could not resolve child frameId for "${selectorForIframe}"`,
        );
      }

      v3Logger({
        category: "deep-hop",
        message: "switching to child",
        level: 2,
        auxiliary: {
          childFrameId: { value: String(childFrameId), type: "string" },
        },
      });
      // Ensure we use the correct owning session with minimal delay:
      // 1) If same-process iframe, the parent session owns the frame and its
      //    main world will appear quickly — no extra waiting.
      // 2) If OOPIF and adoption not finished, the main world will NOT appear
      //    on parent; in that case, wait briefly for adoption, then proceed.
      await ensureChildFrameReady(page, ctx, childFrameId, 1200);
      ctx = page.frameForId(childFrameId);
    } finally {
      await parentSession
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }

    buf = [];
  };

  for (const st of steps) {
    buf.push(st);
    if (IFRAME_STEP_RE.test(st.name)) {
      await flushIntoChildFrame();
    }
  }

  const finalSelector = "xpath=" + buildXPathFromSteps(buf);
  v3Logger({
    category: "deep-hop",
    message: "final tail",
    level: 2,
    auxiliary: {
      frameId: { value: String(ctx.frameId), type: "string" },
      finalSelector: { value: finalSelector, type: "string" },
    },
  });
  return new Locator(ctx, finalSelector);
}

/**
 * Ensure we can evaluate in the child frame with minimal delay.
 * - If the child is same-process: the parent session owns it and the main
 *   world appears quickly. We try a short wait for main world on the parent.
 * - If that fails: likely an OOPIF not yet adopted — wait for ownership to
 *   change to a different session, then (briefly) wait for main world there.
 */
async function ensureChildFrameReady(
  page: Page,
  parentFrame: Frame,
  childFrameId: string,
  budgetMs: number,
): Promise<void> {
  const parentSession = parentFrame.session;
  const deadline = Date.now() + Math.max(0, budgetMs);

  // If already owned by a different session (OOPIF adopted), do a quick main-world wait there.
  const owner = page.getSessionForFrame(childFrameId);
  if (owner && owner !== parentSession) {
    try {
      await executionContexts.waitForMainWorld(owner, childFrameId, 600);
    } catch {
      // proceed; Locator will still wait as needed
    }
    return;
  }

  // Same-process path: avoid arbitrary sleeps. Prefer event-driven readiness.
  const hasMainWorldOnParent = (): boolean => {
    try {
      return (
        executionContexts.getMainWorld(parentSession, childFrameId) !== null
      );
    } catch {
      return false;
    }
  };

  // Quick check again before wiring listeners
  if (hasMainWorldOnParent()) return;

  // Ensure lifecycle events are flowing; Runtime is typically enabled already.
  await parentSession
    .send("Page.setLifecycleEventsEnabled", { enabled: true })
    .catch(() => {});
  await parentSession.send("Runtime.enable").catch(() => {});

  await new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      parentSession.off("Page.lifecycleEvent", onLifecycle);
      resolve();
    };

    const onLifecycle = (evt: Protocol.Page.LifecycleEventEvent) => {
      if (
        evt.frameId !== childFrameId ||
        (evt.name !== "DOMContentLoaded" &&
          evt.name !== "load" &&
          evt.name !== "networkIdle" &&
          evt.name !== "networkidle")
      ) {
        return;
      }
      // On any meaningful lifecycle event for the child, re-check readiness.
      if (hasMainWorldOnParent()) {
        finish();
        return;
      }
      // If ownership flipped to OOPIF during this time, wait briefly on child.
      try {
        const nowOwner = page.getSessionForFrame(childFrameId);
        if (nowOwner && nowOwner !== parentSession) {
          const left = Math.max(150, deadline - Date.now());
          executionContexts
            .waitForMainWorld(nowOwner, childFrameId, left)
            .finally(finish);
        }
      } catch {
        // ignore; fall through to time budget
      }
    };

    parentSession.on("Page.lifecycleEvent", onLifecycle);

    // Poller to avoid missing events; returns when budget expires or ready.
    const tick = () => {
      if (done) return;
      if (hasMainWorldOnParent()) return finish();
      try {
        const nowOwner = page.getSessionForFrame(childFrameId);
        if (nowOwner && nowOwner !== parentSession) {
          const left = Math.max(150, deadline - Date.now());
          executionContexts
            .waitForMainWorld(nowOwner, childFrameId, left)
            .finally(finish);
          return;
        }
      } catch {
        // ignore
      }
      if (Date.now() >= deadline) return finish();
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Read direct children of a parent frame from the Page/registry (cross-target),
 * polling briefly to allow OOPIF adoption to complete.
 */
async function listDirectChildFrameIdsFromRegistry(
  page: Page,
  parentFrameId: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const tree = page.getFullFrameTree();
      const node = findFrameNode(tree, parentFrameId);
      const ids = node?.childFrames?.map((c) => c.frame.id as string) ?? [];
      if (ids.length > 0 || Date.now() >= deadline) return ids;
    } catch {
      //
    }
    await delay(50);
  }
}

function findFrameNode(
  tree: Protocol.Page.FrameTree,
  targetId: string,
): Protocol.Page.FrameTree | undefined {
  if (tree.frame.id === targetId) return tree;
  for (const c of tree.childFrames ?? []) {
    const hit = findFrameNode(c, targetId);
    if (hit) return hit;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
