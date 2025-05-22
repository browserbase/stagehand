import { Page, Locator } from "@playwright/test";
import { PlaywrightCommandException } from "../../../types/playwright";
import { StagehandPage } from "../../StagehandPage";
import { getNodeFromXpath } from "@/lib/dom/utils";
import { Logger } from "../../../types/log";
import { MethodHandlerContext } from "@/types/act";
import { StagehandClickError } from "@/types/stagehandErrors";

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
};

export async function scrollToNextChunk(ctx: MethodHandlerContext) {
  const { stagehandPage, xpath, logger } = ctx;

  logger({
    category: "action",
    message: "scrolling to next chunk",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  try {
    await stagehandPage.page.evaluate(
      ({ xpath }) => {
        const elementNode = getNodeFromXpath(xpath);
        if (!elementNode || elementNode.nodeType !== Node.ELEMENT_NODE) {
          console.warn(`Could not locate element to scroll by its height.`);
          return Promise.resolve();
        }

        const element = elementNode as HTMLElement;
        const tagName = element.tagName.toLowerCase();
        let height: number;

        if (tagName === "html" || tagName === "body") {
          height = window.visualViewport.height;
          window.scrollBy({
            top: height,
            left: 0,
            behavior: "smooth",
          });

          const scrollingEl =
            document.scrollingElement || document.documentElement;
          return window.waitForElementScrollEnd(scrollingEl as HTMLElement);
        } else {
          height = element.getBoundingClientRect().height;
          element.scrollBy({
            top: height,
            left: 0,
            behavior: "smooth",
          });

          return window.waitForElementScrollEnd(element);
        }
      },
      { xpath },
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
  const { stagehandPage, xpath, logger } = ctx;

  logger({
    category: "action",
    message: "scrolling to previous chunk",
    level: 2,
    auxiliary: {
      xpath: { value: xpath, type: "string" },
    },
  });

  try {
    await stagehandPage.page.evaluate(
      ({ xpath }) => {
        const elementNode = getNodeFromXpath(xpath);
        if (!elementNode || elementNode.nodeType !== Node.ELEMENT_NODE) {
          console.warn(`Could not locate element to scroll by its height.`);
          return Promise.resolve();
        }

        const element = elementNode as HTMLElement;
        const tagName = element.tagName.toLowerCase();
        let height: number;

        if (tagName === "html" || tagName === "body") {
          height = window.visualViewport.height;
          window.scrollBy({
            top: -height,
            left: 0,
            behavior: "smooth",
          });

          const scrollingEl =
            document.scrollingElement || document.documentElement;
          return window.waitForElementScrollEnd(scrollingEl as HTMLElement);
        } else {
          height = element.getBoundingClientRect().height;
          element.scrollBy({
            top: -height,
            left: 0,
            behavior: "smooth",
          });
          return window.waitForElementScrollEnd(element);
        }
      },
      { xpath },
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
  const { args, stagehandPage, xpath, logger } = ctx;

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

    await stagehandPage.page.evaluate(
      ({ xpath, yArg }) => {
        function parsePercent(val: string): number {
          const cleaned = val.trim().replace("%", "");
          const num = parseFloat(cleaned);
          return Number.isNaN(num) ? 0 : Math.max(0, Math.min(num, 100));
        }

        const elementNode = getNodeFromXpath(xpath);
        if (!elementNode || elementNode.nodeType !== Node.ELEMENT_NODE) {
          console.warn(`Could not locate element to scroll on.`);
          return;
        }

        const element = elementNode as HTMLElement;
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
      { xpath, yArg },
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
    await locator.evaluate((el) => {
      (el as HTMLElement).click();
    });
  } catch (e) {
    logger({
      category: "action",
      message: "error performing click",
      level: 1,
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
    await newOpenedTab.close();
    await stagehandPage.page.goto(newOpenedTab.url());
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
