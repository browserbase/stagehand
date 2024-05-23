import { Locator, type Page } from '@playwright/test';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;

function generateXPath(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  while (element && element.nodeType === 1) {
    let index = 0;
    let hasSameTypeSiblings = false;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling.nodeType === 1 && sibling.nodeName === element.nodeName) {
        hasSameTypeSiblings = true;
        if (sibling === element) {
          index = index + 1;
          break;
        }
        index = index + 1;
      }
    }

    const tagName = element.nodeName.toLowerCase();
    const pathIndex = hasSameTypeSiblings ? `[${index}]` : '';
    parts.unshift(`${tagName}${pathIndex}`);
    element = element.parentNode as Element;
  }

  return parts.length ? `/${parts.join('/')}` : '';
}

const leafElementDenyList = ['SVG', 'IFRAME', 'SCRIPT'];

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

const isActiveElement = (element: HTMLElement) => {
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
  if (leafElementDenyList.includes(element.tagName)) {
    return false;
  }
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
  return !leafElementDenyList.includes(element.tagName);
};

async function cleanDOM(startingLocator: Locator) {
  console.log('---DOM CLEANING--- starting cleaning');
  const domString = await startingLocator.evaluate((el) => el.outerHTML);
  if (!domString) {
    throw new Error("error selecting DOM that doesn't exist");
  }
  const { document } = new JSDOM(domString).window;
  const candidateElements: Array<HTMLElement> = [];
  const DOMQueue: Array<HTMLElement> = [document.body];
  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();
    if (element) {
      const childrenCount = element.children.length;
      // if you have no children you are a leaf node
      if (childrenCount === 0 && isLeafElement(element)) {
        candidateElements.push(element);
        continue;
      } else if (isInteractiveElement(element)) {
        if (isActiveElement(element)) {
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

  console.log('---DOM CLEANING--- CLEANED HTML STRING');

  return { outputString, selectorMap };
}

export { cleanDOM };
