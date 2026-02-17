// lib/v3/handlers/handlerUtils/actHandlerUtils.ts
import { Protocol } from "devtools-protocol";
import type { EventBus } from "../../bubus";
import { Frame } from "../../understudy/frame";
import { Locator } from "../../understudy/locator";
import { MouseButton } from "../../types/public/locator";
import { resolveLocatorWithHops } from "../../understudy/deepLocator";
import type { Page } from "../../understudy/page";
import { v3Logger } from "../../logger";
import { SessionFileLogger } from "../../flowLogger";
import {
  USClickEvent,
  USDoubleClickEvent,
  USDragAndDropEvent,
  USFillEvent,
  USHoverEvent,
  USMouseWheelEvent,
  USNextChunkEvent,
  USPressEvent,
  USPrevChunkEvent,
  USScrollByPixelOffsetEvent,
  USScrollEvent,
  USScrollIntoViewEvent,
  USSelectOptionFromDropdownEvent,
  USTypeEvent,
} from "../../types/public/events";
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
  args: ReadonlyArray<unknown>;
  frame: Frame;
  page: Page;
  initialUrl: string;
  domSettleTimeoutMs?: number;
  eventsEnabled: boolean;
}

// Normalize cases where the XPath is the root "/" to point to the HTML element.
function normalizeRootXPath(input: string): string {
  const s = String(input ?? "").trim();
  if (s === "/") return "/html";
  if (/^xpath=\/$/i.test(s)) return "xpath=/html";
  return s;
}

function emitUnderstudyMethodEvent(
  bus: EventBus,
  {
    targetId,
    frameId,
    method,
    selector,
    args,
    domSettleTimeoutMs,
  }: {
    targetId: string;
    frameId: string;
    method: string;
    selector: string;
    args: ReadonlyArray<unknown>;
    domSettleTimeoutMs?: number;
  },
): ReturnType<EventBus["emit"]> | null {
  const base = {
    TargetId: targetId,
    FrameId: frameId,
    Selector: selector,
    DomSettleTimeoutMs: domSettleTimeoutMs,
  };

  switch (method) {
    case "click":
      return bus.emit(
        USClickEvent({
          ...base,
          Button: args[0] as "left" | "right" | "middle" | undefined,
          ClickCount:
            typeof args[1] === "number"
              ? args[1]
              : Number.isFinite(Number(args[1]))
                ? Number(args[1])
                : undefined,
        } as any),
      );
    case "fill":
      return bus.emit(
        USFillEvent({
          ...base,
          Value: String(args[0] ?? ""),
        } as any),
      );
    case "type":
      return bus.emit(
        USTypeEvent({
          ...base,
          Text: String(args[0] ?? ""),
          DelayMs:
            typeof args[1] === "number"
              ? args[1]
              : Number.isFinite(Number(args[1]))
                ? Number(args[1])
                : undefined,
        } as any),
      );
    case "press":
      return bus.emit(
        USPressEvent({
          ...base,
          Key: String(args[0] ?? ""),
        } as any),
      );
    case "scrollTo":
    case "scroll":
      return bus.emit(
        USScrollEvent({
          ...base,
          Percent: (args[0] as string | number | undefined) ?? "0%",
        } as any),
      );
    case "scrollIntoView":
      return bus.emit(USScrollIntoViewEvent(base));
    case "scrollByPixelOffset":
      return bus.emit(
        USScrollByPixelOffsetEvent({
          ...base,
          DeltaX: Number(args[0] ?? 0),
          DeltaY: Number(args[1] ?? 0),
        } as any),
      );
    case "mouse.wheel":
      return bus.emit(
        USMouseWheelEvent({
          ...base,
          DeltaY: Number(args[0] ?? 200),
        } as any),
      );
    case "nextChunk":
      return bus.emit(USNextChunkEvent(base));
    case "prevChunk":
      return bus.emit(USPrevChunkEvent(base));
    case "selectOptionFromDropdown":
    case "selectOption":
      {
        const raw = args[0];
        const optionTexts = Array.isArray(raw)
          ? raw.map((value) => String(value))
          : [String(raw ?? "")];
      return bus.emit(
        USSelectOptionFromDropdownEvent({
          ...base,
            OptionText: optionTexts[0] ?? "",
            OptionTexts: optionTexts,
        } as any),
      );
      }
    case "hover":
      return bus.emit(USHoverEvent(base));
    case "doubleClick":
      return bus.emit(USDoubleClickEvent(base));
    case "dragAndDrop":
      return bus.emit(
        USDragAndDropEvent({
          ...base,
          ToSelector: String(args[0] ?? ""),
        } as any),
      );
    default:
      return null;
  }
}

export async function performUnderstudyMethod(
  page: Page,
  frame: Frame,
  method: string,
  rawXPath: string,
  args: ReadonlyArray<unknown>,
  domSettleTimeoutMs?: number,
  useEventBus: boolean = true,
): Promise<unknown> {
  const selectorRaw = normalizeRootXPath(rawXPath);

  if (useEventBus) {
    const bus = page.getUnderstudyEventBus();
    if (bus) {
      const event = emitUnderstudyMethodEvent(bus, {
        targetId: page.targetId(),
        frameId: frame.frameId,
        method,
        selector: selectorRaw,
        args,
        domSettleTimeoutMs,
      });

      if (event) {
        const results = await event.eventResultsList({
          raise_if_any: true,
          raise_if_none: true,
        });
        return results[0];
      }
    }
  }

  // Unified resolver: supports '>>' hops and XPath across iframes
  const locator: Locator = await resolveLocatorWithHops(
    page,
    frame,
    selectorRaw,
    { eventsEnabled: useEventBus },
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
    args: args.map((a) => (a == null ? "" : a)),
    frame,
    page,
    initialUrl,
    domSettleTimeoutMs,
    eventsEnabled: useEventBus,
  };

  SessionFileLogger.logUnderstudyActionEvent({
    actionType: `Understudy.${method}`,
    target: selectorRaw,
    args: Array.from(args),
  });

  try {
    const handler = METHOD_HANDLER_MAP[method] ?? null;
    let result: unknown;

    if (handler) {
      result = await handler(ctx);
    } else {
      // Accept a few common locator method aliases
      switch (method) {
        case "click":
          result = await clickElement(ctx);
          break;
        case "fill":
          result = await fillOrType(ctx);
          break;
        case "type":
          result = await typeText(ctx);
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
    return result;
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
  } finally {
    SessionFileLogger.logUnderstudyActionCompleted();
  }
}

/* ===================== Handlers & Map ===================== */

const METHOD_HANDLER_MAP: Record<
  string,
  (ctx: UnderstudyMethodHandlerContext) => Promise<unknown>
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
  hover: hover,
};

export async function selectOption(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath, args } = ctx;
  try {
    let values: string | string[] = args[0]?.toString() || "";
    if (Array.isArray(args[0])) {
      values = args[0].map((value) => value.toString());
    }
    return await locator.selectOption(values);
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

  const raw = args[0];
  const yArg =
    typeof raw === "number" || typeof raw === "string" ? raw : String(raw ?? "0%");
  await locator.scrollTo(yArg);
}

/** Scroll the page by pixel offset, starting from the element's center. */
async function scrollByPixelOffset(
  ctx: UnderstudyMethodHandlerContext,
): Promise<string> {
  const { locator, page, args } = ctx;
  const dx = Number(args[0] ?? 0);
  const dy = Number(args[1] ?? 0);

  try {
    const { x, y } = await locator.centroid();
    return await page.scroll(x, y, dx, dy);
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
    await locator.fill(String(args[0] ?? ""));
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
    const text = String(args[0] ?? "");
    const rawDelay = Number(args[1]);
    const delay =
      Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : undefined;
    await locator.type(text, delay === undefined ? undefined : { delay });
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
  const { args, xpath, page } = ctx;
  const key = String(args[0] ?? "");
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
    await page.keyPress(key);
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
  const { locator, xpath, args } = ctx;
  try {
    const rawClickCount =
      args.length > 1 ? Number(args[1]) : Number.NaN;
    const clickCount =
      Number.isFinite(rawClickCount) && rawClickCount > 0
        ? Math.floor(rawClickCount)
        : undefined;

    await locator.click({
      button: (args[0] as MouseButton) || undefined,
      clickCount,
    });
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

async function dragAndDrop(
  ctx: UnderstudyMethodHandlerContext,
): Promise<[string, string]> {
  const { page, frame, locator, args, xpath, eventsEnabled } = ctx;
  const toXPath = String(args[0] ?? "").trim();
  if (!toXPath)
    throw new UnderstudyCommandException(
      "dragAndDrop requires a target XPath arg",
    );

  const targetLocator = await resolveLocatorWithHops(page, frame, toXPath, {
    eventsEnabled,
  });

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
    return await page.dragAndDrop(fromAbs.x, fromAbs.y, toAbs.x, toAbs.y, {
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

export async function hover(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath } = ctx;
  try {
    await locator.hover();
  } catch (e) {
    v3Logger({
      category: "action",
      message: "error attempting to hover",
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
  timeoutMs?: number,
): Promise<void> {
  const overallTimeout =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? Math.max(0, timeoutMs)
      : 5_000;
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
    await frame
      .waitForLoadState("domcontentloaded", overallTimeout)
      .catch(() => {});
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
