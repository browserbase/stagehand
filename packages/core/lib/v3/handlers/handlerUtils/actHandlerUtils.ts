// lib/v3/handlers/handlerUtils/actHandlerUtils.ts
import { Protocol } from "devtools-protocol";
import { Frame } from "../../understudy/frame.js";
import { Locator } from "../../understudy/locator.js";
import { MouseButton } from "../../types/public/locator.js";
import {
  resolveLocatorTarget,
  resolveLocatorWithHops,
} from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import { v3Logger } from "../../logger.js";
import { FlowLogger } from "../../flowlogger/FlowLogger.js";
import { toTitleCase } from "../../../utils.js";
import {
  StagehandClickError,
  UnderstudyCommandException,
} from "../../types/public/sdkErrors.js";

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

function isRetryableFrameError(message: string): boolean {
  return /No frame for given id found|main world not ready for frame|Unable to obtain a content frame/i.test(
    message,
  );
}

function isDocumentRootSelector(selector: string): boolean {
  const normalized = String(selector ?? "").trim().toLowerCase();
  return (
    normalized === "/" ||
    normalized === "/html" ||
    normalized === "xpath=/" ||
    normalized === "xpath=/html"
  );
}

const FIRST_TEXT_ENTRY_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  "textarea:not([disabled])",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(", ");

function hintedIframeTextSelector(title: string | null): string | null {
  const normalized = title?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes("card number")) {
    return 'input[name="number"]';
  }
  if (
    normalized.includes("expiration date") ||
    normalized.includes("expiry")
  ) {
    return 'input[name="expiry"]';
  }
  if (
    normalized.includes("security code") ||
    normalized.includes("verification") ||
    normalized.includes("cvv")
  ) {
    return 'input[name="verification_value"]';
  }
  if (normalized.includes("name on card")) {
    return 'input[name="name"]';
  }
  return null;
}

async function readLocatorAttribute(
  locator: Locator,
  attributeName: string,
): Promise<string | null> {
  const session = locator.getFrame().session;
  const { objectId } = await locator.resolveNode();
  try {
    const result = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: `
          function(attributeName) {
            try {
              return this.getAttribute ? this.getAttribute(attributeName) : null;
            } catch {
              return null;
            }
          }
        `,
        arguments: [{ value: attributeName }],
        returnByValue: true,
      },
    );
    return typeof result.result.value === "string"
      ? result.result.value
      : null;
  } finally {
    await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

async function setFrameTextEntryValue(
  frame: Frame,
  selector: string,
  value: string,
): Promise<boolean> {
  return frame.evaluate(
    ({ selector, value }: { selector: string; value: string }) => {
      try {
        const element = document.querySelector(selector);
        if (!element) return false;

        const doc = element.ownerDocument || document;
        const win = doc.defaultView || window;

        const dispatchEvents = () => {
          let inputEvent: Event;
          if (typeof win.InputEvent === "function") {
            try {
              inputEvent = new win.InputEvent("input", {
                bubbles: true,
                composed: true,
                data: value,
                inputType: "insertText",
              });
            } catch {
              inputEvent = new win.Event("input", {
                bubbles: true,
                composed: true,
              });
            }
          } else {
            inputEvent = new win.Event("input", {
              bubbles: true,
              composed: true,
            });
          }
          element.dispatchEvent(inputEvent);
          element.dispatchEvent(
            new win.Event("change", { bubbles: true }),
          );
        };

        if (
          element instanceof win.HTMLInputElement ||
          element instanceof win.HTMLTextAreaElement
        ) {
          const prototype =
            element instanceof win.HTMLInputElement
              ? win.HTMLInputElement.prototype
              : win.HTMLTextAreaElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
          const nativeSetter = descriptor?.set;
          if (typeof nativeSetter === "function") {
            nativeSetter.call(element, value);
          } else {
            element.value = value;
          }

          const tracker = (
            element as HTMLInputElement & {
              _valueTracker?: { setValue?: (next: string) => void };
            }
          )._valueTracker;
          tracker?.setValue?.(value);

          dispatchEvents();
          return true;
        }

        if (
          element instanceof win.HTMLElement &&
          element.isContentEditable
        ) {
          element.textContent = value;
          dispatchEvents();
          return true;
        }

        return false;
      } catch {
        return false;
      }
    },
    { selector, value },
  );
}

export async function performUnderstudyMethod(
  page: Page,
  frame: Frame,
  method: string,
  rawXPath: string,
  args: ReadonlyArray<unknown>,
  domSettleTimeoutMs?: number,
): Promise<void> {
  const selectorRaw = normalizeRootXPath(rawXPath);
  const normalizedArgs = args.map((a) => (a == null ? "" : String(a)));
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await FlowLogger.runWithLogging(
        {
          eventType: `Understudy${toTitleCase(method)}`, // e.g. "UnderstudyClick"
          data: {
            target: selectorRaw,
          },
        },
        async () => {
          // Unified resolver: supports '>>' hops and XPath across iframes.
          const target = await resolveLocatorTarget(
            page,
            frame,
            selectorRaw,
          );
          let locator = new Locator(target.frame, target.selector);

          // If the model chose an iframe host for a typing action, retarget to
          // the first text-entry control inside the iframe's document.
          if (
            (method === "type" || method === "fill") &&
            isDocumentRootSelector(target.selector)
          ) {
            const hostLocator = new Locator(frame, selectorRaw);
            let hostTitle: string | null = null;
            try {
              hostTitle = await readLocatorAttribute(hostLocator, "title");
            } catch {
              hostTitle = null;
            }
            try {
              await hostLocator.click();
              await page.waitForTimeout(75);
            } catch (error) {
              v3Logger({
                category: "action",
                message: "failed to activate iframe host before typing",
                level: 1,
                auxiliary: {
                  xpath: { value: selectorRaw, type: "string" },
                  error: {
                    value:
                      error instanceof Error ? error.message : String(error),
                    type: "string",
                  },
                },
              });
            }
            const hintedSelector = hintedIframeTextSelector(hostTitle);
            if (hintedSelector) {
              const directValue = normalizedArgs[0] ?? "";
              const setDirectly = await setFrameTextEntryValue(
                target.frame,
                hintedSelector,
                directValue,
              );
              if (setDirectly) {
                const iframeSettleMs = Math.min(
                  500,
                  Math.max(250, domSettleTimeoutMs ?? 500),
                );
                // Shopify briefly re-stabilizes PCI iframe hosts after each
                // successful card-field update. Without a short pause here,
                // the next agent tool can snapshot the checkout mid-refresh
                // and fail to reacquire the following iframe.
                await page.waitForTimeout(iframeSettleMs);
                return;
              }
            }
            locator = target.frame
              .locator(hintedSelector ?? FIRST_TEXT_ENTRY_SELECTOR)
              .first();
          }

          const initialUrl = await getFrameUrl(frame);

          v3Logger({
            category: "action",
            message: "performing understudy method",
            level: 2,
            auxiliary: {
              xpath: { value: selectorRaw, type: "string" },
              method: { value: method, type: "string" },
              url: { value: initialUrl, type: "string" },
              attempt: { value: String(attempt), type: "string" },
            },
          });

          const ctx: UnderstudyMethodHandlerContext = {
            method,
            locator,
            xpath: selectorRaw,
            args: normalizedArgs,
            frame,
            page,
            initialUrl,
            domSettleTimeoutMs,
          };
          const handler = METHOD_HANDLER_MAP[method] ?? null;

          if (handler) {
            await handler(ctx);
            return;
          }

          v3Logger({
            category: "action",
            message: "chosen method is invalid",
            level: 1,
            auxiliary: { method: { value: method, type: "string" } },
          });
          throw new UnderstudyCommandException(`Method ${method} not supported`);
        },
        args,
      );
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;

      if (attempt < maxAttempts && isRetryableFrameError(msg)) {
        const delayMs = attempt * 250;
        v3Logger({
          category: "action",
          message: "retrying understudy method after frame instability",
          level: 1,
          auxiliary: {
            error: { value: msg, type: "string" },
            method: { value: method, type: "string" },
            xpath: { value: selectorRaw, type: "string" },
            attempt: { value: `${attempt}/${maxAttempts}`, type: "string" },
            delayMs: { value: String(delayMs), type: "string" },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

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
      if (e instanceof UnderstudyCommandException) {
        throw e;
      }
      throw new UnderstudyCommandException(msg, e);
    }
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
  hover: hover,
};

export async function selectOption(ctx: UnderstudyMethodHandlerContext) {
  const { locator, xpath, args } = ctx;
  try {
    const text = args[0]?.toString() || "";
    await locator.selectOption(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    v3Logger({
      category: "action",
      message: "error selecting option",
      level: 0,
      auxiliary: {
        error: { value: msg, type: "string" },
        trace: { value: stack ?? "", type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new UnderstudyCommandException(msg, e);
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
    const msg = e instanceof Error ? e.message : String(e);
    throw new UnderstudyCommandException(msg, e);
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
    throw new UnderstudyCommandException(msg, e);
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
    throw new UnderstudyCommandException(msg, e);
  }
}

async function pressKey(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { args, xpath, page } = ctx;
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
    throw new UnderstudyCommandException(msg, e);
  }
}

async function clickElement(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath, args } = ctx;
  try {
    await locator.click({ button: (args[0] as MouseButton) || undefined });
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
    throw new UnderstudyCommandException(msg, e);
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
    throw new UnderstudyCommandException(msg, e);
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
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    v3Logger({
      category: "action",
      message: "error attempting to hover",
      level: 0,
      auxiliary: {
        error: { value: msg, type: "string" },
        trace: { value: stack ?? "", type: "string" },
        xpath: { value: xpath, type: "string" },
      },
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
