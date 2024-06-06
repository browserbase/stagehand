function generateXPath(element: ChildNode): string {
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

function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isTextNode(node: Node): node is Text {
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
const isVisible = (element: Element) => {
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

const isTextVisible = (element: ChildNode) => {
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

function isTopElement(elem: ChildNode, rect: DOMRect) {
  let topEl = document.elementFromPoint(
    rect.left + Math.min(rect.width, window.innerWidth - rect.left) / 2,
    rect.top + Math.min(rect.height, window.innerHeight - rect.top) / 2
  );
  let found = false;
  while (topEl && topEl !== document.body) {
    // consider checking hit targets in the corner and middle instead of containing
    if (topEl.isSameNode(elem)) {
      found = true;
      break;
    }
    topEl = topEl.parentElement;
  }

  return found;
}

const isActive = async (element: Element) => {
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

async function processDom(chunksSeen: Array<number>) {
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  const { outputString, selectorMap } = await processElements(chunk);

  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

async function processElements(chunk: number) {
  const viewportHeight = window.innerHeight;

  const chunkHeight = viewportHeight * chunk;
  const offsetTop = chunkHeight;

  window.scrollTo(0, offsetTop);

  const domString = window.document.body.outerHTML;
  if (!domString) {
    throw new Error("error selecting DOM that doesn't exist");
  }

  const candidateElements: Array<ChildNode> = [];
  const DOMQueue: Array<ChildNode> = [...document.body.childNodes];
  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();

    if (element && isElementNode(element)) {
      const childrenCount = element.childNodes.length;

      // if you have no children you are a leaf node
      if (isLeafElement(element)) {
        if ((await isActive(element)) && isVisible(element)) {
          candidateElements.push(element);
        }
        continue;
      } else if (isInteractiveElement(element)) {
        if ((await isActive(element)) && isVisible(element)) {
          candidateElements.push(element);
        }
        continue;
      }
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.childNodes[i];
        DOMQueue.push(child as Element);
      }
    } else if (element && isTextNode(element) && isTextVisible(element)) {
      candidateElements.push(element);
    }
  }

  let selectorMap: Record<number, string> = {};
  let outputString = "";

  candidateElements.forEach((element, index) => {
    const xpath = generateXPath(element);
    if (isTextNode(element)) {
      outputString += `${index}:${element.textContent}\n`;
    } else if (isElementNode(element)) {
      outputString += `${index}:${element.outerHTML.trim()}\n`;
    }

    selectorMap[index] = xpath;
  });

  return {
    outputString,
    selectorMap,
  };
}

window.processDom = processDom;
window.processElements = processElements;
