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
const isVisible = (
  element: Element,
  offsetTop: number,
  offsetBottom: number
) => {
  const rect = element.getBoundingClientRect();
  // this number is relative to scroll, so we shouldn't be using an absolute offset, we can use the viewport height
  console.log(rect.top);
  console.log(offsetTop, offsetBottom);

  if (
    rect.width === 0 ||
    rect.height === 0 ||
    // we take elements by their starting top. so if you start before our offset, or after our offset, you don't count!
    rect.top < offsetTop ||
    rect.top > offsetBottom
  ) {
    return false;
  }
  console.log('yay');
  if (!isTopElement(element, rect)) {
    return false;
  }

  console.log('is top');
  const isVisible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  console.log(isVisible, 'final');

  return isVisible;
};

function isTopElement(elem: Element, rect: DOMRect) {
  let topEl = document.elementFromPoint(
    rect.left + Math.min(rect.width, window.innerWidth - rect.left) / 2,
    rect.top + Math.min(rect.height, window.innerHeight - rect.top) / 2
  );

  console.log(elem);
  console.log(
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

async function processElements(chunksSeen: Array<number>) {
  console.log('---DOM CLEANING--- starting cleaning');
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;

  const chunks = Math.ceil(documentHeight / viewportHeight);
  console.log('num chunks', chunks);
  console.log('chunksSeen', chunksSeen);
  const chunksArray = Array.from({ length: chunks }, (_, i) => i);
  console.log('chunksArray', chunksArray);
  const chunksRemaining = chunksArray.filter((chunk) => {
    console.log('chunk', chunk);
    console.log('chunksSeen', chunksSeen);
    console.log('!chunksSeen.includes(chunk)', !chunksSeen.includes(chunk));
    return !chunksSeen.includes(chunk);
  });

  console.log('chunksRemaining', chunksRemaining);

  const chunk = chunksRemaining.shift();

  console.log('chunk', chunk);

  if (chunk === undefined) {
    return {};
    throw new Error(`no chunks remaining to check ${chunksRemaining}, `);
  }
  const chunkHeight = viewportHeight * chunk;
  const offsetTop = chunkHeight;
  const offsetBottom = Math.min(chunkHeight + viewportHeight, documentHeight);

  console.log(
    `Processing chunk ${chunk} from offsetTop ${offsetTop}px to offsetBottom ${offsetBottom}px`
  );
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
        if (
          (await isActive(element)) &&
          isVisible(element, offsetTop, offsetBottom)
        ) {
          candidateElements.push(element);
        }
        continue;
      } else if (isInteractiveElement(element)) {
        if (
          (await isActive(element)) &&
          isVisible(element, offsetTop, offsetBottom)
        ) {
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

  console.log(outputString);
  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

window.processElements = processElements;
