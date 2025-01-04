import { generateXPathsForElement as generateXPaths } from "./xpathUtils";
import { calculateViewportHeight } from "./utils";

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim());
}

/**
 * Extended visibility result interface to also capture the reason for non-visibility.
 */
interface VisibilityResult {
  visible: boolean;
  reason: string;
}

export async function processDom(chunksSeen: Array<number>) {
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  const { outputString, selectorMap } = await processElements(chunk);

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

export async function processAllOfDom() {
  console.log("Stagehand (Browser Process): Processing all of DOM");

  const viewportHeight = calculateViewportHeight();
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  let index = 0;
  const results = [];
  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const result = await processElements(chunk, true, index);
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

function getIFrameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    // Attempt to read same-origin iframe
    if (iframe.contentDocument) {
      return iframe.contentDocument;
    }
    if (iframe.contentWindow?.document) {
      return iframe.contentWindow.document;
    }
  } catch (error) {
    // Cross-origin iframes will throw here
    console.warn(
      "Could not access iframe document (likely cross-origin).",
      error,
    );
  }
  return null;
}

export async function processElements(
  chunk: number,
  scrollToChunk = true,
  indexOffset = 0,
  debug = false,
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
    if (!element) continue;

    let shouldAddElement = false;
    let skipReason = "";

    if (isElementNode(element)) {
      const tagName = element.tagName.toLowerCase();

      if (debug) {
        console.debug(`[Debug] Checking element: <${tagName}>`, element);
      }

      if (tagName === "iframe") {
        const iframeDoc = getIFrameDocument(element as HTMLIFrameElement);
        if (iframeDoc && iframeDoc.body) {
          if (debug) {
            console.debug(
              "[Debug] [IFrame] Found same-origin iframe document:",
              iframeDoc,
            );
          }
          DOMQueue.push(...Array.from(iframeDoc.body.childNodes));
        } else {
          console.warn(`Skipping cross-origin iframe: ${element}`);
        }
      }

      // Always traverse child nodes
      const childrenCount = element.childNodes.length;
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.childNodes[i];
        DOMQueue.push(child as ChildNode);
      }

      // Check if element is interactive or leaf
      const interactive = isInteractiveElement(element);
      const active = isActive(element);
      const visibility = isVisible(element);
      const isLeaf = isLeafElement(element);

      if (debug) {
        console.debug(
          `[Debug] <${tagName}>: interactive=${interactive}, active=${active}, visible=${visibility.visible}, leaf=${isLeaf}, visibilityReason=${visibility.reason}`,
        );
      }

      if (interactive) {
        if (!active) {
          skipReason = "Interactive element is not active";
        } else if (!visibility.visible) {
          skipReason = `Interactive element is not visible: ${visibility.reason}`;
        } else {
          shouldAddElement = true;
        }
      } else if (isLeaf) {
        if (!active) {
          skipReason = "Leaf element is not active";
        } else if (!visibility.visible) {
          skipReason = `Leaf element is not visible: ${visibility.reason}`;
        } else {
          shouldAddElement = true;
        }
      } else {
        skipReason = "Element is neither interactive nor leaf";
      }
    } else if (isTextNode(element)) {
      const visibility = isTextVisible(element); // returns { visible: boolean, reason: string }

      if (debug) {
        const textPreview =
          element.textContent?.trim().substring(0, 50) +
          (element.textContent?.length > 50 ? "..." : "");
        console.debug(
          `[Debug] Checking TEXT NODE: "${textPreview}" visible=${visibility.visible}, visibilityReason=${visibility.reason}`,
          element,
        );
      }

      if (!visibility.visible) {
        skipReason = `Text node is not visible: ${visibility.reason}`;
      } else {
        shouldAddElement = true;
      }
    } else {
      skipReason = "Node is neither an element nor a text node";
    }

    if (shouldAddElement) {
      if (debug) {
        if (isElementNode(element)) {
          console.info(
            `[Debug] ✅ Element accepted: <${element.tagName.toLowerCase()}>`,
            element,
          );
        } else if (isTextNode(element)) {
          const textPreview =
            element.textContent?.trim().substring(0, 50) +
            (element.textContent?.length > 50 ? "..." : "");
          console.info(
            `[Debug] ✅ Text node accepted: "${textPreview}"`,
            element,
          );
        }
      }
      candidateElements.push(element);
    } else if (debug) {
      if (isElementNode(element)) {
        console.info(
          `[Debug] ❌ Element skipped: <${element.tagName.toLowerCase()}> - Reason: ${skipReason}`,
          element,
        );
      } else if (isTextNode(element)) {
        const textPreview =
          element.textContent?.trim().substring(0, 50) +
          (element.textContent?.length > 50 ? "..." : "");
        console.info(
          `[Debug] ❌ Text node skipped: "${textPreview}" - Reason: ${skipReason}`,
          element,
        );
      } else {
        console.info(
          `[Debug] ❌ Node skipped - Reason: ${skipReason}`,
          element,
        );
      }
    }
  }

  console.timeEnd("processElements:findCandidates");

  console.log(
    `Stagehand (Browser Process): Processing candidate elements: ${candidateElements.length}`,
  );

  const selectorMap: Record<number, string[]> = {};
  let outputString = "";

  console.time("processElements:processCandidates");
  console.time("processElements:generateXPaths");
  const xpathLists = await Promise.all(
    candidateElements.map(async (element) => {
      if (xpathCache.has(element)) {
        return xpathCache.get(element);
      }
      // generateXPaths is your function that's able to build "iframe-aware" XPaths
      const xpaths = await generateXPaths(element);
      xpathCache.set(element, xpaths);
      return xpaths;
    }),
  );
  console.timeEnd("processElements:generateXPaths");

  candidateElements.forEach((element, index) => {
    const xpaths = xpathLists[index] || [];
    let elementOutput = "";

    if (isTextNode(element)) {
      const textContent = element.textContent?.trim();
      if (textContent) {
        elementOutput += `${index + indexOffset}:${textContent}\n`;
        if (debug) {
          console.debug(
            `[Debug] Outputting text node at index ${index + indexOffset}:`,
            textContent,
          );
        }
      }
    } else if (isElementNode(element)) {
      const tagName = element.tagName.toLowerCase();
      const attributes = collectEssentialAttributes(element);

      const openingTag = `<${tagName}${attributes ? " " + attributes : ""}>`;
      const closingTag = `</${tagName}>`;
      const textContent = element.textContent?.trim() || "";

      elementOutput += `${index + indexOffset}:${openingTag}${textContent}${closingTag}\n`;
      if (debug) {
        console.debug(
          `[Debug] Outputting element at index ${
            index + indexOffset
          }: <${tagName}> + text: "${textContent}"`,
        );
      }
    }

    outputString += elementOutput;
    selectorMap[index + indexOffset] = xpaths;
  });
  console.timeEnd("processElements:processCandidates");

  if (debug) {
    window.drawChunk(selectorMap, true);
  }

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

  return attrs.join(" ");
}

export function storeDOM(): string {
  const originalDOM = document.body.cloneNode(true) as HTMLElement;
  console.log("DOM state stored.");
  return originalDOM.outerHTML;
}

export function restoreDOM(storedDOM: string): void {
  console.log("Restoring DOM");
  if (storedDOM) {
    document.body.innerHTML = storedDOM;
  } else {
    console.error("No DOM state was provided.");
  }
}

export function createTextBoundingBoxes(): void {
  const style = document.createElement("style");
  document.head.appendChild(style);
  if (style.sheet) {
    style.sheet.insertRule(
      `
      .stagehand-highlighted-word, .stagehand-space {
        border: 0px solid orange;
        display: inline-block !important;
        visibility: visible;
      }
    `,
      0,
    );

    style.sheet.insertRule(
      `
        code .stagehand-highlighted-word, code .stagehand-space,
        pre .stagehand-highlighted-word, pre .stagehand-space {
          white-space: pre-wrap;
          display: inline !important;
      }
     `,
      1,
    );
  }

  function applyHighlighting(root: Document | HTMLElement): void {
    root.querySelectorAll("body *").forEach((element) => {
      if (element.closest(".stagehand-nav, .stagehand-marker")) {
        return;
      }
      if (
        ["SCRIPT", "STYLE", "IFRAME", "INPUT", "TEXTAREA"].includes(
          element.tagName,
        )
      ) {
        return;
      }

      const childNodes = Array.from(element.childNodes);
      childNodes.forEach((node) => {
        if (node.nodeType === 3 && node.textContent?.trim().length > 0) {
          const textContent = node.textContent.replace(/\u00A0/g, " ");
          const tokens = textContent.split(/(\s+)/g); // Split text by spaces
          const fragment = document.createDocumentFragment();
          const parentIsCode = element.tagName === "CODE";

          tokens.forEach((token) => {
            const span = document.createElement("span");
            span.textContent = token;
            if (parentIsCode) {
              // Special handling for <code> tags
              span.style.whiteSpace = "pre-wrap";
              span.style.display = "inline";
            }
            span.className =
              token.trim().length === 0
                ? "stagehand-space"
                : "stagehand-highlighted-word";
            fragment.appendChild(span);
          });

          if (fragment.childNodes.length > 0 && node.parentNode) {
            element.insertBefore(fragment, node);
            node.remove();
          }
        }
      });
    });
  }

  applyHighlighting(document);

  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage({ action: "highlight" }, "*");
    } catch (error) {
      console.error("Error accessing iframe content: ", error);
    }
  });
}

export function getElementBoundingBoxes(xpath: string): Array<{
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
}> {
  const element = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue as HTMLElement;

  if (!element) return [];

  const isValidText = (text: string) => text && text.trim().length > 0;
  let dropDownElem = element.querySelector("option[selected]");

  if (!dropDownElem) {
    dropDownElem = element.querySelector("option");
  }

  if (dropDownElem) {
    const elemText = dropDownElem.textContent || "";
    if (isValidText(elemText)) {
      const parentRect = element.getBoundingClientRect();
      return [
        {
          text: elemText.trim(),
          top: parentRect.top + window.scrollY,
          left: parentRect.left + window.scrollX,
          width: parentRect.width,
          height: parentRect.height,
        },
      ];
    } else {
      return [];
    }
  }

  let placeholderText = "";
  if (
    (element.tagName.toLowerCase() === "input" ||
      element.tagName.toLowerCase() === "textarea") &&
    (element as HTMLInputElement).placeholder
  ) {
    placeholderText = (element as HTMLInputElement).placeholder;
  } else if (element.tagName.toLowerCase() === "a") {
    placeholderText = "";
  } else if (element.tagName.toLowerCase() === "img") {
    placeholderText = (element as HTMLImageElement).alt || "";
  }

  const words = element.querySelectorAll(
    ".stagehand-highlighted-word",
  ) as NodeListOf<HTMLElement>;

  const boundingBoxes = Array.from(words)
    .map((word) => {
      const rect = word.getBoundingClientRect();
      return {
        text: word.innerText || "",
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height * 0.75,
      };
    })
    .filter(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        box.top >= 0 &&
        box.left >= 0 &&
        isValidText(box.text),
    );

  if (boundingBoxes.length === 0) {
    const elementRect = element.getBoundingClientRect();
    return [
      {
        text: placeholderText,
        top: elementRect.top + window.scrollY,
        left: elementRect.left + window.scrollX,
        width: elementRect.width,
        height: elementRect.height * 0.75,
      },
    ];
  }

  return boundingBoxes;
}

window.processDom = processDom;
window.processAllOfDom = processAllOfDom;
window.processElements = processElements;
window.scrollToHeight = scrollToHeight;
window.storeDOM = storeDOM;
window.restoreDOM = restoreDOM;
window.createTextBoundingBoxes = createTextBoundingBoxes;
window.getElementBoundingBoxes = getElementBoundingBoxes;

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

/**
 * Utility to transform an Element’s boundingClientRect into the “top” window’s coordinate system.
 */
function getGlobalRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();

  let doc = element.ownerDocument;
  let win = doc.defaultView;
  let offsetX = rect.left;
  let offsetY = rect.top;

  while (win && win !== window.top) {
    const frameElem = win.frameElement as HTMLIFrameElement | null;
    if (!frameElem) {
      // Not in an iframe or no further frames up
      break;
    }

    // Get the iframe’s position in its parent doc:
    const frameRect = frameElem.getBoundingClientRect();
    offsetX += frameRect.left;
    offsetY += frameRect.top;

    doc = frameElem.ownerDocument;
    win = doc.defaultView;
  }

  // Build a “global” DOMRect-like object
  return {
    x: offsetX,
    y: offsetY,
    width: rect.width,
    height: rect.height,
    left: offsetX,
    top: offsetY,
    right: offsetX + rect.width,
    bottom: offsetY + rect.height,
    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    },
  } as DOMRect;
}

/**
 * Recursively check if each iframe up the chain is topmost in its parent.
 * If we’ve reached the top-level document, return true.
 */
function isIFrameOnTop(element: Element): boolean {
  const doc = element.ownerDocument;
  const frameElem = doc.defaultView?.frameElement as HTMLIFrameElement | null;
  if (!frameElem) {
    // We’re in the top window already (no <iframe>).
    return true;
  }

  // If we are in an iframe, check that that iframe is topmost in its parent doc
  const parentDoc = frameElem.ownerDocument;
  const iframeRect = frameElem.getBoundingClientRect();

  // We can reuse isTopElement logic on the parent doc, but note it’ll be in the parent’s coordinate system
  // This ensures the iframe itself is not obscured in the parent.
  if (!isTopElement(frameElem, iframeRect, parentDoc)) {
    return false;
  }

  // Recurse upwards in case the parent doc is also in an iframe
  return isIFrameOnTop(frameElem);
}

/**
 * Checks if an element is visible and therefore relevant for LLMs to consider
 * (size, display properties, opacity, if it’s top-element in local doc, and iframe is top-element in parent).
 * Returns an object with { visible: boolean, reason: string }.
 */
export function isVisible(element: Element): VisibilityResult {
  const doc = element.ownerDocument;
  if (!doc) return { visible: false, reason: "No ownerDocument found" };

  const rect = element.getBoundingClientRect();

  // Basic checks for zero-size
  if (rect.width === 0 || rect.height === 0) {
    return {
      visible: false,
      reason: "Element has zero width or height",
    };
  }

  // Convert local doc coordinates into main-page coordinates
  const globalRect = getGlobalRect(element);
  const winTop = window.top;
  if (!winTop) {
    return {
      visible: false,
      reason: "No top-level window found",
    };
  }

  const topWinWidth = winTop.innerWidth;
  const topWinHeight = winTop.innerHeight;
  // If it’s placed well outside the current visible region in the top window, consider it not visible
  if (
    globalRect.top > topWinHeight ||
    globalRect.bottom < 0 ||
    globalRect.left > topWinWidth ||
    globalRect.right < 0
  ) {
    return {
      visible: false,
      reason: "Element is outside of the visible viewport in the top window",
    };
  }

  // Make sure it’s topmost at some point in its own document
  if (!isTopElement(element, rect, doc)) {
    return {
      visible: false,
      reason:
        "Element is not the topmost at its position (it may be overlapped)",
    };
  }

  // Also ensure each parent iframe is topmost in its parent doc
  if (!isIFrameOnTop(element)) {
    return {
      visible: false,
      reason: "Its parent iframe is not topmost in its parent document",
    };
  }

  // If all the above checks pass, let the browser do final visibility calculation
  const browserVisible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return browserVisible
    ? { visible: true, reason: "Element is visible" }
    : { visible: false, reason: "CSS rules make the element invisible" };
}

/**
 * Checks if a text node is visible in the main page, similarly to isVisible,
 * returning { visible: boolean, reason: string } for debug.
 */
export function isTextVisible(node: ChildNode): VisibilityResult {
  const doc = node.ownerDocument;
  if (!doc) {
    return {
      visible: false,
      reason: "No ownerDocument found for text node",
    };
  }

  const range = doc.createRange();
  range.selectNodeContents(node);

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return {
      visible: false,
      reason: "Text node has zero bounding box (empty or no visible space)",
    };
  }

  const dummyElement = node.parentElement;
  if (!dummyElement) {
    return {
      visible: false,
      reason: "No parent element found for text node",
    };
  }

  const globalRect = getGlobalRect(dummyElement);
  const winTop = window.top;
  if (!winTop) {
    return {
      visible: false,
      reason: "No top-level window found",
    };
  }

  const topWinWidth = winTop.innerWidth;
  const topWinHeight = winTop.innerHeight;
  if (
    globalRect.top > topWinHeight ||
    globalRect.bottom < 0 ||
    globalRect.left > topWinWidth ||
    globalRect.right < 0
  ) {
    return {
      visible: false,
      reason: "Text node is outside of the visible viewport in the top window",
    };
  }

  if (!isTopElement(dummyElement, rect, doc)) {
    return {
      visible: false,
      reason: "Text node is overlapped by another element",
    };
  }

  if (!isIFrameOnTop(dummyElement)) {
    return {
      visible: false,
      reason: "Its parent iframe is not topmost in its parent document",
    };
  }

  const browserVisible = dummyElement.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });
  return browserVisible
    ? { visible: true, reason: "Text is visible" }
    : { visible: false, reason: "CSS rules make the text node invisible" };
}

/**
 * Checks if this element is the topmost at some set of sample points
 * in its own coordinate space.
 */
function isTopElement(elem: Element, rect: DOMRect, doc: Document): boolean {
  // We'll pick some sample points inside the element
  const points = [
    // Corners
    { x: rect.left, y: rect.top }, // Top left
    { x: rect.right, y: rect.top }, // Top right
    { x: rect.left, y: rect.bottom }, // Bottom left
    { x: rect.right, y: rect.bottom }, // Bottom right

    // Edge midpoints
    { x: rect.left + rect.width / 2, y: rect.top }, // Top middle
    { x: rect.left + rect.width / 2, y: rect.bottom }, // Bottom middle
    { x: rect.left, y: rect.top + rect.height / 2 }, // Left middle
    { x: rect.right, y: rect.top + rect.height / 2 }, // Right middle

    // Interior points at 25% intervals
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }, // Center
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.75 },

    // Additional interior points at 33% intervals
    { x: rect.left + rect.width * 0.33, y: rect.top + rect.height * 0.33 },
    { x: rect.left + rect.width * 0.66, y: rect.top + rect.height * 0.33 },
    { x: rect.left + rect.width * 0.33, y: rect.top + rect.height * 0.66 },
    { x: rect.left + rect.width * 0.66, y: rect.top + rect.height * 0.66 },
  ];

  // Use doc.elementFromPoint(...) instead of top-level document
  const results = points.map((point) => {
    const elAtPoint = doc.elementFromPoint(point.x, point.y);
    let current: Element | null = elAtPoint as Element;
    while (current && current !== doc.body) {
      if (current.isSameNode(elem)) return true;
      current = current.parentElement;
    }
    return false;
  });

  return results.some((result) => result);
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

const isInteractiveElement = (element: Element) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute("role");
  const elementAriaRole = element.getAttribute("aria-role");

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
