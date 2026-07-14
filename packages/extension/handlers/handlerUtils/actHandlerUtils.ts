// lib/v3/handlers/handlerUtils/actHandlerUtils.ts
import { Protocol } from "devtools-protocol";
import { Frame } from "../../understudy/frame.js";
import { Locator } from "../../understudy/locator.js";
import type { MouseButton } from "../../../protocol/types.js";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import type { StagehandLogger } from "../../logger.js";
import { toTitleCase } from "../../utils.js";
import { StagehandClickError, UnderstudyCommandException } from "../../errors.js";

export interface UnderstudyMethodHandlerContext {
  method: string;
  locator: Locator;
  xpath: string;
  args: ReadonlyArray<string>;
  frame: Frame;
  page: Page;
  initialUrl: string;
  logger: StagehandLogger;
  domSettleTimeoutMs?: number;
}

// Normalize cases where the XPath is the root "/" to point to the HTML element.
function normalizeRootXPath(input: string): string {
  const s = String(input ?? "").trim();
  if (s === "/") return "/html";
  if (/^xpath=\/$/i.test(s)) return "xpath=/html";
  return s;
}

function stringifyArgument(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}

export async function performUnderstudyMethod(
  page: Page,
  frame: Frame,
  method: string,
  rawXPath: string,
  args: ReadonlyArray<unknown>,
  logger: StagehandLogger,
  domSettleTimeoutMs?: number,
): Promise<void> {
  const selectorRaw = normalizeRootXPath(rawXPath);

  try {
    await logger.span(
      `Understudy${toTitleCase(method)}`,
      { target: selectorRaw },
      async (spanLogger) => {
        // Unified resolver: supports '>>' hops and XPath across iframes.
        const locator: Locator = await resolveLocatorWithHops(page, frame, selectorRaw);
        const initialUrl = await getFrameUrl(frame);

        spanLogger.debug("Performing understudy method", {
          category: "action",
          xpath: selectorRaw,
          method,
          url: initialUrl,
        });

        const ctx: UnderstudyMethodHandlerContext = {
          method,
          locator,
          xpath: selectorRaw,
          args: args.map(stringifyArgument),
          frame,
          page,
          initialUrl,
          logger: spanLogger,
          domSettleTimeoutMs,
        };
        const handler = METHOD_HANDLER_MAP[method] ?? null;

        if (handler) {
          await handler(ctx);
          return;
        }

        spanLogger.info("Chosen method is invalid", {
          category: "action",
          method,
        });
        throw new UnderstudyCommandException(`Method ${method} not supported`);
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.info("Error performing method", {
      category: "action",
      error: msg,
      stack: stack ?? null,
      method,
      xpath: selectorRaw,
      args: args.map(stringifyArgument),
    });
    if (e instanceof UnderstudyCommandException) {
      throw e;
    }
    throw new UnderstudyCommandException(msg, e);
  }
}

/* ===================== Handlers & Map ===================== */

const METHOD_HANDLER_MAP: Record<string, (ctx: UnderstudyMethodHandlerContext) => Promise<void>> = {
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
  hover: hover,
};

export async function selectOption(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath, args, logger } = ctx;
  try {
    const text = args[0]?.toString() || "";
    await locator.selectOption(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.error("Error selecting option", {
      category: "action",
      error: msg,
      stack: stack ?? null,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function scrollIntoView(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, logger } = ctx;
  logger.debug("Scrolling element into view", {
    category: "action",
    xpath,
  });
  const { objectId } = await locator.resolveNode();
  const ownerSession = locator.getFrame().session;
  await ownerSession.send("DOM.scrollIntoViewIfNeeded", { objectId });
  await ownerSession.send("Runtime.releaseObject", { objectId }).catch(() => {});
}

async function scrollElementToPercentage(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, args, logger } = ctx;
  logger.debug("Scrolling element vertically to specified percentage", {
    category: "action",
    xpath,
    coordinate: [...args],
  });

  const [yArg = "0%"] = args;
  await locator.scrollTo(yArg);
}

/** Scroll the page by pixel offset, starting from the element's center. */
async function scrollByPixelOffset(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, page, args } = ctx;
  const dx = Number(args[0] ?? 0);
  const dy = Number(args[1] ?? 0);

  try {
    const { x, y } = await locator.centroid();
    await page.scroll(x, y, dx, dy);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UnderstudyCommandException(msg, e);
  }
}

async function wheelScroll(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { frame, args, logger } = ctx;
  const deltaY = Number(args[0] ?? 200);
  logger.debug("Dispatching mouse wheel", {
    category: "action",
    deltaY,
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
  const { locator, xpath, args, logger } = ctx;
  try {
    await locator.fill(""); // clear
    await locator.fill(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.info("Error filling element", {
      category: "action",
      error: msg,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function typeText(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, args, logger } = ctx;
  try {
    await locator.type(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.info("Error typing into element", {
      category: "action",
      error: msg,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function pressKey(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { args, xpath, page, logger } = ctx;
  const key = args[0] ?? "";
  try {
    logger.info("Pressing key", {
      category: "action",
      key,
      xpath,
    });
    await page.keyPress(key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.info("Error pressing key", {
      category: "action",
      error: msg,
      key,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function clickElement(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, args, logger } = ctx;
  try {
    await locator.click({ button: (args[0] as MouseButton) || undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Error performing click", {
      category: "action",
      error: msg,
      xpath,
    });
    throw new StagehandClickError(ctx.xpath, msg);
  }
}

async function doubleClick(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { locator, xpath, logger } = ctx;
  try {
    await locator.click({ clickCount: 2 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Error performing double click", {
      category: "action",
      error: msg,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function dragAndDrop(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { page, frame, locator, args, xpath, logger } = ctx;
  const toXPath = String(args[0] ?? "").trim();
  if (!toXPath) throw new UnderstudyCommandException("dragAndDrop requires a target XPath arg");

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
    logger.error("Error performing drag and drop", {
      category: "action",
      error: msg,
      from: xpath,
      to: toXPath,
    });
    throw new UnderstudyCommandException(msg, e);
  }
}

async function scrollToNextChunk(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  await scrollByElementHeight(ctx, /*dir=*/ 1);
}

async function scrollToPreviousChunk(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  await scrollByElementHeight(ctx, /*dir=*/ -1);
}

async function scrollByElementHeight(
  ctx: UnderstudyMethodHandlerContext,
  direction: 1 | -1,
): Promise<void> {
  const { locator, xpath, logger } = ctx;
  logger.debug(direction > 0 ? "Scrolling to next chunk" : "Scrolling to previous chunk", {
    category: "action",
    xpath,
  });

  const { objectId } = await locator.resolveNode();
  try {
    const ownerSession = locator.getFrame().session;
    await ownerSession.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
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
    });
  } finally {
    const ownerSession = locator.getFrame().session;
    await ownerSession.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

export async function hover(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath, logger } = ctx;
  try {
    await locator.hover();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.error("Error attempting to hover", {
      category: "action",
      error: msg,
      stack: stack ?? null,
      xpath,
    });
    throw new UnderstudyCommandException(msg, e);
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
export async function waitForDomNetworkQuiet(
  frame: Frame,
  logger: StagehandLogger,
  timeoutMs?: number,
): Promise<void> {
  const overallTimeout =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 5_000;
  const client = frame.session;
  const settleStart = Date.now();

  // Ensure a document exists; if not, wait for DOMContentLoaded on this frame.
  let hasDoc: boolean;
  try {
    const rs = await frame.evaluate<string>("document.readyState");
    hasDoc = rs === "interactive" || rs === "complete";
  } catch {
    hasDoc = false;
  }
  if (!hasDoc && overallTimeout > 0) {
    await frame.waitForLoadState("domcontentloaded", overallTimeout).catch(() => {});
  }

  const elapsed = Date.now() - settleStart;
  const remainingBudget = Math.max(0, overallTimeout - elapsed);
  if (remainingBudget === 0) {
    return;
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

    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let stalledRequestSweepTimer: ReturnType<typeof setTimeout> | null = null;

    const clearQuiet = () => {
      if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
    };

    const maybeQuiet = () => {
      if (inflight.size === 0 && !quietTimer) quietTimer = setTimeout(() => resolveDone(), 500);
    };

    const finishReq = (id: string) => {
      if (!inflight.delete(id)) return;
      meta.delete(id);
      for (const [fid, rid] of docByFrame) if (rid === id) docByFrame.delete(fid);
      clearQuiet();
      maybeQuiet();
    };

    const onRequest = (p: Protocol.Network.RequestWillBeSentEvent) => {
      // Ignore long-lived streams
      // ResourceType includes: Document, XHR, Fetch, WebSocket, EventSource, etc.
      if (p.type === "WebSocket" || p.type === "EventSource") return;

      inflight.add(p.requestId);
      meta.set(p.requestId, { url: p.request.url, start: Date.now() });

      if (p.type === "Document" && p.frameId) docByFrame.set(p.frameId, p.requestId);

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
          logger.info("Forcing completion of stalled iframe document", {
            category: "dom",
            url: (m.url ?? "").slice(0, 120),
          });
        }
      }
      maybeQuiet();
    }, 500);

    maybeQuiet();

    const guard = setTimeout(() => {
      if (inflight.size) {
        logger.info("DOM settle timeout reached with network requests still pending", {
          category: "dom",
          count: inflight.size,
        });
      }
      resolveDone();
    }, remainingBudget);

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
