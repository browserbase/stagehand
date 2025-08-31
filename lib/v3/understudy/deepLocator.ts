import { Protocol } from "devtools-protocol";
import { Locator } from "./locator";
import type { Frame } from "./frame";
import type { Page } from "./page";

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
    console.log("[deep-hop] resolving iframe in parent", {
      parentFrameId: ctx.frameId,
      selectorForIframe,
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
      console.log("[deep-hop] iframe backendNodeId", { iframeBackendNodeId });

      const childIds = await listDirectChildFrameIdsFromRegistry(
        page,
        ctx.frameId,
        1000,
      );
      console.log("[deep-hop] direct child frameIds", childIds);

      let childFrameId: string | undefined;
      for (const fid of childIds) {
        try {
          const owner = await parentSession.send<{
            backendNodeId: Protocol.DOM.BackendNodeId;
            nodeId?: Protocol.DOM.NodeId;
          }>("DOM.getFrameOwner", { frameId: fid as Protocol.Page.FrameId });
          console.log("[deep-hop] owner mapping", {
            frameId: fid,
            ownerBackendNodeId: owner.backendNodeId,
          });

          if (owner.backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch (e) {
          console.log("[deep-hop] owner lookup failed", {
            frameId: fid,
            err: String(e),
          });
        }
      }

      if (!childFrameId) {
        throw new Error(
          `Could not resolve child frameId for "${selectorForIframe}"`,
        );
      }

      console.log("[deep-hop] switching to child", { childFrameId });
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
  console.log("[deep-hop] final tail", { frameId: ctx.frameId, finalSelector });
  return new Locator(ctx, finalSelector);
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
