import { Locator, type Page } from '@playwright/test';

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

const isInteractiveElement = async (locator: Locator) => {
  const elementType = await locator.evaluate((el) => el.tagName);
  const elementRole = await locator.evaluate((el) => el.getAttribute('role'));
  const elementAriaRole = await locator.evaluate((el) =>
    el.getAttribute('aria-role')
  );
  return (
    interactiveElementTypes.includes(elementType) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

async function cleanDOM(startingLocator: Locator) {
  console.log('---DOM CLEANING--- starting cleaning');
  const candidateElements: Array<Locator> = [];
  const DOMQueue = [startingLocator];
  console.log('dom queue', DOMQueue);
  while (DOMQueue.length > 0) {
    const locator = DOMQueue.pop(); // Changed from shift() to pop() to make it depth-first search
    const tagName = await locator.evaluate((el) => el.tagName);
    console.log(`Operating on tag: ${tagName}`);
    if (locator) {
      const childrenCount = await locator.locator('>*').count();

      // if you have no children you are a leaf node
      if (childrenCount === 0) {
        candidateElements.push(locator);
        continue;
      } else if (await isInteractiveElement(locator)) {
        candidateElements.push(locator);
        continue;
      }
      for (let i = childrenCount - 1; i >= 0; i--) {
        // Reverse the order of child processing
        const child = locator.locator(`>*:nth-child(${i + 1})`);
        const tagName = await child.evaluate((el) => el.tagName);
        console.log(`Pushing child: ${tagName} to front`);
        DOMQueue.push(child); // Pushing to the same end of the array to maintain depth-first order
      }
    }
  }

  const results = await Promise.allSettled(
    candidateElements.map((el) => el.evaluate((el) => el.outerHTML))
  );

  const cleanedHtml = results
    .filter(
      (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled'
    )
    .map((r) =>
      r.value
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
