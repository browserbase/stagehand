import { Locator, type Page } from '@playwright/test';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;

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

const isInteractiveElement = (element: HTMLElement) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute('role');
  const elementAriaRole = element.getAttribute('aria-role');

  if (
    element.getAttribute('disabled') === 'true' ||
    element.hidden ||
    element.ariaDisabled
  ) {
    return false;
  }

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
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
      if (childrenCount === 0) {
        candidateElements.push(element);
        continue;
      } else if (isInteractiveElement(element)) {
        candidateElements.push(element);
        continue;
      }
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.children[i];

        DOMQueue.push(child as HTMLElement);
      }
    }
  }

  const cleanedHtml = candidateElements

    .map((r) =>
      r.outerHTML
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
    )
    .join(',\n');

  console.log('---DOM CLEANING--- CLEANED HTML STRING');
  console.log(cleanedHtml);

  return cleanedHtml;
}

export { cleanDOM };
