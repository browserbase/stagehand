import { generateXPathsForElement as generateXPaths } from "./xpathUtils";
import { calculateViewportHeight } from "./utils";
import { Page, ElementHandle } from "playwright";
import { getAccessibilityInfo } from "./accessibility";

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim());
}

export async function processDom(chunksSeen: Array<number>, page?: Page) {
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  const { outputString, selectorMap } = await processElements(
    chunk,
    true,
    0,
    page,
  );

  console.log(
    `Stagehand (Browser Process): Extracted dom elements:\n${outputString}`,
  );

  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

export async function processAllOfDom(page?: Page) {
  console.log("Stagehand (Browser Process): Processing all of DOM");

  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  let index = 0;
  const results = [];
  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const result = await processElements(chunk, true, index, page);
    results.push(result);
    index += Object.keys(result.selectorMap).length;
  }

  await scrollToHeight(0);

  const allOutputString = results.map((result) => result.outputString).join("");
  const allSelectorMap = results.reduce(
    (acc, result) => ({ ...acc, ...result.selectorMap }),
    {},
  );

  console.log(
    `Stagehand (Browser Process): All dom elements: ${allOutputString}`,
  );

  return {
    outputString: allOutputString,
    selectorMap: allSelectorMap,
  };
}

export async function scrollToHeight(height: number) {
  window.scrollTo({ top: height, left: 0, behavior: "smooth" });

  // Wait for scrolling to finish using the scrollend event
  await new Promise<void>((resolve) => {
    let scrollEndTimer: number;
    const handleScrollEnd = () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        window.removeEventListener("scroll", handleScrollEnd);
        resolve();
      }, 100);
    };

    window.addEventListener("scroll", handleScrollEnd, { passive: true });
    handleScrollEnd();
  });
}

const xpathCache: Map<Node, string[]> = new Map();

export async function processElements(
  chunk: number,
  scrollToChunk: boolean = true,
  indexOffset: number = 0,
  page?: Page,
): Promise<{
  outputString: string;
  selectorMap: Record<number, string[]>;
}> {
  console.time("processElements:total");
  const viewportHeight = calculateViewportHeight();
  const chunkHeight = viewportHeight * chunk;

  // Calculate the maximum scrollable offset
  const maxScrollTop = document.documentElement.scrollHeight - viewportHeight;

  // Adjust the offsetTop to not exceed the maximum scrollable offset
  const offsetTop = Math.min(chunkHeight, maxScrollTop);

  if (scrollToChunk) {
    console.time("processElements:scroll");
    await scrollToHeight(offsetTop);
    console.timeEnd("processElements:scroll");
  }

  const candidateElements: Array<ChildNode> = [];
  const DOMQueue: Array<ChildNode> = [...document.body.childNodes];

  console.log("Stagehand (Browser Process): Generating candidate elements");
  console.time("processElements:findCandidates");

  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();

    let shouldAddElement = false;

    if (element && isElementNode(element)) {
      const childrenCount = element.childNodes.length;

      // Always traverse child nodes
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.childNodes[i];
        DOMQueue.push(child as ChildNode);
      }

      // Check if element is interactive
      if (await isInteractiveElement(element, page)) {
        if (isActive(element) && (await isVisible(element, page))) {
          shouldAddElement = true;
        }
      }

      if (isLeafElement(element)) {
        if (isActive(element) && (await isVisible(element, page))) {
          shouldAddElement = true;
        }
      }
    }

    if (element && isTextNode(element) && isTextVisible(element)) {
      shouldAddElement = true;
    }

    if (shouldAddElement) {
      candidateElements.push(element);
    }
  }

  console.timeEnd("processElements:findCandidates");

  const selectorMap: Record<number, string[]> = {};
  let outputString = "";

  console.log(
    `Stagehand (Browser Process): Processing candidate elements: ${candidateElements.length}`,
  );

  console.time("processElements:processCandidates");
  console.time("processElements:generateXPaths");
  const xpathLists = await Promise.all(
    candidateElements.map(async (element) => {
      if (xpathCache.has(element)) {
        return xpathCache.get(element);
      }

      const xpaths = await generateXPaths(element);
      xpathCache.set(element, xpaths);
      return xpaths;
    }),
  );
  console.timeEnd("processElements:generateXPaths");

  // Process elements sequentially to handle async operations
  for (let i = 0; i < candidateElements.length; i++) {
    const element = candidateElements[i];
    const xpaths = xpathLists[i];
    let elementOutput = "";

    if (isTextNode(element)) {
      const textContent = element.textContent?.trim();
      if (textContent) {
        elementOutput += `${i + indexOffset}:${textContent}\n`;
      }
    } else if (isElementNode(element)) {
      const tagName = element.tagName.toLowerCase();
      const attributes = await collectEssentialAttributes(element, page);

      const openingTag = `<${tagName}${attributes ? " " + attributes : ""}>`;
      const closingTag = `</${tagName}>`;
      const textContent = element.textContent?.trim() || "";

      elementOutput += `${i + indexOffset}:${openingTag}${textContent}${closingTag}\n`;
    }

    outputString += elementOutput;
    selectorMap[i + indexOffset] = xpaths;
  }
  console.timeEnd("processElements:processCandidates");

  console.timeEnd("processElements:total");
  return {
    outputString,
    selectorMap,
  };
}

/**
 * Collects essential attributes from an element.
 * @param element The DOM element.
 * @returns A string of formatted attributes.
 */
async function collectEssentialAttributes(
  element: Element,
  page?: Page,
): Promise<string> {
  const essentialAttributes = [
    "id",
    "class",
    "href",
    "src",
    "aria-label",
    "aria-name",
    "aria-role",
    "aria-description",
    "aria-expanded",
    "aria-haspopup",
    "type",
    "value",
  ];

  const attrs: string[] = essentialAttributes
    .map((attr) => {
      const value = element.getAttribute(attr);
      return value ? `${attr}="${value}"` : "";
    })
    .filter((attr) => attr !== "");

  // Collect data- attributes
  Array.from(element.attributes).forEach((attr) => {
    if (attr.name.startsWith("data-")) {
      attrs.push(`${attr.name}="${attr.value}"`);
    }
  });

  // Add accessibility information if page is available
  if (page) {
    try {
      const accessibilityInfo = await getAccessibilityInfo(
        page,
        element as unknown as ElementHandle<Element>,
      );
      if (accessibilityInfo.role) {
        attrs.push(`accessibility-role="${accessibilityInfo.role}"`);
      }
      if (accessibilityInfo.name) {
        attrs.push(`accessibility-name="${accessibilityInfo.name}"`);
      }
      if (accessibilityInfo.description) {
        attrs.push(
          `accessibility-description="${accessibilityInfo.description}"`,
        );
      }
    } catch (error) {
      console.warn("Failed to get accessibility info:", error);
    }
  }

  return attrs.join(" ");
}

window.processDom = processDom;
window.processAllOfDom = processAllOfDom;
window.processElements = processElements;
window.scrollToHeight = scrollToHeight;

const leafElementDenyList = ["SVG", "IFRAME", "SCRIPT", "STYLE", "LINK"];

const interactiveElementTypes = [
  "A",
  "BUTTON",
  "DETAILS",
  "EMBED",
  "INPUT",
  "LABEL",
  "MENU",
  "MENUITEM",
  "OBJECT",
  "SELECT",
  "TEXTAREA",
  "SUMMARY",
];

const interactiveRoles = [
  "button",
  "menu",
  "menuitem",
  "link",
  "checkbox",
  "radio",
  "slider",
  "tab",
  "tabpanel",
  "textbox",
  "combobox",
  "grid",
  "listbox",
  "option",
  "progressbar",
  "scrollbar",
  "searchbox",
  "switch",
  "tree",
  "treeitem",
  "spinbutton",
  "tooltip",
];

const interactiveAriaRoles = [
  "button",
  "link",
  "menuitem",
  "checkbox",
  "radio",
  "tab",
  "menuitemcheckbox",
  "menuitemradio",
  "textbox",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "scrollbar",
];

/*
 * Checks if an element is visible and therefore relevant for LLMs to consider. We check:
 * - Size
 * - Display properties
 * - Opacity
 * If the element is a child of a previously hidden element, it should not be included, so we don't consider downstream effects of a parent element here
 */
const isVisible = async (element: Element, page?: Page) => {
  const rect = element.getBoundingClientRect();
  // Ensure the element is within the viewport
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    rect.top < 0 ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  if (!isTopElement(element, rect)) {
    return false;
  }

  // Add accessibility visibility check
  if (page) {
    try {
      const accessibilityInfo = await getAccessibilityInfo(
        page,
        element as unknown as ElementHandle<Element>,
      );
      // Check if element is explicitly hidden in accessibility tree
      if (accessibilityInfo && !accessibilityInfo.focused) {
        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return false;
        }
      }
    } catch (error) {
      console.warn(
        "Failed to get accessibility info for visibility check:",
        error,
      );
    }
  }

  const visible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return visible;
};

const isTextVisible = (element: ChildNode) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();

  if (
    rect.width === 0 ||
    rect.height === 0 ||
    rect.top < 0 ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  const parent = element.parentElement;
  if (!parent) {
    return false;
  }
  if (!isTopElement(parent, rect)) {
    return false;
  }

  const visible = parent.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return visible;
};

function isTopElement(elem: ChildNode, rect: DOMRect) {
  const points = [
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  ];

  return points.some((point) => {
    const topEl = document.elementFromPoint(point.x, point.y);
    let current = topEl;
    while (current && current !== document.body) {
      if (current.isSameNode(elem)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  });
}

const isActive = (element: Element) => {
  if (
    element.hasAttribute("disabled") ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  return true;
};
const isInteractiveElement = async (element: Element, page?: Page) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute("role");
  const elementAriaRole = element.getAttribute("aria-role");

  // Check accessibility tree if page is available
  if (page) {
    try {
      const accessibilityInfo = await getAccessibilityInfo(
        page,
        element as unknown as ElementHandle<Element>,
      );
      if (
        accessibilityInfo.role &&
        interactiveRoles.includes(accessibilityInfo.role)
      ) {
        return true;
      }
    } catch (error) {
      console.warn(
        "Failed to get accessibility info for interactive check:",
        error,
      );
    }
  }

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

const isLeafElement = (element: Element) => {
  if (element.textContent === "") {
    return false;
  }

  if (element.childNodes.length === 0) {
    return !leafElementDenyList.includes(element.tagName);
  }

  // This case ensures that extra context will be included for simple element nodes that contain only text
  if (element.childNodes.length === 1 && isTextNode(element.childNodes[0])) {
    return true;
  }

  return false;
};

async function pickChunk(chunksSeen: Array<number>) {
  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;

  const chunks = Math.ceil(documentHeight / viewportHeight);

  const chunksArray = Array.from({ length: chunks }, (_, i) => i);
  const chunksRemaining = chunksArray.filter((chunk) => {
    return !chunksSeen.includes(chunk);
  });

  const currentScrollPosition = window.scrollY;
  const closestChunk = chunksRemaining.reduce((closest, current) => {
    const currentChunkTop = viewportHeight * current;
    const closestChunkTop = viewportHeight * closest;
    return Math.abs(currentScrollPosition - currentChunkTop) <
      Math.abs(currentScrollPosition - closestChunkTop)
      ? current
      : closest;
  }, chunksRemaining[0]);
  const chunk = closestChunk;

  if (chunk === undefined) {
    throw new Error(`No chunks remaining to check: ${chunksRemaining}`);
  }
  return {
    chunk,
    chunksArray,
  };
}
