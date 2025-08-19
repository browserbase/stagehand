import { Page, Locator, FrameLocator } from "playwright";
import { PlaywrightCommandException } from "../../../types/playwright";
import { StagehandPage } from "../../StagehandPage";
import { Logger } from "../../../types/log";
import { MethodHandlerContext } from "@/types/act";
import {
  StagehandClickError,
  StagehandShadowRootMissingError,
  StagehandShadowSegmentEmptyError,
  StagehandShadowSegmentNotFoundError,
} from "@/types/stagehandErrors";

const IFRAME_STEP_RE = /^iframe(\[[^\]]+])?$/i;

function stepToCss(step: string): string {
  const m = step.match(/^([a-zA-Z*][\w-]*)(?:\[(\d+)])?$/);
  if (!m) return step;
  const [, tag, idxRaw] = m;
  const idx = idxRaw ? Number(idxRaw) : null;
  if (tag === "*") return idx ? `*:nth-child(${idx})` : `*`;
  return idx ? `${tag}:nth-of-type(${idx})` : tag;
}

const buildDirect = (steps: string[]) => steps.map(stepToCss).join(" > ");
const buildDesc = (steps: string[]) => steps.map(stepToCss).join(" ");

/** Resolve one contiguous shadow segment and return a stable Locator. */
async function resolveShadowSegment(
  hostLoc: Locator,
  shadowSteps: string[],
  attr = "data-__stagehand-id",
  timeout = 1500,
): Promise<Locator> {
  const direct = buildDirect(shadowSteps);
  const desc = buildDesc(shadowSteps);

  type Result = { id: string | null; noRoot: boolean };

  const { id, noRoot } = await hostLoc.evaluate<
    Result,
    { direct: string; desc: string; attr: string; timeout: number }
  >(
    (host, { direct, desc, attr, timeout }) => {
      interface StagehandClosedAccess {
        getClosedRoot?: (h: Element) => ShadowRoot | undefined;
      }
      const backdoor = (
        window as Window & {
          __stagehand__?: StagehandClosedAccess;
        }
      ).__stagehand__;

      const root =
        (host as HTMLElement).shadowRoot ?? backdoor?.getClosedRoot?.(host);
      if (!root) return { id: null, noRoot: true };

      const tryFind = () =>
        (root.querySelector(direct) as Element | null) ??
        (root.querySelector(desc) as Element | null);

      return new Promise<Result>((resolve) => {
        const mark = (el: Element): Result => {
          let v = el.getAttribute(attr);
          if (!v) {
            v =
              "sh_" +
              Math.random().toString(36).slice(2) +
              Date.now().toString(36);
            el.setAttribute(attr, v);
          }
          return { id: v, noRoot: false };
        };

        const first = tryFind();
        if (first) return resolve(mark(first));

        const start = Date.now();
        const tick = () => {
          const el = tryFind();
          if (el) return resolve(mark(el));
          if (Date.now() - start >= timeout)
            return resolve({ id: null, noRoot: false });
          setTimeout(tick, 50);
        };
        tick();
      });
    },
    { direct, desc, attr, timeout },
  );

  if (noRoot) {
    throw new StagehandShadowRootMissingError(
      `segment='${shadowSteps.join("/")}'`,
    );
  }
  if (!id) {
    throw new StagehandShadowSegmentNotFoundError(shadowSteps.join("/"));
  }

  return hostLoc.locator(`stagehand=${id}`);
}

export async function deepLocatorWithShadow(
  root: Page | FrameLocator,
  xpath: string,
): Promise<Locator> {
  // 1 ─ prepend with slash if not already included
  if (!xpath.startsWith("/")) xpath = "/" + xpath;
  const tokens = xpath.split("/"); // keep "" from "//"

  let ctx: Page | FrameLocator | Locator = root;
  let buffer: string[] = [];
  let elementScoped = false;

  const xp = () => (elementScoped ? "xpath=./" : "xpath=/");

  const flushIntoFrame = () => {
    if (!buffer.length) return;
    ctx = (ctx as Page | FrameLocator | Locator).frameLocator(
      xp() + buffer.join("/"),
    );
    buffer = [];
    elementScoped = false;
  };

  const flushIntoLocator = () => {
    if (!buffer.length) return;
    ctx = (ctx as Page | FrameLocator | Locator).locator(
      xp() + buffer.join("/"),
    );
    buffer = [];
    elementScoped = true;
  };

  for (let i = 1; i < tokens.length; i++) {
    const step = tokens[i];

    // Shadow hop: “//”
    if (step === "") {
      flushIntoLocator();

      // collect full shadow segment until next hop/iframe/end
      const seg: string[] = [];
      let j = i + 1;
      for (; j < tokens.length; j++) {
        const t = tokens[j];
        if (t === "" || IFRAME_STEP_RE.test(t)) break;
        seg.push(t);
      }
      if (!seg.length) throw new StagehandShadowSegmentEmptyError();

      // resolve inside the shadow root
      ctx = await resolveShadowSegment(ctx as Locator, seg);
      elementScoped = true;

      i = j - 1;
      continue;
    }

    // Normal DOM step
    buffer.push(step);

    // iframe hop → descend into frame
    if (IFRAME_STEP_RE.test(step)) flushIntoFrame();
  }

  if (buffer.length === 0) {
    // If we’re already element-scoped, we already have the final Locator.
    if (elementScoped) return ctx as Locator;

    // Otherwise (page/frame scoped), return the root element of the current doc.
    return (ctx as Page | FrameLocator).locator("xpath=/");
  }

  // Otherwise, resolve the remaining buffered steps.
  return (ctx as Page | FrameLocator | Locator).locator(
    xp() + buffer.join("/"),
  );
}

export function deepLocator(root: Page | FrameLocator, xpath: string): Locator {
  // 1 ─ prepend with slash if not already included
  if (!xpath.startsWith("/")) xpath = "/" + xpath;

  // 2 ─ split into steps, accumulate until we hit an iframe step
  const steps = xpath.split("/").filter(Boolean); // tokens
  let ctx: Page | FrameLocator = root;
  let buffer: string[] = [];

  const flushIntoFrame = () => {
    if (buffer.length === 0) return;
    const selector = "xpath=/" + buffer.join("/");
    ctx = (ctx as Page | FrameLocator).frameLocator(selector);
    buffer = [];
  };

  for (const step of steps) {
    buffer.push(step);
    if (IFRAME_STEP_RE.test(step)) {
      // we've included the <iframe> element in buffer ⇒ descend
      flushIntoFrame();
    }
  }

  // 3 ─ whatever is left in buffer addresses the target *inside* the last ctx
  const finalSelector = "xpath=/" + buffer.join("/");
  return (ctx as Page | FrameLocator).locator(finalSelector);
}

/**
 * A mapping of playwright methods that may be chosen by the LLM to their
 * implementation.
 */
export const methodHandlerMap: Record<
  string,
  (ctx: MethodHandlerContext) => Promise<void>
> = {
  scrollIntoView: scrollElementIntoView,
  scrollTo: scrollElementToPercentage,
  scroll: scrollElementToPercentage,
  "mouse.wheel": scrollElementToPercentage,
  fill: fillOrType,
  type: fillOrType,
  press: pressKey,
  click: clickElement,
  nextChunk: scrollToNextChunk,
  prevChunk: scrollToPreviousChunk,
  selectOptionFromDropdown: selectOption,
};

export async function scrollToNextChunk(ctx: MethodHandlerContext) {
  const { locator, logger, xpath } = ctx;

  logger({
    category: "action",
    message: "scrolling to next chunk",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  try {
    await locator.evaluate(
      (element) => {
        const waitForScrollEnd = (el: HTMLElement | Element) =>
          new Promise<void>((resolve) => {
            let last = el.scrollTop ?? 0;
            const check = () => {
              const cur = el.scrollTop ?? 0;
              if (cur === last) return resolve();
              last = cur;
              requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });

        const tagName = element.tagName.toLowerCase();

        if (tagName === "html" || tagName === "body") {
          const height = window.visualViewport?.height ?? window.innerHeight;

          window.scrollBy({ top: height, left: 0, behavior: "smooth" });

          const scrollingRoot = (document.scrollingElement ??
            document.documentElement) as HTMLElement;

          return waitForScrollEnd(scrollingRoot);
        }

        const height = (element as HTMLElement).getBoundingClientRect().height;

        (element as HTMLElement).scrollBy({
          top: height,
          left: 0,
          behavior: "smooth",
        });

        return waitForScrollEnd(element);
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (e) {
    logger({
      category: "action",
      message: "error scrolling to next chunk",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function scrollToPreviousChunk(ctx: MethodHandlerContext) {
  const { locator, logger, xpath } = ctx;

  logger({
    category: "action",
    message: "scrolling to previous chunk",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  try {
    await locator.evaluate(
      (element) => {
        const waitForScrollEnd = (el: HTMLElement | Element) =>
          new Promise<void>((resolve) => {
            let last = el.scrollTop ?? 0;
            const check = () => {
              const cur = el.scrollTop ?? 0;
              if (cur === last) return resolve();
              last = cur;
              requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });

        const tagName = element.tagName.toLowerCase();

        if (tagName === "html" || tagName === "body") {
          const height = window.visualViewport?.height ?? window.innerHeight;
          window.scrollBy({ top: -height, left: 0, behavior: "smooth" });

          const rootScrollingEl = (document.scrollingElement ??
            document.documentElement) as HTMLElement;

          return waitForScrollEnd(rootScrollingEl);
        }
        const height = (element as HTMLElement).getBoundingClientRect().height;
        (element as HTMLElement).scrollBy({
          top: -height,
          left: 0,
          behavior: "smooth",
        });
        return waitForScrollEnd(element);
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (e) {
    logger({
      category: "action",
      message: "error scrolling to previous chunk",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function scrollElementIntoView(ctx: MethodHandlerContext) {
  const { locator, xpath, logger } = ctx;

  logger({
    category: "action",
    message: "scrolling element into view",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  try {
    await locator.evaluate((element: HTMLElement) => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  } catch (e) {
    logger({
      category: "action",
      message: "error scrolling element into view",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function scrollElementToPercentage(ctx: MethodHandlerContext) {
  const { args, xpath, logger, locator } = ctx;

  logger({
    category: "action",
    message: "scrolling element vertically to specified percentage",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
      coordinate: { value: JSON.stringify(args), type: "string" },
    },
  });

  try {
    const [yArg = "0%"] = args as string[];

    await locator.evaluate<void, { yArg: string }>(
      (element, { yArg }) => {
        function parsePercent(val: string): number {
          const cleaned = val.trim().replace("%", "");
          const num = parseFloat(cleaned);
          return Number.isNaN(num) ? 0 : Math.max(0, Math.min(num, 100));
        }

        const yPct = parsePercent(yArg);

        if (element.tagName.toLowerCase() === "html") {
          const scrollHeight = document.body.scrollHeight;
          const viewportHeight = window.innerHeight;
          const scrollTop = (scrollHeight - viewportHeight) * (yPct / 100);
          window.scrollTo({
            top: scrollTop,
            left: window.scrollX,
            behavior: "smooth",
          });
        } else {
          const scrollHeight = element.scrollHeight;
          const clientHeight = element.clientHeight;
          const scrollTop = (scrollHeight - clientHeight) * (yPct / 100);
          element.scrollTo({
            top: scrollTop,
            left: element.scrollLeft,
            behavior: "smooth",
          });
        }
      },
      { yArg },
      { timeout: 10_000 },
    );
  } catch (e) {
    logger({
      category: "action",
      message: "error scrolling element vertically to percentage",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
        args: { value: JSON.stringify(args), type: "object" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function fillOrType(ctx: MethodHandlerContext) {
  const { locator, xpath, args, logger } = ctx;

  try {
    await locator.fill("", { force: true });
    const text = args[0]?.toString() || "";
    await locator.fill(text, { force: true });
  } catch (e) {
    logger({
      category: "action",
      message: "error filling element",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function pressKey(ctx: MethodHandlerContext) {
  const {
    locator,
    xpath,
    args,
    logger,
    stagehandPage,
    initialUrl,
    domSettleTimeoutMs,
  } = ctx;
  try {
    const key = args[0]?.toString() ?? "";
    await locator.page().keyboard.press(key);

    await handlePossiblePageNavigation(
      "press",
      xpath,
      initialUrl,
      stagehandPage,
      logger,
      domSettleTimeoutMs,
    );
  } catch (e) {
    logger({
      category: "action",
      message: "error pressing key",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        key: { value: args[0]?.toString() ?? "unknown", type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function selectOption(ctx: MethodHandlerContext) {
  const { locator, xpath, args, logger } = ctx;
  try {
    const text = args[0]?.toString() || "";
    await locator.selectOption(text, { timeout: 5000 });
  } catch (e) {
    logger({
      category: "action",
      message: "error selecting option",
      level: 0,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

export async function clickElement(ctx: MethodHandlerContext) {
  const {
    locator,
    xpath,
    args,
    logger,
    stagehandPage,
    initialUrl,
    domSettleTimeoutMs,
  } = ctx;

  logger({
    category: "action",
    message: "page URL before click",
    level: 2,
    auxiliary: {
      url: {
        value: stagehandPage.page.url(),
        type: "string",
      },
    },
  });

  try {
    await locator.click({ timeout: 3_500 });
  } catch (e) {
    logger({
      category: "action",
      message: "Playwright click failed, falling back to JS click",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
        method: { value: "click", type: "string" },
        args: { value: JSON.stringify(args), type: "object" },
      },
    });

    try {
      await locator.evaluate((el) => (el as HTMLElement).click(), undefined, {
        timeout: 3_500,
      });
    } catch (e) {
      logger({
        category: "action",
        message: "error performing click (JS fallback)",
        level: 0,
        auxiliary: {
          error: { value: e.message, type: "string" },
          trace: { value: e.stack, type: "string" },
          xpath: { value: xpath, type: "string" },
          method: { value: "click", type: "string" },
          args: { value: JSON.stringify(args), type: "object" },
        },
      });
      throw new StagehandClickError(xpath, e.message);
    }
  }

  await handlePossiblePageNavigation(
    "click",
    xpath,
    initialUrl,
    stagehandPage,
    logger,
    domSettleTimeoutMs,
  );
}

/**
 * Fallback method: if method is not in our map but *is* a valid Playwright locator method.
 */
export async function fallbackLocatorMethod(ctx: MethodHandlerContext) {
  const { locator, xpath, method, args, logger } = ctx;

  logger({
    category: "action",
    message: "page URL before action",
    level: 2,
    auxiliary: {
      url: { value: locator.page().url(), type: "string" },
    },
  });

  try {
    await (
      locator[method as keyof Locator] as unknown as (
        ...a: string[]
      ) => Promise<void>
    )(...args.map((arg) => arg?.toString() || ""));
  } catch (e) {
    logger({
      category: "action",
      message: "error performing method",
      level: 1,
      auxiliary: {
        error: { value: e.message, type: "string" },
        trace: { value: e.stack, type: "string" },
        xpath: { value: xpath, type: "string" },
        method: { value: method, type: "string" },
        args: { value: JSON.stringify(args), type: "object" },
      },
    });
    throw new PlaywrightCommandException(e.message);
  }
}

async function handlePossiblePageNavigation(
  actionDescription: string,
  xpath: string,
  initialUrl: string,
  stagehandPage: StagehandPage,
  logger: Logger,
  domSettleTimeoutMs?: number,
): Promise<void> {
  logger({
    category: "action",
    message: `${actionDescription}, checking for page navigation`,
    level: 1,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  const newOpenedTab = await Promise.race([
    new Promise<Page | null>((resolve) => {
      stagehandPage.context.once("page", (page) => resolve(page));
      setTimeout(() => resolve(null), 1500);
    }),
  ]);

  logger({
    category: "action",
    message: `${actionDescription} complete`,
    level: 1,
    auxiliary: {
      newOpenedTab: {
        value: newOpenedTab ? "opened a new tab" : "no new tabs opened",
        type: "string",
      },
    },
  });

  if (newOpenedTab && newOpenedTab.url() !== "about:blank") {
    logger({
      category: "action",
      message: "new page detected (new tab) with URL",
      level: 1,
      auxiliary: {
        url: { value: newOpenedTab.url(), type: "string" },
      },
    });
    await stagehandPage.page.waitForLoadState("domcontentloaded");
  }

  try {
    await stagehandPage._waitForSettledDom(domSettleTimeoutMs);
  } catch (e) {
    logger({
      category: "action",
      message: "wait for settled DOM timeout hit",
      level: 1,
      auxiliary: {
        trace: { value: e.stack, type: "string" },
        message: { value: e.message, type: "string" },
      },
    });
  }

  logger({
    category: "action",
    message: "finished waiting for (possible) page navigation",
    level: 1,
  });

  if (stagehandPage.page.url() !== initialUrl) {
    logger({
      category: "action",
      message: "new page detected with URL",
      level: 1,
      auxiliary: {
        url: { value: stagehandPage.page.url(), type: "string" },
      },
    });
  }
}
