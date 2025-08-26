// lib/v3/handlers/handlerUtils/actHandlerUtils.ts
import { Protocol } from "devtools-protocol";
import { Frame } from "../../understudy/frame";
import { Locator } from "../../understudy/locator";
import { LogLine } from "@/types/log";
import { StagehandClickError } from "@/types/stagehandErrors";

type LoggerFn = (line: LogLine) => void;

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
  logger: LoggerFn;
  frame: Frame;
  initialUrl: string;
  domSettleTimeoutMs?: number;
}

export async function performUnderstudyMethod(
  frame: Frame,
  method: string,
  rawXPath: string,
  args: ReadonlyArray<unknown>,
  logger: LoggerFn,
  domSettleTimeoutMs?: number,
): Promise<void> {
  const xpath = rawXPath.replace(/^xpath=/i, "").trim();
  const locator = frame.locator(`xpath=${xpath}`);

  const initialUrl = await getFrameUrl(frame);

  logger({
    category: "action",
    message: "performing understudy method",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
      method: { value: method, type: "string" },
    },
  });

  const ctx: UnderstudyMethodHandlerContext = {
    method,
    locator,
    xpath,
    args: args.map((a) => (a == null ? "" : String(a))),
    logger,
    frame,
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
          logger({
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

    await waitForSettledDom(frame, domSettleTimeoutMs);
    await handlePossibleNavigation("action", xpath, initialUrl, frame, logger);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger({
      category: "action",
      message: "error performing method",
      level: 1,
      auxiliary: {
        error: { value: msg, type: "string" },
        trace: { value: stack ?? "", type: "string" },
        method: { value: method, type: "string" },
        xpath: { value: xpath, type: "string" },
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
  scrollTo: scrollElementToPercentage,
  scroll: scrollElementToPercentage,
  "mouse.wheel": wheelScroll,
  fill: fillOrType,
  type: typeText,
  press: pressKey,
  click: clickElement,
  nextChunk: scrollToNextChunk,
  prevChunk: scrollToPreviousChunk,
};

async function scrollIntoView(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath, logger, frame } = ctx;
  logger({
    category: "action",
    message: "scrolling element into view",
    level: 2,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });
  const { nodeId } = await locator.resolveNode(); // private; expose via a safe helper if you prefer
  await frame.session.send("DOM.scrollIntoViewIfNeeded", { nodeId });
}

async function scrollElementToPercentage(
  ctx: UnderstudyMethodHandlerContext,
): Promise<void> {
  const { locator, xpath, logger, args, frame } = ctx;
  logger({
    category: "action",
    message: "scrolling element vertically to specified percentage",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
      coordinate: { value: JSON.stringify(args), type: "string" },
    },
  });

  const [yArg = "0%"] = args;
  const { objectId } = await locator.resolveNode();
  try {
    await frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: `
          function(yArg) {
            function parsePercent(val) {
              const cleaned = String(val).trim().replace("%", "");
              const num = parseFloat(cleaned);
              return Number.isNaN(num) ? 0 : Math.max(0, Math.min(num, 100));
            }
            const yPct = parsePercent(yArg);

            if (this.tagName && (this.tagName.toLowerCase() === "html" || this.tagName.toLowerCase() === "body")) {
              const scrollHeight = document.body.scrollHeight;
              const viewportHeight = window.innerHeight;
              const scrollTop = (scrollHeight - viewportHeight) * (yPct / 100);
              window.scrollTo({ top: scrollTop, left: window.scrollX, behavior: "smooth" });
            } else {
              const scrollHeight = this.scrollHeight ?? 0;
              const clientHeight = this.clientHeight ?? 0;
              const scrollTop = (scrollHeight - clientHeight) * (yPct / 100);
              this.scrollTo({ top: scrollTop, left: this.scrollLeft ?? 0, behavior: "smooth" });
            }
          }
        `,
        arguments: [{ value: yArg }],
        returnByValue: true,
      },
    );
  } finally {
    await frame.session.send("Runtime.releaseObject", { objectId });
  }
}

async function wheelScroll(ctx: UnderstudyMethodHandlerContext): Promise<void> {
  const { frame, args, logger } = ctx;
  const deltaY = Number(args[0] ?? 200);
  logger({
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
  const { locator, xpath, args, logger } = ctx;
  try {
    await locator.fill(""); // clear
    await locator.fill(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger({
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
  const { locator, xpath, args, logger } = ctx;
  try {
    await locator.type(args[0] ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger({
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
  const { frame, args, logger, xpath } = ctx;
  const key = args[0] ?? "";
  try {
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
    logger({
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
  const { locator, logger } = ctx;
  try {
    await locator.click();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger({
      category: "action",
      message: "error performing click",
      level: 0,
      auxiliary: { error: { value: msg, type: "string" } },
    });
    throw new StagehandClickError(ctx.xpath, msg);
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
  const { locator, logger, xpath, frame } = ctx;
  logger({
    category: "action",
    message:
      direction > 0 ? "scrolling to next chunk" : "scrolling to previous chunk",
    level: 2,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });

  const { objectId } = await locator.resolveNode();
  try {
    await frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
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
    await frame.session.send("Runtime.releaseObject", { objectId });
  }
}

/* ===================== Helpers ===================== */

async function getFrameUrl(frame: Frame): Promise<string> {
  // Evaluate from within the frame's isolated world
  const url = await frame.evaluate<string>("location.href");
  return url;
}

async function waitForSettledDom(
  frame: Frame,
  timeoutMs?: number,
): Promise<void> {
  // Best-effort: wait for networkidle lifecycle event or a small quiet delay
  const timeout = typeof timeoutMs === "number" ? timeoutMs : 5_000;

  await frame.session.send("Page.enable");

  const done = new Promise<void>((resolve) => {
    const handler = (evt: Protocol.Page.LifecycleEventEvent) => {
      if (
        evt.frameId === frame.frameId &&
        (evt.name === "networkIdle" || evt.name === "networkidle")
      ) {
        frame.session.off("Page.lifecycleEvent", handler);
        resolve();
      }
    };
    frame.session.on("Page.lifecycleEvent", handler);
    setTimeout(() => {
      frame.session.off("Page.lifecycleEvent", handler);
      resolve();
    }, timeout);
  });

  await done;
}

async function handlePossibleNavigation(
  actionDescription: string,
  xpath: string,
  initialUrl: string,
  frame: Frame,
  logger: LoggerFn,
): Promise<void> {
  logger({
    category: "action",
    message: `${actionDescription}, checking for page navigation`,
    level: 1,
    auxiliary: { xpath: { value: xpath, type: "string" } },
  });

  // We only have a frame-scoped session, so detect navigation by URL change.
  const afterUrl = await getFrameUrl(frame);

  if (afterUrl !== initialUrl) {
    logger({
      category: "action",
      message: "new page (frame) URL detected",
      level: 1,
      auxiliary: { url: { value: afterUrl, type: "string" } },
    });
  }
}
