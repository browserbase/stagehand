function generateXPath(element: Element): string {
  if (element.id) {
    return `//*[@id='${element.id}']`;
  }

  const parts: string[] = [];
  while (element && element.nodeType === 1) {
    let index = 0;
    let hasSameTypeSiblings = false;
    const siblings = element.parentElement
      ? element.parentElement.children
      : [];

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];

      if (sibling.nodeType === 1 && sibling.nodeName === element.nodeName) {
        index = index + 1;

        hasSameTypeSiblings = true;

        if (sibling.isSameNode(element)) {
          break;
        }
      }
    }

    const tagName = element.nodeName.toLowerCase();
    const pathIndex = hasSameTypeSiblings ? `[${index}]` : '';
    parts.unshift(`${tagName}${pathIndex}`);
    element = element.parentElement as HTMLElement;
  }

  return parts.length ? `/${parts.join('/')}` : '';
}

const leafElementDenyList = ['SVG', 'IFRAME', 'SCRIPT', 'STYLE'];

const interactiveElementTypes = [
  'A',
  'BUTTON',
  'DETAILS',
  'EMBED',
  'INPUT',
  'LABEL',
  'MENU',
  'MENUITEM',
  'OBJECT',
  'SELECT',
  'TEXTAREA',
  'SUMMARY',
];

const interactiveRoles = [
  'button',
  'menu',
  'menuitem',
  'link',
  'checkbox',
  'radio',
  'slider',
  'tab',
  'tabpanel',
  'textbox',
  'combobox',
  'grid',
  'listbox',
  'option',
  'progressbar',
  'scrollbar',
  'searchbox',
  'switch',
  'tree',
  'treeitem',
  'spinbutton',
  'tooltip',
];
const interactiveAriaRoles = ['menu', 'menuitem', 'button'];

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

function isTopElement(elem: Element, rect: DOMRect) {
  let topEl = document.elementFromPoint(
    rect.left + Math.min(rect.width, window.innerWidth - rect.left) / 2,
    rect.top + Math.min(rect.height, window.innerHeight - rect.top) / 2
  );

  let found = false;
  while (topEl && topEl !== document.body) {
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
    element.hasAttribute('disabled') ||
    element.hasAttribute('hidden') ||
    element.ariaDisabled
  ) {
    return false;
  }

  return true;
};
const isInteractiveElement = (element: Element) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute('role');
  const elementAriaRole = element.getAttribute('aria-role');

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

const isLeafElement = (element: Element) => {
  if (element.textContent === '') {
    return false;
  }
  return !leafElementDenyList.includes(element.tagName);
};

const _chunkColors = [
  'rgba(255, 0, 0)', // Red
  'rgba(0, 255, 0)', // Green
  'rgba(0, 0, 255)', // Blue
  'rgba(255, 255, 0)', // Yellow
  'rgba(128, 0, 128)', // Purple
];

function _drawChunk(chunk: number, selectorMap: Record<number, string>) {
  Object.entries(selectorMap).forEach(([index, selector]) => {
    const element = document.evaluate(
      selector as string,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue as Element;

    if (element) {
      const rect = element.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.left = `${rect.left + window.scrollX}px`;
      overlay.style.top = `${rect.top + window.scrollY}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.backgroundColor = _chunkColors[chunk % _chunkColors.length];
      overlay.className = 'stagehand-marker';
      overlay.style.opacity = '0.7';
      overlay.style.zIndex = '10000000'; // Ensure it's above the element
      overlay.style.border = '1px solid'; // Add a 1px solid border to the overlay
      overlay.style.pointerEvents = 'none'; // Ensure the overlay does not capture mouse events
      document.body.appendChild(overlay);
    }
  });
}
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

function setupChunkNav() {
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const totalChunks = Math.ceil(documentHeight / viewportHeight);

  if (window.chunkNumber > 0) {
    const prevChunkButton = document.createElement('button');
    prevChunkButton.className = 'stagehand-nav';

    prevChunkButton.textContent = 'Previous';
    prevChunkButton.style.marginLeft = '50px';
    prevChunkButton.style.position = 'fixed';
    prevChunkButton.style.bottom = '10px';
    prevChunkButton.style.left = '50%';
    prevChunkButton.style.transform = 'translateX(-50%)';
    prevChunkButton.style.zIndex = '1000';
    prevChunkButton.onclick = async () => {
      const markers = document.querySelectorAll('.stagehand-marker');
      markers.forEach((marker) => {
        marker.remove();
      });
      window.chunkNumber -= 1;
      window.scrollTo(0, window.chunkNumber * window.innerHeight);
      await window.waitForDomSettle();
      const stagehandNavElements = document.querySelectorAll('.stagehand-nav');
      stagehandNavElements.forEach((element) => {
        element.remove();
      });
      const { selectorMap } = await processElements(window.chunkNumber);
      _drawChunk(window.chunkNumber, selectorMap);
      setupChunkNav();
    };
    document.body.appendChild(prevChunkButton);
  }
  if (totalChunks > window.chunkNumber) {
    const nextChunkButton = document.createElement('button');
    nextChunkButton.className = 'stagehand-nav';
    nextChunkButton.textContent = 'Next';
    nextChunkButton.style.marginRight = '50px';
    nextChunkButton.style.position = 'fixed';
    nextChunkButton.style.bottom = '10px';
    nextChunkButton.style.right = '50%';
    nextChunkButton.style.transform = 'translateX(50%)';
    nextChunkButton.style.zIndex = '1000';
    nextChunkButton.onclick = async () => {
      const markers = document.querySelectorAll('.stagehand-marker');
      markers.forEach((marker) => {
        marker.remove();
      });
      window.chunkNumber += 1;
      window.scrollTo(0, window.chunkNumber * window.innerHeight);
      await window.waitForDomSettle();
      const stagehandNavElements = document.querySelectorAll('.stagehand-nav');
      stagehandNavElements.forEach((element) => {
        element.remove();
      });

      const { selectorMap } = await processElements(window.chunkNumber);
      _drawChunk(window.chunkNumber, selectorMap);
      setupChunkNav();
    };

    document.body.appendChild(nextChunkButton);
  }
}

async function debugDom() {
  window.chunkNumber = 0;
  console.log('---DEBUG DOM--- Starting debug of all chunks');

  await window.waitForDomSettle();

  const { selectorMap } = await processElements(window.chunkNumber);

  _drawChunk(window.chunkNumber, selectorMap);
  setupChunkNav();
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
  console.log('---DOM CLEANING--- starting cleaning');
  const viewportHeight = window.innerHeight;

  const chunkHeight = viewportHeight * chunk;
  const offsetTop = chunkHeight;

  window.scrollTo(0, offsetTop);

  const domString = window.document.body.outerHTML;
  if (!domString) {
    throw new Error("error selecting DOM that doesn't exist");
  }

  const candidateElements: Array<Element> = [];
  const DOMQueue: Array<Element> = [...document.body.children];
  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();
    if (element) {
      const childrenCount = element.children.length;

      // if you have no children you are a leaf node
      if (childrenCount === 0 && isLeafElement(element)) {
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
        const child = element.children[i];

        DOMQueue.push(child as Element);
      }
    }
  }

  let selectorMap = {};
  let outputString = '';

  candidateElements.forEach((element, index) => {
    const xpath = generateXPath(element);

    selectorMap[index] = xpath;
    outputString += `${index}:${element.outerHTML.trim()}\n`;
  });

  return {
    outputString,
    selectorMap,
  };
}

window.processDom = processDom;
window.debugDom = debugDom;

export {};
declare global {
  interface Window {
    chunkNumber: number;
    hasNextChunk: boolean;
    hasPreviousChunk: boolean;
    processDom: (chunksSeen: Array<number>) => Promise<{
      outputString: string;
      selectorMap: Record<number, string>;
      chunk: number;
      chunks: number[];
    }>;
    debugDom: () => Promise<void>;
  }
}
