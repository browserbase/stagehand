import { Protocol } from "devtools-protocol";
import { Locator } from "./locator";
import type { Frame } from "./frame";
import type { Page } from "./page";

/**
 * Recognize iframe steps like "iframe" or "iframe[2]" in an XPath.
 */
const IFRAME_STEP_RE = /^iframe(\[\d+])?$/i;

/**
 * Build a Locator that is scoped to the correct (possibly OOPIF) frame for a
 * deep XPath that crosses iframe boundaries, e.g.:
 *
 *   /html/body/div/iframe[1]/html/body/div/iframe[1]/html/body/button
 *
 * Algorithm:
 *   - Keep a rolling buffer of XPath steps inside the current frame.
 *   - When an iframe step is encountered, resolve the buffered XPath to the
 *     <iframe> element in the current frame, obtain its child frameId, and
 *     switch `ctx` (the current Frame) to that child’s frame/session.
 *   - After processing all steps, return a Locator for the remainder in `ctx`.
 */
export async function deepLocatorThroughIframes(
  page: Page,
  root: Frame,
  xpathOrSelector: string,
): Promise<Locator> {
  // Normalize: accept "xpath=..." or raw "/..."
  let xpath = xpathOrSelector.trim();
  if (xpath.startsWith("xpath=")) xpath = xpath.slice("xpath=".length).trim();
  if (!xpath.startsWith("/")) xpath = "/" + xpath;

  const tokens = xpath.split("/"); // keeps "" for "//"
  let ctx: Frame = root; // current frame context
  let buffer: string[] = [];

  // --- UPDATED: robust OOPIF hop ---
  const flushIntoChildFrame = async () => {
    if (!buffer.length) return;

    const selectorForIframe = "xpath=/" + buffer.join("/");

    // Resolve <iframe> element in the current frame (isolated world)
    const tmp = new Locator(ctx, selectorForIframe);
    const { objectId } = await tmp.resolveNode();

    try {
      // Primary path: request a nodeId just for getFrameOwner()
      let childFrameId: string | undefined;

      try {
        const { nodeId } = await ctx.session.send<{
          nodeId: Protocol.DOM.NodeId;
        }>("DOM.requestNode", { objectId });

        const owner = await ctx.session.send<{
          frameId: string;
          backendNodeId: number;
        }>("DOM.getFrameOwner", { nodeId });
        childFrameId = owner.frameId;
      } catch {
        // Fallback: ordinal mapping against the *owning page's* full frame tree,
        // with a short poll to allow OOPIF attach to appear.
        const idxRes =
          await ctx.session.send<Protocol.Runtime.CallFunctionOnResponse>(
            "Runtime.callFunctionOn",
            {
              objectId,
              functionDeclaration: `
              function() {
                const all = Array.from(document.querySelectorAll('iframe'));
                return all.indexOf(this);
              }`,
              returnByValue: true,
            },
          );
        const idx = (idxRes.result.value as number) ?? 0;

        childFrameId = await pollForChildFrameId(page, ctx.frameId, idx, 800);
      }

      if (!childFrameId) {
        throw new Error(
          `Could not resolve child frameId for "${selectorForIframe}"`,
        );
      }

      ctx = page.frameForId(childFrameId);
    } finally {
      await ctx.session
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }

    buffer = [];
  };

  // Walk the xpath tokens, pushing until we hit an iframe step.
  for (let i = 1; i < tokens.length; i++) {
    const step = tokens[i];
    if (!step) continue; // ignore shadow-hop here for now
    buffer.push(step);

    if (IFRAME_STEP_RE.test(step)) {
      await flushIntoChildFrame();
    }
  }

  // Whatever remains is inside the deepest ctx
  const finalSelector = "xpath=/" + buffer.join("/");
  return new Locator(ctx, finalSelector);
}

// Poll the owning page’s full frame tree for a child at ordinal `idx`
async function pollForChildFrameId(
  page: Page,
  parentFrameId: string,
  idx: number,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tree = page.getFullFrameTree();
    const parent = findFrameNode(tree, parentFrameId);
    const child = parent?.childFrames?.[idx]?.frame?.id;
    if (child) return child;
    await delay(80);
  }
  return undefined;
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
