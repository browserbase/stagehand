import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../../understudy/deepLocator.js";
import type { Snapshot } from "../pick.js";
import { buildView, isNameless, nearbyTwins, type OutlineNode } from "../tree.js";
import { selectorFor } from "./page.js";
import type { DecisionsActDeps, PipelineContext } from "./types.js";

/**
 * What the accessibility outline leaves out, read from the DOM on demand: attributes of
 * nameless controls, whether an element is actually shown, and an input's current value.
 */

const MAX_DOM_HINTS = 25;

/**
 * Icon-only controls reach the outline with a role and nothing else. Their
 * DOM attributes (aria-label, title, class, icon href…) are the only handle.
 */
export async function addDomHints(ctx: PipelineContext, snap: Snapshot): Promise<void> {
  const nameless = buildView(snap.nodes, "pointer")
    .filter((node) => isNameless(snap.nodes, node))
    .slice(0, MAX_DOM_HINTS);
  if (nameless.length === 0) return;

  const startedAt = Date.now();
  const hints = new Map<string, string>();
  await Promise.all(
    nameless.map(async (node) => {
      const selector = selectorFor(snap, node);
      const hint = selector ? await readDomHint(ctx.deps, selector) : undefined;
      if (hint) hints.set(node.id, hint);
    }),
  );
  ctx.domHints = hints;
  ctx.trace.push({
    node: "dom_hints",
    ms: Date.now() - startedAt,
    nameless: nameless.length,
    found: hints.size,
  });
}

function domHintOf(this: Element): string {
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) parts.push(`${label}=${value.trim().slice(0, 60)}`);
  };
  push("aria-label", this.getAttribute("aria-label"));
  push("title", this.getAttribute("title"));
  push("id", this.id);
  push("class", typeof this.className === "string" ? this.className : "");
  push("data-testid", this.getAttribute("data-testid") ?? this.getAttribute("data-test"));
  push("href", this.getAttribute("href"));
  const icon = this.querySelector("svg use, img, i, svg title");
  if (icon) {
    push(
      "icon",
      icon.getAttribute("href") ??
        icon.getAttribute("xlink:href") ??
        icon.getAttribute("alt") ??
        icon.getAttribute("src"),
    );
    push("icon-class", icon.getAttribute("class"));
    if (icon.tagName.toLowerCase() === "title") push("icon-title", icon.textContent);
  }
  return parts.join(" ");
}

/**
 * Pages render the same control twice (desktop and mobile navs, hover
 * overlays) and only one copy is really there for the user. The decision model cannot tell
 * identical descriptions apart, so the DOM decides.
 */
export async function preferVisibleTwin(
  ctx: PipelineContext,
  snap: Snapshot,
  target: OutlineNode,
): Promise<OutlineNode> {
  // Same item only. Identical-looking controls elsewhere on the page belong
  // to other items, and swapping to one of those changes WHAT gets acted on.
  const twins = nearbyTwins(snap.nodes, target);
  if (twins.length < 2) return target;

  const own = selectorFor(snap, target);
  if (own && (await isShown(ctx.deps, own))) return target;
  for (const twin of twins) {
    if (twin.id === target.id) continue;
    const selector = selectorFor(snap, twin);
    if (selector && (await isShown(ctx.deps, selector))) {
      ctx.trace.push({ node: "visible_twin", ms: 0, from: target.id, choice: twin.id });
      return twin;
    }
  }
  return target;
}

function shownInPage(this: Element): boolean {
  const rect = this.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // oxlint-disable-next-line typescript/no-this-alias -- runs in the page with the element as `this`
  for (let element: Element | null = this; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }
    // Hover overlays park their content outside a clipping ancestor: the
    // control has a size, but none of it falls inside what that ancestor shows.
    // Only hard clipping: a scroll container merely has the control scrolled
    // out of view, and the click scrolls it back in.
    const hard = (value: string) => value === "hidden" || value === "clip";
    const clips = hard(style.overflowX) || hard(style.overflowY);
    if (
      element !== this &&
      clips &&
      element !== document.documentElement &&
      element !== document.body
    ) {
      const box = element.getBoundingClientRect();
      const overlapX = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
      const overlapY = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
      if (overlapX <= 0 || overlapY <= 0) return false;
    }
  }
  return true;
}

async function isShown(deps: DecisionsActDeps, selector: string): Promise<boolean> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode();
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: shownInPage.toString(), returnByValue: true },
      );
      return Boolean(response.result.value);
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    // Unknown is not hidden: keep the decision model's pick.
    return true;
  }
}

async function readDomHint(deps: DecisionsActDeps, selector: string): Promise<string | undefined> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode();
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: domHintOf.toString(), returnByValue: true },
      );
      const hint = String(response.result.value ?? "").trim();
      return hint || undefined;
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    return undefined;
  }
}

export async function readInputValue(
  deps: DecisionsActDeps,
  selector: string,
): Promise<string | undefined> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    return await locator.inputValue();
  } catch {
    return undefined;
  }
}
