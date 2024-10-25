export async function processDom(chunksSeen: Array<number>) {
  console.log("[BROWSERBASE] Processing DOM");
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  console.log("[BROWSERBASE] Picked chunk", chunk, chunksArray);
  console.log("[BROWSERBASE] Processing elements");
  const { outputString, selectorMap } = await processElements(chunk);
  console.log("[BROWSERBASE] Processed elements", outputString);

  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

export async function processAllOfDom() {
  console.log("[BROWSERBASE] Processing all of DOM");

  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  const chunkPromises = Array.from({ length: totalChunks }, (_, chunk) =>
    processElements(chunk, false),
  );

  const results = await Promise.all(chunkPromises);

  const allOutputString = results.map((result) => result.outputString).join("");
  const allSelectorMap = results.reduce(
    (acc, result) => ({ ...acc, ...result.selectorMap }),
    {},
  );

  console.log("[BROWSERBASE] Processed all elements");
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
      }, 200);
    };

    window.addEventListener("scroll", handleScrollEnd, { passive: true });
    handleScrollEnd();
  });
}

export async function processElements(
  chunk: number,
  scrollToChunk: boolean = true,
) {
  const viewportHeight = window.innerHeight;
  const chunkHeight = viewportHeight * chunk;

  // Calculate the maximum scrollable offset
  const maxScrollTop =
    document.documentElement.scrollHeight - window.innerHeight;

  // Adjust the offsetTop to not exceed the maximum scrollable offset
  const offsetTop = Math.min(chunkHeight, maxScrollTop);

  if (scrollToChunk) {
  await scrollToHeight(offsetTop);
  }

  const candidateElements: Array<ChildNode> = [];
  const xpathCache: Map<Node, string> = new Map();

  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (isElementNode(node)) {
          return (isInteractiveElement(node) || isLeafElement(node)) &&
            isActive(node) &&
            isVisible(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        } else if (isTextNode(node)) {
          return isTextVisible(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_SKIP;
      },
    },
  );

  let currentNode: Node | null = treeWalker.currentNode;
  while ((currentNode = treeWalker.nextNode())) {
    candidateElements.push(currentNode as ChildNode);
    }

  const selectorMap: Record<number, string> = {};
  const outputArray: string[] = [];

  candidateElements.forEach((element, index) => {
    let xpath = xpathCache.get(element);
    if (!xpath) {
      xpath = generateXPath(element);
      xpathCache.set(element, xpath);
    }

    if (isTextNode(element)) {
      const textContent = element.textContent?.trim();
      if (textContent) {
        outputArray.push(`${index}:${textContent}`);
      }
    } else if (isElementNode(element)) {
      const tagName = element.tagName.toLowerCase();
      const attributes = collectEssentialAttributes(element);

      const openingTag = `<${tagName}${attributes ? " " + attributes : ""}>`;
      const closingTag = `</${tagName}>`;
      const textContent = element.textContent?.trim() || "";

      outputArray.push(`${index}:${openingTag}${textContent}${closingTag}`);
    }

    selectorMap[index] = xpath;
  });

  const outputString = outputArray.join("\n");

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
function collectEssentialAttributes(element: Element): string {
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

  return attrs.join(" ");
}

window.processDom = processDom;
window.processAllOfDom = processAllOfDom;
window.processElements = processElements;
window.scrollToHeight = scrollToHeight;

export function generateXPath(element: ChildNode): string {
  if (isElementNode(element) && element.id) {
    return `//*[@id='${element.id}']`;
  }

  const parts: string[] = [];
  while (element && (isTextNode(element) || isElementNode(element))) {
    let index = 0;
    let hasSameTypeSiblings = false;
    const siblings = element.parentElement
      ? Array.from(element.parentElement.childNodes)
      : [];

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];

      if (
        sibling.nodeType === element.nodeType &&
        sibling.nodeName === element.nodeName
      ) {
        index = index + 1;
        hasSameTypeSiblings = true;

        if (sibling.isSameNode(element)) {
          break;
        }
      }
    }

    // text "nodes" are selected differently than elements with xPaths
    if (element.nodeName !== "#text") {
      const tagName = element.nodeName.toLowerCase();
      const pathIndex = hasSameTypeSiblings ? `[${index}]` : "";
      parts.unshift(`${tagName}${pathIndex}`);
    }

    element = element.parentElement as HTMLElement;
  }

  return parts.length ? `/${parts.join("/")}` : "";
}

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
const interactiveAriaRoles = ["menu", "menuitem", "button"];

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  // trim all white space and make sure the text node is non empty to consider it legit
  const trimmedText = node.textContent?.trim().replace(/\s/g, "");
  return node.nodeType === Node.TEXT_NODE && trimmedText !== "";
}

/*
 * Checks if an element is visible and therefore relevant for LLMs to consider. We check:
 * - size
 * - display properties
 * - opacity
 * If the element is a child of a previously hidden element, it should not be included, so we don't consider downstream effects of a parent element here
 */
export const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  // this number is relative to scroll, so we shouldn't be using an absolute offset, we can use the viewport height
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    // we take elements by their starting top. so if you start before our offset, or after our offset, you don't count!
    rect.top < 0 ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  if (!isTopElement(element, rect)) {
    return false;
  }

  const isVisible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return isVisible;
};

export const isTextVisible = (element: ChildNode) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();

  if (
    rect.width === 0 ||
    rect.height === 0 ||
    // we take elements by their starting top. so if you start before our offset, or after our offset, you don't count!
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

  const isVisible = parent.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return isVisible;
};

export function isTopElement(elem: ChildNode, rect: DOMRect) {
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

export const isActive = (element: Element) => {
  if (
    element.hasAttribute("disabled") ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  return true;
};
export const isInteractiveElement = (element: Element) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute("role");
  const elementAriaRole = element.getAttribute("aria-role");

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

export const isLeafElement = (element: Element) => {
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

export async function pickChunk(chunksSeen: Array<number>) {
  const viewportHeight = window.innerHeight;
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
    throw new Error(`no chunks remaining to check ${chunksRemaining}, `);
  }
  return {
    chunk,
    chunksArray,
  };
}
