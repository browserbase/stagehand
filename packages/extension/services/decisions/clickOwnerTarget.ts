import type { Protocol } from "devtools-protocol";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import type { CDPSessionLike } from "../../understudy/cdp.js";

export type Caption = { id: string; path: string; name: string; captionId: string };

async function resolveNode(session: CDPSessionLike, group: string, backendNodeId: number) {
  const { object } = await session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
    backendNodeId,
    objectGroup: group,
  });
  return object.objectId;
}

function ownerAttributes(
  this: HTMLElement,
  text: Node,
  name: string,
  point: { cx: number; cy: number },
) {
  const caption = text.parentElement;
  if (
    !caption ||
    caption.parentElement !== this ||
    !this.matches("div,span") ||
    this.closest(
      '[role],a,button,label,summary,[contenteditable],[inert],[hidden],[disabled],[aria-hidden="true"],[aria-disabled="true"]',
    ) ||
    !this.isConnected ||
    this.hasAttribute("aria-labelledby") ||
    (this.title && this.title.trim() !== name) ||
    (this.hasAttribute("aria-label") && this.getAttribute("aria-label")?.trim() !== name) ||
    getComputedStyle(this).cursor !== "pointer" ||
    getComputedStyle(caption).pointerEvents !== "none" ||
    this.innerText.trim() !== name
  )
    return;
  const hit = (element: Element) => {
    const r = element.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  };
  if (hit(caption) !== this || document.elementFromPoint(point.cx, point.cy) !== this) return;
  return { tag: this.localName, id: this.id.slice(0, 120), class: this.className.slice(0, 160) };
}

function closedMenu(this: HTMLElement) {
  if (this.getAttribute("aria-haspopup")?.trim().toLowerCase() === "false") return;
  // A text match and a click handler alone cannot establish that an action
  // opens a menu. Require a closed menu with a label on each option.
  const menus = Array.from(this.children).filter((child) => {
    if (!(child instanceof HTMLElement)) return false;
    const style = getComputedStyle(child);
    if (!child.hidden && style.display !== "none" && style.visibility !== "hidden") return false;
    if (
      !/menu|listbox|options/iu.test(
        [child.getAttribute("role"), child.id, child.className].join(" "),
      )
    )
      return false;
    const items = Array.from(child.children);
    return (
      items.length > 0 &&
      items.every(
        (item) =>
          /item|option/iu.test([item.getAttribute("role"), item.className].join(" ")) &&
          item.textContent?.trim(),
      )
    );
  });
  return menus.length === 1 ? menus[0] : undefined;
}

export async function inspectClickOwner(
  page: Page,
  cap: Caption,
  group: string,
  progress: Progress,
  requiresPopup: boolean,
) {
  const session = page.mainFrame().session;
  return progress.run("checking custom click owner", async () => {
    const owner = await resolveNode(session, group, Number(cap.id.split("-")[1]));
    const text = await resolveNode(session, group, Number(cap.captionId.split("-")[1]));
    if (!owner || !text) return;
    const point = await page.locator("xpath=" + cap.path).contentPoint(owner, progress);
    const { result } = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId: owner,
        functionDeclaration: ownerAttributes.toString(),
        arguments: [{ objectId: text }, { value: cap.name }, { value: point }],
        returnByValue: true,
      },
    );
    const attributes = result.value as ReturnType<typeof ownerAttributes>;
    if (!attributes) return;
    let menuId: number | undefined;
    if (requiresPopup) {
      const { result } = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId: owner,
          functionDeclaration: closedMenu.toString(),
          objectGroup: group,
        },
      );
      if (!result.objectId) return;
      const { node } = await session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", {
        objectId: result.objectId,
      });
      menuId = node.backendNodeId;
    }
    const { listeners } = await session.send<Protocol.DOMDebugger.GetEventListenersResponse>(
      "DOMDebugger.getEventListeners",
      { objectId: owner, depth: 1 },
    );
    const clicks = listeners.filter(
      (listener) =>
        listener.type === "click" && listener.backendNodeId === Number(cap.id.split("-")[1]),
    );
    if (clicks.length !== 1) return;
    const listener = clicks[0];
    const handler = listener?.handler?.objectId;
    if (listener && handler) {
      const { once, passive, useCapture } = listener;
      return { handler, attributes, menuId, registration: { once, passive, useCapture } };
    }
  });
}

export async function sameClickListener(
  session: CDPSessionLike,
  initial: string,
  current: string,
  progress: Progress,
) {
  // A listener reinstalled from the same source location can close over different state.
  const { result } = await progress.run("comparing click listeners", () =>
    session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
      objectId: initial,
      functionDeclaration: "function(other) { return this === other }",
      arguments: [{ objectId: current }],
      returnByValue: true,
    }),
  );
  return result.value === true;
}

async function menuOpens(this: HTMLElement, owner: HTMLElement, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  const visible = { opacityProperty: true, visibilityProperty: true };
  while (this.isConnected && this.parentElement === owner) {
    const box = this.getBoundingClientRect();
    if (
      this.clientHeight > 0 &&
      this.checkVisibility(visible) &&
      Array.from(this.children).some((item) => {
        const rect = item.getBoundingClientRect();
        return (
          item.textContent?.trim() &&
          item.checkVisibility(visible) &&
          Math.min(box.right, rect.right) > Math.max(box.left, rect.left) &&
          Math.min(box.bottom, rect.bottom) > Math.max(box.top, rect.top)
        );
      })
    )
      return true;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
  }
  return false;
}

export async function verifyMenuOpened(
  page: Page,
  ownerId: string,
  menuId: number,
  progress: Progress,
) {
  const group = "stagehand-click-result-" + crypto.randomUUID();
  const session = page.mainFrame().session;
  try {
    return await progress.run("verifying the opened menu", async () => {
      const [owner, menu] = await Promise.all([
        resolveNode(session, group, Number(ownerId.split("-")[1])),
        resolveNode(session, group, menuId),
      ]);
      if (!owner || !menu) return false;
      const { result } = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId: menu,
          functionDeclaration: menuOpens.toString(),
          arguments: [{ objectId: owner }, { value: Math.min(1000, progress.remainingMs()) }],
          awaitPromise: true,
          returnByValue: true,
        },
      );
      return result.value === true;
    });
  } finally {
    await progress.cleanup(() =>
      session.send("Runtime.releaseObjectGroup", { objectGroup: group }),
    );
  }
}
