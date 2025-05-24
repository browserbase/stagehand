import { StagehandDomProcessError } from "@/types/stagehandErrors";

/**
 * Tests if the element actually responds to .scrollTo(...)
 * and that scrollTop changes as expected.
 */
export function canElementScroll(elem: HTMLElement): boolean {
  // Quick check if scrollTo is a function
  if (typeof elem.scrollTo !== "function") {
    console.warn("canElementScroll: .scrollTo is not a function.");
    return false;
  }

  try {
    const originalTop = elem.scrollTop;

    // try to scroll
    elem.scrollTo({
      top: originalTop + 100,
      left: 0,
      behavior: "instant",
    });

    // If scrollTop never changed, consider it unscrollable
    if (elem.scrollTop === originalTop) {
      throw new StagehandDomProcessError("scrollTop did not change");
    }

    // Scroll back to original place
    elem.scrollTo({
      top: originalTop,
      left: 0,
      behavior: "instant",
    });

    return true;
  } catch (error) {
    console.warn("canElementScroll error:", (error as Error).message || error);
    return false;
  }
}

export function getNodeFromXpath(xpath: string) {
  return document.evaluate(
    xpath,
    document.documentElement,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue;
}

export function waitForElementScrollEnd(
  element: HTMLElement,
  idleMs = 100,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let scrollEndTimer: number | undefined;

    const handleScroll = () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        element.removeEventListener("scroll", handleScroll);
        resolve();
      }, idleMs);
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
  });
}
