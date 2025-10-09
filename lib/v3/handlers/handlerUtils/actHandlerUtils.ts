// lib/v3/handlers/handlerUtils/actHandlerUtils.ts
import { Protocol } from "devtools-protocol";
import { Frame } from "../../understudy/frame";
import { Locator } from "../../understudy/locator";
import { resolveLocatorWithHops } from "../../understudy/deepLocator";
import type { Page } from "../../understudy/page";
import { v3Logger } from "@/lib/v3/logger";
import { StagehandClickError } from "../../types/public/sdkErrors";

export class UnderstudyCommandException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnderstudyCommandException";
  }
}

export interface UnderstudyMethodHandlerContext {
  method: string;
  locator: Locator;
  xpath: string;
  args: ReadonlyArray<string>;
  frame: Frame;
  page: Page;
  initialUrl: string;
  domSettleTimeoutMs?: number;
}

// Normalize cases where the XPath is the root "/" to point to the HTML element.
function normalizeRootXPath(input: string): string {
  const s = String(input ?? "").trim();
  if (s === "/") return "/html";
  if (/^xpath=\/$/i.test(s)) return "xpath=/html";
  return s;
}

export async function performUnderstudyMethod(
  page: Page,
  frame: Frame,
  method: string,
  rawXPath: string,
  args: ReadonlyArray<unknown>,
  domSettleTimeoutMs?: number,
): Promise<void> {
  // Proactively wait for the DOM/network to be quiet before acting
  await waitForDomNetworkQuiet(frame, domSettleTimeoutMs);

  const selectorRaw = normalizeRootXPath(rawXPath);
  // Unified resolver: supports '>>' hops and XPath across iframes
  const locator: Locator = await resolveLocatorWithHops(
    page,
    frame,
    selectorRaw,
  );

  const initialUrl = await getFrameUrl(frame);

  v3Logger({
    category: "action",
    message: "performing understudy method",
    level: 2,
    auxiliary: {
      xpath: { value: selectorRaw, type: "string" },
      method: { value: method, type: "string" },
      url: { value: initialUrl, type: "string" },
    },
  });

  const ctx: UnderstudyMethodHandlerContext = {
    method,
    locator,
    xpath: selectorRaw,
    args: args.map((a) => (a == null ? "" : String(a))),
    frame,
    page,
    initialUrl,
    domSettleTimeoutMs,
  };

  try {
    const handler = METHOD_HANDLER_MAP[method] ?? null;

    if (handler) {
      await handler(ctx);
    } else {
      // Accept a few common locator method aliases
      switch (method) {
        case "click":
          await clickElement(ctx);
          break;
        case "fill":
          await fillOrType(ctx);
          break;
        case "type":
          await typeText(ctx);
          break;
        default:
          v3Logger({
            category: "action",
            message: "chosen method is invalid",
            level: 1,
            auxiliary: { method: { value: method, type: "string" } },
          });
          throw new UnderstudyCommandException(
            `Method ${method} not supported`,
          );
      }
    }

    await handlePossibleNavigation("action", selectorRaw, initialUrl, frame);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    v3Logger({
      category: "action",
      message: "error performing method",
      level: 1,
      auxiliary: {
        error: { value: msg, type: "string" },
        trace: { value: stack ?? "", type: "string" },
        method: { value: method, type: "string" },
        xpath: { value: selectorRaw, type: "string" },
        args: { value: JSON.stringify(args), type: "object" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

/* ===================== Handlers & Map ===================== */

const METHOD_HANDLER_MAP: Record<
  string,
  (ctx: UnderstudyMethodHandlerContext) => Promise<void>
> = {
  scrollIntoView,
  scrollByPixelOffset,
  scrollTo: scrollElementToPercentage,
  scroll: scrollElementToPercentage,
  "mouse.wheel": wheelScroll,
  fill: fillOrType,
  type: typeText,
  press: pressKey,
  click: clickElement,
  doubleClick,
  dragAndDrop,
  nextChunk: scrollToNextChunk,
  prevChunk: scrollToPreviousChunk,
  selectOptionFromDropdown: selectOption,
  selectOption: selectOption,
};

export async function selectOption(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath, args } = ctx;
  try {
    const text = args[0]?.toString() || "";
    await locator.selectOption(text);
  } catch (e) {
    v3Logger({
      category: "action",
      message: "error selecting option",
      level: 0,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(e.message);
  }
}

async function scrollIntoView(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath } = ctx;
  v3Logger({
    category: "action",
    message: "scrolling element into view",
    level: 2,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });
  const { objectId } = await locator.resolveNode();
  const ownerSession = locator.getFrame().session;
  await ownerSession.send("DOM.scrollIntoViewIfNeeded", { objectId });
  await ownerSession
    .send("Runtime.releaseObject", { objectId })
    .catch(() => {});
}

async function scrollElementToPercentage(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath, args } = ctx;
  v3Logger({
    category: "action",
    message: "scrolling element vertically to specified percentage",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
      coordinate: { value: JSON.stringify(args), type: "string" },
    },
  });

  const [yArg = "0%"] = args;
  await locator.scrollTo(yArg);
}

/** Scroll the page by pixel offset, starting from the element's center. */
async function scrollByPixelOffset(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, page, args } = ctx;
  const dx = Number(args[0] ?? 0);
  const dy = Number(args[1] ?? 0);

  try {
    const { x, y } = await locator.centroid();
    await page.scroll(x, y, dx, dy);
  } catch (e) {
    throw new UnderstudyCommandException(e.message);
  }
}

async function wheelScroll(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { frame, args } = ctx;
  const deltaY = Number(args[0] ?? 200);
  v3Logger({
    category: "action",
    message: "dispatching mouse wheel",
    level: 2,
    auxiliary: { deltaY: { value: String(deltaY), type: "string" } },
  });
  await frame.session.send<never>("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 0,
    y: 0,
    deltaY,
    deltaX: 0,
  } as Protocol.Input.DispatchMouseEventRequest);
}

async function fillOrType(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, args } = ctx;
  try {
    await locator.fill(""); // clear
    await locator.fill(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error filling element",
      level: 1,
      auxiliary: {
        error: { value: msg, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

async function typeText(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, args } = ctx;
  try {
    await locator.type(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error typing into element",
      level: 1,
      auxiliary: {
        error: { value: msg, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

async function pressKey(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { frame, args, xpath } = ctx;
  const key = args[0] ?? "";
  try {
    v3Logger({
      category: "action",
      message: "pressing key",
      level: 1,
      auxiliary: {
        key: { value: key, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    await frame.session.send<never>("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      text: key.length === 1 ? key : undefined,
    } as Protocol.Input.DispatchKeyEventRequest);
    await frame.session.send<never>("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      text: key.length === 1 ? key : undefined,
    } as Protocol.Input.DispatchKeyEventRequest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error pressing key",
      level: 1,
      auxiliary: {
        error: { value: msg, type: "string" },
        key: { value: key, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

async function clickElement(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath } = ctx;
  try {
    await locator.click();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error performing click",
      level: 0,
      auxiliary: {
        error: { value: msg, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new StagehandClickError(ctx.xpath, msg);
  }
}

async function doubleClick(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath } = ctx;
  try {
    await locator.click({ clickCount: 2 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error performing doubleClick",
      level: 0,
      auxiliary: {
        error: { value: msg, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

async function dragAndDrop(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { page, frame, locator, args, xpath } = ctx;
  const toXPath = String(args[0] ?? "").trim();
  if (!toXPath)
    throw new UnderstudyCommandException(
      "dragAndDrop requires a target XPath arg",
    );

  const targetLocator = await resolveLocatorWithHops(page, frame, toXPath);

  try {
    // 1) Centers in local (owning-frame) viewport
    const { x: fromLocalX, y: fromLocalY } = await locator.centroid();
    const { x: toLocalX, y: toLocalY } = await targetLocator.centroid();

    // 2) Convert to main-viewport absolute coordinates
    const fromAbs = await locator
      .getFrame()
      .evaluate<{ x: number; y: number }, { x: number; y: number }>(
        ({ x, y }: { x: number; y: number }) => {
          let X = x;
          let Y = y;
          let w: Window = window;
          while (w !== w.top) {
            const fe = w.frameElement as HTMLElement | null;
            if (!fe) break;
            const r = fe.getBoundingClientRect();
            X += r.left;
            Y += r.top;
            w = w.parent as Window;
          }
          return { x: Math.round(X), y: Math.round(Y) };
        },
        { x: fromLocalX, y: fromLocalY },
      );

    const toAbs = await targetLocator
      .getFrame()
      .evaluate<{ x: number; y: number }, { x: number; y: number }>(
        ({ x, y }: { x: number; y: number }) => {
          let X = x;
          let Y = y;
          let w: Window = window;
          while (w !== w.top) {
            const fe = w.frameElement as HTMLElement | null;
            if (!fe) break;
            const r = fe.getBoundingClientRect();
            X += r.left;
            Y += r.top;
            w = w.parent as Window;
          }
          return { x: Math.round(X), y: Math.round(Y) };
        },
        { x: toLocalX, y: toLocalY },
      );

    // 3) Perform drag in main session
    await page.dragAndDrop(fromAbs.x, fromAbs.y, toAbs.x, toAbs.y, {
      steps: 10,
      delay: 5,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    v3Logger({
      category: "action",
      message: "error performing dragAndDrop",
      level: 0,
      auxiliary: {
        error: { value: msg, type: "string" },
        from: { value: xpath, type: "string" },
        to: { value: toXPath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg);
  }
}

async function scrollToNextChunk(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  await scrollByElementHeight(ctx, /*dir=*/ 1);
}

async function scrollToPreviousChunk(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  await scrollByElementHeight(ctx, /*dir=*/ -1);
}

async function scrollByElementHeight(
  ctx: UnderstudyMethodHandlerContext,
  direction: 1 | -1,
): Promise<void> {
  const { locator, xpath } = ctx;
  v3Logger({
    category: "action",
    message:
      direction > 0 ? "scrolling to next chunk" : "scrolling to previous chunk",
    level: 2,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });

  const { objectId } = await locator.resolveNode();
  try {
    const ownerSession = locator.getFrame().session;
    await ownerSession.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: `
          function(dir) {
            const waitForScrollEnd = (el) => new Promise((resolve) => {
              let last = el.scrollTop ?? 0;
              const check = () => {
                const cur = el.scrollTop ?? 0;
                if (cur === last) return resolve();
                last = cur;
                requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            });

            const tag = this.tagName?.toLowerCase();
            if (tag === "html" || tag === "body") {
              const h = window.visualViewport?.height ?? window.innerHeight;
              window.scrollBy({ top: h * dir, left: 0, behavior: "smooth" });
              const root = document.scrollingElement ?? document.documentElement;
              return waitForScrollEnd(root);
            }
            const h = this.getBoundingClientRect().height;
            this.scrollBy({ top: h * dir, left: 0, behavior: "smooth" });
            return waitForScrollEnd(this);
          }
        `,
        arguments: [{ value: direction }],
        awaitPromise: true,
        returnByValue: true,
      },
    );
  } finally {
    const ownerSession = locator.getFrame().session;
    await ownerSession
      .send("Runtime.releaseObject", { objectId })
      .catch(() => {});
  }
}

/* ===================== Helpers ===================== */

async function getFrameUrl(frame: Frame): Promise<string> {
  // Evaluate from within the frame's isolated world
  const url = await frame.evaluate<string>("location.href");
  return url;
}

/**
 * More robust DOM settle using Network + Page events to detect network quiet.
 * Closely modeled after the provided snippet, adapted to our Frame/session + logger.
 */
async function waitForDomNetworkQuiet(
  frame: Frame,
  timeoutMs?: number,
): Promise<void> {
  const timeout = typeof timeoutMs === "number" ? timeoutMs : 5_000;
  const client = frame.session;

  // Ensure a document exists; if not, wait for DOMContentLoaded on this frame.
  let hasDoc: boolean;
  try {
    const rs = await frame.evaluate<string>("document.readyState");
    hasDoc = rs === "interactive" || rs === "complete";
  } catch {
    hasDoc = false;
  }
  if (!hasDoc) {
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
  }

  await client.send("Network.enable").catch(() => {});
  await client.send("Page.enable").catch(() => {});
  // Best-effort; some sessions may not support Target.setAutoAttach here.
  await client
    .send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [
        { type: "worker", exclude: true },
        { type: "shared_worker", exclude: true },
      ],
    })
    .catch(() => {});

  return new Promise<void>((resolve) => {
    const inflight = new Set<string>();
    const meta = new Map<string, { url: string; start: number }>();
    const docByFrame = new Map<string, string>();

    let quietTimer: NodeJS.Timeout | null = null;
    let stalledRequestSweepTimer: NodeJS.Timeout | null = null;

    const clearQuiet = () => {
      if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
    };

    const maybeQuiet = () => {
      if (inflight.size === 0 && !quietTimer)
        quietTimer = setTimeout(() => resolveDone(), 500);
    };

    const finishReq = (id: string) => {
      if (!inflight.delete(id)) return;
      meta.delete(id);
      for (const [fid, rid] of docByFrame)
        if (rid === id) docByFrame.delete(fid);
      clearQuiet();
      maybeQuiet();
    };

    const onRequest = (p: Protocol.Network.RequestWillBeSentEvent) => {
      // Ignore long-lived streams
      // ResourceType includes: Document, XHR, Fetch, WebSocket, EventSource, etc.
      if (p.type === "WebSocket" || p.type === "EventSource") return;

      inflight.add(p.requestId);
      meta.set(p.requestId, { url: p.request.url, start: Date.now() });

      if (p.type === "Document" && p.frameId)
        docByFrame.set(p.frameId, p.requestId);

      clearQuiet();
    };

    const onFinish = (p: { requestId: string }) => finishReq(p.requestId);
    const onCached = (p: { requestId: string }) => finishReq(p.requestId);
    const onDataUrl = (p: Protocol.Network.ResponseReceivedEvent) => {
      if (p.response.url?.startsWith("data:")) finishReq(p.requestId);
    };

    const onFrameStop = (f: Protocol.Page.FrameStoppedLoadingEvent) => {
      const id = docByFrame.get(f.frameId);
      if (id) finishReq(id);
    };

    client.on("Network.requestWillBeSent", onRequest);
    client.on("Network.loadingFinished", onFinish);
    client.on("Network.loadingFailed", onFinish);
    client.on("Network.requestServedFromCache", onCached);
    client.on("Network.responseReceived", onDataUrl);
    client.on("Page.frameStoppedLoading", onFrameStop);

    stalledRequestSweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, m] of meta) {
        if (now - m.start > 2_000) {
          inflight.delete(id);
          meta.delete(id);
          v3Logger({
            category: "dom",
            message: "⏳ forcing completion of stalled iframe document",
            level: 1,
            auxiliary: {
              url: { value: (m.url ?? "").slice(0, 120), type: "string" },
            },
          });
        }
      }
      maybeQuiet();
    }, 500);

    maybeQuiet();

    const guard = setTimeout(() => {
      if (inflight.size) {
        v3Logger({
          category: "dom",
          message:
            "⚠️ DOM-settle timeout reached – network requests still pending",
          level: 1,
          auxiliary: {
            count: { value: String(inflight.size), type: "integer" },
          },
        });
      }
      resolveDone();
    }, timeout);

    const resolveDone = () => {
      client.off("Network.requestWillBeSent", onRequest);
      client.off("Network.loadingFinished", onFinish);
      client.off("Network.loadingFailed", onFinish);
      client.off("Network.requestServedFromCache", onCached);
      client.off("Network.responseReceived", onDataUrl);
      client.off("Page.frameStoppedLoading", onFrameStop);
      if (quietTimer) clearTimeout(quietTimer);
      if (stalledRequestSweepTimer) clearInterval(stalledRequestSweepTimer);
      clearTimeout(guard);
      resolve();
    };
  });
}

async function handlePossibleNavigation(
  actionDescription: string,
  xpath: string,
  initialUrl: string,
  frame: Frame,
): Promise<void> {
  v3Logger({
    category: "action",
    message: `${actionDescription}, checking for page navigation`,
    level: 1,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });

  // We only have a frame-scoped session, so detect navigation by URL change.
  const afterUrl = await getFrameUrl(frame);

  if (afterUrl !== initialUrl) {
    v3Logger({
      category: "action",
      message: "new page (frame) URL detected",
      level: 1,
      auxiliary: { url: { value: afterUrl, type: "string" } },
    });
  } else {
    v3Logger({
      category: "action",
      message: "no new (frame) URL detected",
      level: 1,
      auxiliary: { url: { value: afterUrl, type: "string" } },
    });
  }
}
