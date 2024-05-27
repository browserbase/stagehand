function generateXPath(element: HTMLElement): string {
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
      index = index + 1;

      if (sibling.nodeType === 1 && sibling.nodeName === element.nodeName) {
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

// const hasSize = (element: HTMLElement, styles: CSSStyleDeclaration) => {
//   if (element.tagName === 'TEXTAREA') {
//     console.log('textarea', element.tagName);
//     console.log(element.height);
//     console.log(element.width);
//     console.log(styles.height);
//     console.log(styles.width);
//   }
//   const noProperties =
//     (!element.clientHeight || !element.clientWidth) &&
//     (!styles.height || !styles.width);

//   // if we don't have at least one height or width in the styles or client properties, we can't have size
//   if (noProperties) {
//     return false;
//   }

//   const noStyleSize = styles.height === '0px' || styles.width === '0px';

//   const noClientSize = element.clientHeight === 0 || element.clientWidth === 0;
//   if (noClientSize && noStyleSize) {
//     return false;
//   }
//   return true;
// };

const isActiveElement = async (element: HTMLElement) => {
  if (
    element.hasAttribute('disabled') ||
    element.hidden ||
    element.ariaDisabled
  ) {
    return false;
  }

  return true;
};
const isInteractiveElement = (element: HTMLElement) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute('role');
  const elementAriaRole = element.getAttribute('aria-role');

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

const isLeafElement = (element: HTMLElement) => {
  if (element.textContent === '') {
    return false;
  }
  return !leafElementDenyList.includes(element.tagName);
};

async function processElements() {
  console.log('---DOM CLEANING--- starting cleaning');
  const domString = window.document.body.outerHTML;
  if (!domString) {
    throw new Error("error selecting DOM that doesn't exist");
  }

  const candidateElements: Array<HTMLElement> = [];
  const DOMQueue: Array<HTMLElement> = [document.body];
  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();
    if (element) {
      const childrenCount = element.children.length;

      // if you have no children you are a leaf node
      if (childrenCount === 0 && isLeafElement(element)) {
        if (await isActiveElement(element)) {
          candidateElements.push(element);
        }
        candidateElements.push(element);
        continue;
      } else if (isInteractiveElement(element)) {
        if (await isActiveElement(element)) {
          candidateElements.push(element);
        }
        continue;
      }
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.children[i];

        DOMQueue.push(child as HTMLElement);
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

  return { outputString, selectorMap };
}

window.processElements = processElements;
