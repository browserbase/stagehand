import { isTextNode, isElementNode } from "./process";

/**
 * Attempts to find the <iframe> Element in the top-level document
 * whose .contentDocument or .contentWindow?.document
 * matches the passed-in Document.
 *
 * @param doc The Document we're trying to match.
 */
function findIframeElementForDocument(doc: Document): HTMLIFrameElement | null {
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of Array.from(iframes)) {
    try {
      if (
        iframe.contentDocument === doc ||
        iframe.contentWindow?.document === doc
      ) {
        return iframe;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Build a top-level XPath to the given iframe element
 * (the iframe as a DOM element in the parent document).
 * This reuses standard logic for building an XPath to regular elements.
 */
function buildXPathForIframeElement(iframeEl: HTMLIFrameElement): string {
  const parts: string[] = [];
  let el: HTMLElement | null = iframeEl;
  while (el && el !== document.body) {
    const siblings = el.parentElement
      ? Array.from(el.parentElement.children)
      : [];
    let index = 1;
    for (const sibling of siblings) {
      if (sibling.tagName === el.tagName) {
        if (sibling === el) {
          break;
        }
        index++;
      }
    }
    const tagName = el.tagName.toLowerCase();
    parts.unshift(index > 1 ? `${tagName}[${index}]` : tagName);
    el = el.parentElement;
  }
  return "//" + parts.join("/");
}

/**
 * Generate a combined "iframe-aware" path that shows how to locate
 * an element in the top-level doc by first finding the appropriate iframe,
 * then, inside that iframe, using a normal XPath to locate the target node.
 */
function generateIframeAwareXPathChain(element: ChildNode): string[] | null {
  if (!element.ownerDocument) return null;

  if (element.ownerDocument === document) {
    return null;
  }

  const iframeEl = findIframeElementForDocument(element.ownerDocument);
  if (!iframeEl) {
    return null;
  }

  const iframeXPath = buildXPathForIframeElement(iframeEl);
  const insideIframeXPath = buildStandardXPathInsideDoc(element);

  return [iframeXPath, insideIframeXPath];
}

/**
 * A helper that builds a standard XPath for an element (or text node) inside
 * its own Document.
 */
function buildStandardXPathInsideDoc(node: ChildNode): string {
  const parts: string[] = [];
  let current: ChildNode | null = node;
  while (current && (isElementNode(current) || isTextNode(current))) {
    const parent = current.parentElement;
    if (!parent) break;
    let index = 1;
    const siblings = Array.from(parent.childNodes).filter(
      (sibling) =>
        sibling.nodeType === current.nodeType &&
        sibling.nodeName === current.nodeName,
    );

    for (const sibling of siblings) {
      if (sibling === current) break;
      index++;
    }

    if (current.nodeName !== "#text") {
      const tagName = current.nodeName.toLowerCase();
      parts.unshift(siblings.length > 1 ? `${tagName}[${index}]` : tagName);
    }
    current = parent;
  }
  return "//" + parts.join("/");
}

function getParentElement(node: ChildNode): Element | null {
  return isElementNode(node)
    ? node.parentElement
    : (node.parentNode as Element);
}

/**
 * Generates all possible combinations of a given array of attributes.
 * @param attributes Array of attributes.
 * @param size The size of each combination.
 * @returns An array of attribute combinations.
 */
function getCombinations(
  attributes: { attr: string; value: string }[],
  size: number,
): { attr: string; value: string }[][] {
  const results: { attr: string; value: string }[][] = [];

  function helper(start: number, combo: { attr: string; value: string }[]) {
    if (combo.length === size) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < attributes.length; i++) {
      combo.push(attributes[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }

  helper(0, []);
  return results;
}

/**
 * Checks if the generated XPath uniquely identifies the target element.
 * @param xpath The XPath string to test.
 * @param target The target DOM element.
 * @returns True if unique, else false.
 */
function isXPathFirstResultElement(xpath: string, target: Element): boolean {
  try {
    const result = document.evaluate(
      xpath,
      document.documentElement,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return result.snapshotItem(0) === target;
  } catch (error) {
    console.warn(`Invalid XPath expression: ${xpath}`, error);
    return false;
  }
}

/**
 * Escapes a string for use in an XPath expression.
 * Handles special characters, including single and double quotes.
 * @param value - The string to escape.
 * @returns The escaped string safe for XPath.
 */
export function escapeXPathString(value: string): string {
  if (value.includes("'")) {
    if (value.includes('"')) {
      // If the value contains both single and double quotes, split into parts
      return (
        "concat(" +
        value
          .split(/('+)/)
          .map((part) => {
            if (part === "'") {
              return `"'"`;
            } else if (part.startsWith("'") && part.endsWith("'")) {
              return `"${part}"`;
            } else {
              return `'${part}'`;
            }
          })
          .join(",") +
        ")"
      );
    } else {
      // Contains single quotes but not double quotes; use double quotes
      return `"${value}"`;
    }
  } else {
    // Does not contain single quotes; use single quotes
    return `'${value}'`;
  }
}

/**
 * Generates XPaths for a given DOM element, including iframe-aware paths if needed.
 * @param element - The target DOM element.
 * @returns An array of XPaths.
 */
export async function generateXPathsForElement(
  element: ChildNode,
): Promise<(string | string[])[]> {
  if (!element) return [];

  // This should return in order from most accurate on current page to most cachable.
  // Do not change the order if you are not sure what you are doing.
  // Contact Ani / Navid if you need help understanding it.
  const iframeChain = generateIframeAwareXPathChain(element);
  const [complexXPath, standardXPath, idBasedXPath] = await Promise.all([
    generateComplexXPath(element),
    generateStandardXPath(element),
    generatedIdBasedXPath(element),
  ]);

  if (iframeChain) {
    return [
      iframeChain,
      standardXPath,
      ...(idBasedXPath ? [idBasedXPath] : []),
      complexXPath,
    ];
  }

  return [standardXPath, ...(idBasedXPath ? [idBasedXPath] : []), complexXPath];
}

async function generateComplexXPath(element: ChildNode): Promise<string> {
  const parts: string[] = [];
  let currentElement: ChildNode | null = element;

  while (
    currentElement &&
    (isTextNode(currentElement) || isElementNode(currentElement))
  ) {
    if (isElementNode(currentElement)) {
      const el = currentElement as Element;
      let selector = el.tagName.toLowerCase();

      // List of attributes to consider for uniqueness
      const attributePriority = [
        "data-qa",
        "data-component",
        "data-role",
        "role",
        "aria-role",
        "type",
        "name",
        "aria-label",
        "placeholder",
        "title",
        "alt",
      ];

      const attributes = attributePriority
        .map((attr) => {
          let value = el.getAttribute(attr);
          if (attr === "href-full" && value) {
            value = el.getAttribute("href");
          }
          return value
            ? { attr: attr === "href-full" ? "href" : attr, value }
            : null;
        })
        .filter((attr) => attr !== null) as { attr: string; value: string }[];

      // Attempt to find a combination of attributes that uniquely identifies the element
      let uniqueSelector = "";
      for (let i = 1; i <= attributes.length; i++) {
        const combinations = getCombinations(attributes, i);
        for (const combo of combinations) {
          const conditions = combo
            .map((a) => `@${a.attr}=${escapeXPathString(a.value)}`)
            .join(" and ");
          const xpath = `//${selector}[${conditions}]`;
          if (isXPathFirstResultElement(xpath, el)) {
            uniqueSelector = xpath;
            break;
          }
        }
        if (uniqueSelector) break;
      }

      if (uniqueSelector) {
        parts.unshift(uniqueSelector.replace("//", ""));
        break;
      } else {
        // Fallback to positional selector
        const parent = getParentElement(el);
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (sibling) => sibling.tagName === el.tagName,
          );
          const index = siblings.indexOf(el as HTMLElement) + 1;
          selector += siblings.length > 1 ? `[${index}]` : "";
        }
        parts.unshift(selector);
      }
    }

    currentElement = getParentElement(currentElement);
  }

  const xpath = "//" + parts.join("/");
  return xpath;
}

/**
 * Generates a standard XPath for a given DOM element.
 * @param element - The target DOM element.
 * @returns A standard XPath string.
 */
async function generateStandardXPath(element: ChildNode): Promise<string> {
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

async function generatedIdBasedXPath(
  element: ChildNode,
): Promise<string | null> {
  if (isElementNode(element) && element.id) {
    return `//*[@id='${element.id}']`;
  }
  return null;
}
