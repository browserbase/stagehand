import {
  AccessibilityNode,
  TreeResult,
  AXNode,
  DOMNode,
  BackendIdMaps,
} from "../../types/context";
import { StagehandPage } from "../StagehandPage";
import { LogLine } from "../../types/log";
import { Page, Locator } from "playwright";
import {
  PlaywrightCommandMethodNotSupportedException,
  PlaywrightCommandException,
} from "@/types/playwright";
import {
  StagehandDomProcessError,
  StagehandElementNotFoundError,
} from "@/types/stagehandErrors";

const CLEAN_RULES: ReadonlyArray<[RegExp, string]> = [
  // Font-Awesome / Material-Icons placeholders (Private-Use Area)
  [/[\u{E000}-\u{F8FF}]/gu, ""],

  // NBSP family to regular space
  [/[\u00A0\u202F\u2007\uFEFF]/g, " "],
];

// returns the input string with each of the CLEAN_RULES applied
function cleanText(input: string): string {
  return CLEAN_RULES.reduce(
    (txt, [pattern, replacement]) => txt.replace(pattern, replacement),
    input,
  ).trim();
}

// Parser function for str output
export function formatSimplifiedTree(
  node: AccessibilityNode,
  level = 0,
): string {
  const indent = "  ".repeat(level);
  const cleanName = node.name ? cleanText(node.name) : "";
  let result = `${indent}[${node.nodeId}] ${node.role}${
    cleanName ? `: ${cleanName}` : ""
  }\n`;

  if (node.children?.length) {
    result += node.children
      .map((child) => formatSimplifiedTree(child, level + 1))
      .join("");
  }
  return result;
}

/**
 * Returns a `BackendIdMaps` object, which contains two mappings:
 * 1. a `tagNameMap`, which is a mapping of `backendNodeId`s -> `nodeName`s
 * 2. an `xpathMap`, which is a mapping of `backendNodeId`s -> `xPaths`s
 */
async function buildBackendIdMaps(page: StagehandPage): Promise<BackendIdMaps> {
  await page.enableCDP("DOM");

  try {
    const { root } = await page.sendCDP<{ root: DOMNode }>("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });

    const tagNameMap: Record<number, string> = {};
    const xpathMap: Record<number, string> = {};

    /* Recursively walk the DOM tree, carrying the XPath built so far. */
    const walk = (node: DOMNode, path: string): void => {
      if (node.backendNodeId) {
        const tag = String(node.nodeName).toLowerCase();
        tagNameMap[node.backendNodeId] = tag;
        xpathMap[node.backendNodeId] = path;
      }

      if (!node.children?.length) return;
      const counters: Record<string, number> = {};

      for (const child of node.children) {
        const name = String(child.nodeName).toLowerCase();
        const counterKey = `${child.nodeType}:${name}`;
        const idx = (counters[counterKey] = (counters[counterKey] ?? 0) + 1);

        const seg =
          child.nodeType === 3
            ? `text()[${idx}]`
            : child.nodeType === 8
              ? `comment()[${idx}]`
              : `${name}[${idx}]`;

        walk(child, `${path}/${seg}`);
      }
    };

    walk(root, "");

    return { tagNameMap, xpathMap };
  } finally {
    await page.disableCDP("DOM");
  }
}

/**
 * Helper function to remove or collapse unnecessary structural nodes
 * Handles three cases:
 * 1. Removes generic/none nodes with no children
 * 2. Collapses generic/none nodes with single child
 * 3. Keeps generic/none nodes with multiple children but cleans their subtrees
 *    and attempts to resolve their role to a DOM tag name
 */
async function cleanStructuralNodes(
  node: AccessibilityNode,
  tagNameMap: Record<number, string>,
  logger?: (logLine: LogLine) => void,
): Promise<AccessibilityNode | null> {
  // 1) Filter out nodes with negative IDs
  if (node.nodeId && parseInt(node.nodeId) < 0) {
    return null;
  }

  // 2) Base case: if no children exist, this is effectively a leaf.
  //    If it's "generic" or "none", we remove it; otherwise, keep it.
  if (!node.children || node.children.length === 0) {
    return node.role === "generic" || node.role === "none" ? null : node;
  }

  // 3) Recursively clean children
  const cleanedChildrenPromises = node.children.map((child) =>
    cleanStructuralNodes(child, tagNameMap, logger),
  );
  const resolvedChildren = await Promise.all(cleanedChildrenPromises);
  let cleanedChildren = resolvedChildren.filter(
    (child): child is AccessibilityNode => child !== null,
  );

  // 4) **Prune** "generic" or "none" nodes first,
  //    before resolving them to their tag names.
  if (node.role === "generic" || node.role === "none") {
    if (cleanedChildren.length === 1) {
      // Collapse single-child structural node
      return cleanedChildren[0];
    } else if (cleanedChildren.length === 0) {
      // Remove empty structural node
      return null;
    }
    // If we have multiple children, we keep this node as a container.
    // We'll update role below if needed.
  }

  // 5) If we still have a "generic"/"none" node after pruning
  //    (i.e., because it had multiple children), replace the role
  //    with the DOM tag name.
  if (
    (node.role === "generic" || node.role === "none") &&
    node.backendDOMNodeId !== undefined
  ) {
    const tagName = tagNameMap[node.backendDOMNodeId];
    if (tagName) node.role = tagName;
  }

  // rm redundant StaticText children
  cleanedChildren = removeRedundantStaticTextChildren(node, cleanedChildren);

  if (cleanedChildren.length === 0) {
    if (node.role === "generic" || node.role === "none") {
      return null;
    } else {
      return { ...node, children: [] };
    }
  }

  // 6) Return the updated node.
  //    If it has children, update them; otherwise keep it as-is.
  return cleanedChildren.length > 0
    ? { ...node, children: cleanedChildren }
    : node;
}

/**
 * Builds a hierarchical tree structure from a flat array of accessibility nodes.
 * The function processes nodes in multiple passes to create a clean, meaningful tree.
 * @param nodes - Flat array of accessibility nodes from the CDP
 * @returns Object containing both the tree structure and a simplified string representation
 */
export async function buildHierarchicalTree(
  nodes: AccessibilityNode[],
  tagNameMap: Record<number, string>,
  logger?: (logLine: LogLine) => void,
  xpathMap?: Record<number, string>,
): Promise<TreeResult> {
  // Map to store nodeId -> URL for only those nodes that do have a URL.
  const idToUrl: Record<string, string> = {};

  // Map to store processed nodes for quick lookup
  const nodeMap = new Map<string, AccessibilityNode>();
  const iframe_list: AccessibilityNode[] = [];

  // First pass: Create nodes that are meaningful
  // We only keep nodes that either have a name or children to avoid cluttering the tree
  nodes.forEach((node) => {
    // Skip node if its ID is negative (e.g., "-1000002014")
    const nodeIdValue = parseInt(node.nodeId, 10);
    if (nodeIdValue < 0) {
      return;
    }

    const url = extractUrlFromAXNode(node);
    if (url) {
      idToUrl[node.nodeId] = url;
    }

    const hasChildren = node.childIds && node.childIds.length > 0;
    const hasValidName = node.name && node.name.trim() !== "";
    const isInteractive =
      node.role !== "none" &&
      node.role !== "generic" &&
      node.role !== "InlineTextBox"; //add other interactive roles here

    // Include nodes that are either named, have children, or are interactive
    if (!hasValidName && !hasChildren && !isInteractive) {
      return;
    }

    // Create a clean node object with only relevant properties
    nodeMap.set(node.nodeId, {
      role: node.role,
      nodeId: node.nodeId,
      ...(hasValidName && { name: node.name }), // Only include name if it exists and isn't empty
      ...(node.description && { description: node.description }),
      ...(node.value && { value: node.value }),
      ...(node.backendDOMNodeId !== undefined && {
        backendDOMNodeId: node.backendDOMNodeId,
      }),
    });
  });

  // Second pass: Establish parent-child relationships
  // This creates the actual tree structure by connecting nodes based on parentId
  nodes.forEach((node) => {
    // Add iframes to a list and include in the return object
    const isIframe = node.role === "Iframe";
    if (isIframe) {
      const iframeNode = {
        role: node.role,
        nodeId: node.nodeId,
      };
      iframe_list.push(iframeNode);
    }
    if (node.parentId && nodeMap.has(node.nodeId)) {
      const parentNode = nodeMap.get(node.parentId);
      const currentNode = nodeMap.get(node.nodeId);

      if (parentNode && currentNode) {
        if (!parentNode.children) {
          parentNode.children = [];
        }
        parentNode.children.push(currentNode);
      }
    }
  });

  // Final pass: Build the root-level tree and clean up structural nodes
  const rootNodes = nodes
    .filter((node) => !node.parentId && nodeMap.has(node.nodeId)) // Get root nodes
    .map((node) => nodeMap.get(node.nodeId))
    .filter(Boolean) as AccessibilityNode[];

  const cleanedTreePromises = rootNodes.map((node) =>
    cleanStructuralNodes(node, tagNameMap, logger),
  );
  const finalTree = (await Promise.all(cleanedTreePromises)).filter(
    Boolean,
  ) as AccessibilityNode[];

  // Generate a simplified string representation of the tree
  const simplifiedFormat = finalTree
    .map((node) => formatSimplifiedTree(node))
    .join("\n");

  return {
    tree: finalTree,
    simplified: simplifiedFormat,
    iframes: iframe_list,
    idToUrl: idToUrl,
    xpathMap: xpathMap,
  };
}

/**
 * Retrieves the full accessibility tree via CDP and transforms it into a hierarchical structure.
 */
export async function getAccessibilityTree(
  page: StagehandPage,
  logger: (logLine: LogLine) => void,
  selector?: string,
): Promise<TreeResult> {
  const { tagNameMap, xpathMap } = await buildBackendIdMaps(page);

  await page.enableCDP("Accessibility");

  try {
    const { nodes: fullNodes } = await page.sendCDP<{ nodes: AXNode[] }>(
      "Accessibility.getFullAXTree",
    );
    const scrollableBackendIds = await findScrollableElementIds(page);

    let nodes = fullNodes;

    if (selector) {
      const objectId = await resolveObjectIdForXPath(page, selector);

      const { node } = await page.sendCDP<{
        node: { backendNodeId: number };
      }>("DOM.describeNode", { objectId: objectId });

      if (!node?.backendNodeId) {
        throw new StagehandDomProcessError(
          `Unable to resolve backendNodeId for XPath "${selector}"`,
        );
      }

      const target = fullNodes.find(
        (n) => n.backendDOMNodeId === node.backendNodeId,
      );
      if (!target) {
        throw new StagehandDomProcessError(
          `No AX node found for backendNodeId ${node.backendNodeId} (XPath "${selector}")`,
        );
      }

      const keep = new Set<string>([target.nodeId]);
      const queue = [target];

      while (queue.length) {
        const current = queue.shift()!;
        for (const childId of current.childIds ?? []) {
          if (!keep.has(childId)) {
            keep.add(childId);
            const child = fullNodes.find((n) => n.nodeId === childId);
            if (child) queue.push(child);
          }
        }
      }

      nodes = fullNodes
        .filter((n) => keep.has(n.nodeId))
        .map((n) =>
          n.nodeId === target.nodeId ? { ...n, parentId: undefined } : n,
        );
    }

    const startTime = Date.now();

    // Transform into hierarchical structure
    const hierarchicalTree = await buildHierarchicalTree(
      nodes.map((node) => {
        let roleValue = node.role?.value || "";

        if (scrollableBackendIds.has(node.backendDOMNodeId)) {
          if (roleValue === "generic" || roleValue === "none") {
            roleValue = "scrollable";
          } else {
            roleValue = roleValue ? `scrollable, ${roleValue}` : "scrollable";
          }
        }

        return {
          role: roleValue,
          name: node.name?.value,
          description: node.description?.value,
          value: node.value?.value,
          nodeId: node.nodeId,
          backendDOMNodeId: node.backendDOMNodeId,
          parentId: node.parentId,
          childIds: node.childIds,
          properties: node.properties,
        };
      }),
      tagNameMap,
      logger,
      xpathMap,
    );

    logger({
      category: "observation",
      message: `got accessibility tree in ${Date.now() - startTime}ms`,
      level: 1,
    });
    return hierarchicalTree;
  } catch (error) {
    logger({
      category: "observation",
      message: "Error getting accessibility tree",
      level: 1,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    throw error;
  } finally {
    await page.disableCDP("Accessibility");
  }
}

/**
 * `findScrollableElementIds` is a function that identifies elements in
 * the browser that are deemed "scrollable". At a high level, it does the
 * following:
 * - Calls the browser-side `window.getScrollableElementXpaths()` function,
 *   which returns a list of XPaths for scrollable containers.
 * - Iterates over the returned list of XPaths, locating each element in the DOM
 *   using `stagehandPage.sendCDP(...)`
 *     - During each iteration, we call `Runtime.evaluate` to run `document.evaluate(...)`
 *       with each XPath, obtaining a `RemoteObject` reference if it exists.
 *     - Then, for each valid object reference, we call `DOM.describeNode` to retrieve
 *       the element’s `backendNodeId`.
 * - Collects all resulting `backendNodeId`s in a Set and returns them.
 *
 * @param stagehandPage - A StagehandPage instance with built-in CDP helpers.
 * @returns A Promise that resolves to a Set of unique `backendNodeId`s corresponding
 *          to scrollable elements in the DOM.
 */
export async function findScrollableElementIds(
  stagehandPage: StagehandPage,
): Promise<Set<number>> {
  // get the xpaths of the scrollable elements
  const xpaths = await stagehandPage.page.evaluate(() => {
    return window.getScrollableElementXpaths();
  });

  const scrollableBackendIds = new Set<number>();

  for (const xpath of xpaths) {
    if (!xpath) continue;

    // evaluate the XPath in the stagehandPage
    const objectId = await resolveObjectIdForXPath(stagehandPage, xpath);

    // if we have an objectId, call DOM.describeNode to get backendNodeId
    if (objectId) {
      const { node } = await stagehandPage.sendCDP<{
        node?: { backendNodeId?: number };
      }>("DOM.describeNode", {
        objectId: objectId,
      });

      if (node?.backendNodeId) {
        scrollableBackendIds.add(node.backendNodeId);
      }
    }
  }

  return scrollableBackendIds;
}

/**
 * Resolve an XPath to a Chrome-DevTools-Protocol (CDP) remote-object ID.
 *
 * @param page     A StagehandPage (or Playwright.Page with .sendCDP)
 * @param xpath    An absolute or relative XPath
 * @returns        The remote objectId for the matched node, or null
 */
export async function resolveObjectIdForXPath(
  page: StagehandPage,
  xpath: string,
): Promise<string | null> {
  const { result } = await page.sendCDP<{
    result?: { objectId?: string };
  }>("Runtime.evaluate", {
    expression: `
      (function () {
        const res = document.evaluate(
          ${JSON.stringify(xpath)},
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return res.singleNodeValue;
      })();
    `,
    returnByValue: false,
  });
  if (!result?.objectId) {
    throw new StagehandElementNotFoundError([xpath]);
  }
  return result.objectId;
}

/**
 * Removes any StaticText children whose combined text equals the parent's name.
 * This is most often used to avoid duplicating a link's accessible name in separate child nodes.
 *
 * @param parent     The parent accessibility node whose `.name` we check.
 * @param children   The parent's current children list, typically after cleaning.
 * @returns          A filtered list of children with redundant StaticText nodes removed.
 */
function removeRedundantStaticTextChildren(
  parent: AccessibilityNode,
  children: AccessibilityNode[],
): AccessibilityNode[] {
  if (!parent.name) {
    return children;
  }

  const parentName = parent.name.replace(/\s+/g, " ").trim();

  // Gather all StaticText children and combine their text
  const staticTextChildren = children.filter(
    (child) => child.role === "StaticText" && child.name,
  );
  const combinedChildText = staticTextChildren
    .map((child) => child.name!.replace(/\s+/g, " ").trim())
    .join("");

  // If the combined text exactly matches the parent's name, remove those child nodes
  if (combinedChildText === parentName) {
    return children.filter((child) => child.role !== "StaticText");
  }

  return children;
}

function extractUrlFromAXNode(axNode: AccessibilityNode): string | undefined {
  if (!axNode.properties) return undefined;
  const urlProp = axNode.properties.find((prop) => prop.name === "url");
  if (urlProp && urlProp.value && typeof urlProp.value.value === "string") {
    return urlProp.value.value.trim();
  }
  return undefined;
}

export async function performPlaywrightMethod(
  stagehandPage: Page,
  logger: (logLine: LogLine) => void,
  method: string,
  args: unknown[],
  xpath: string,
) {
  const locator = stagehandPage.locator(`xpath=${xpath}`).first();
  const initialUrl = stagehandPage.url();

  logger({
    category: "action",
    message: "performing playwright method",
    level: 2,
    auxiliary: {
      xpath: {
        value: xpath,
        type: "string",
      },
      method: {
        value: method,
        type: "string",
      },
    },
  });

  if (method === "scrollIntoView") {
    logger({
      category: "action",
      message: "scrolling element into view",
      level: 2,
      auxiliary: {
        xpath: {
          value: xpath,
          type: "string",
        },
      },
    });
    try {
      await locator
        .evaluate((element: HTMLElement) => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        })
        .catch((e: Error) => {
          logger({
            category: "action",
            message: "error scrolling element into view",
            level: 1,
            auxiliary: {
              error: {
                value: e.message,
                type: "string",
              },
              trace: {
                value: e.stack,
                type: "string",
              },
              xpath: {
                value: xpath,
                type: "string",
              },
            },
          });
        });
    } catch (e) {
      logger({
        category: "action",
        message: "error scrolling element into view",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (method === "fill" || method === "type") {
    try {
      await locator.fill("");
      await locator.click();
      const text = args[0]?.toString();
      for (const char of text) {
        await stagehandPage.keyboard.type(char, {
          delay: Math.random() * 50 + 25,
        });
      }
    } catch (e) {
      logger({
        category: "action",
        message: "error filling element",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (method === "press") {
    try {
      const key = args[0]?.toString();
      await stagehandPage.keyboard.press(key);
    } catch (e) {
      logger({
        category: "action",
        message: "error pressing key",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          key: {
            value: args[0]?.toString() ?? "unknown",
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (typeof locator[method as keyof typeof locator] === "function") {
    // Log current URL before action
    logger({
      category: "action",
      message: "page URL before action",
      level: 2,
      auxiliary: {
        url: {
          value: stagehandPage.url(),
          type: "string",
        },
      },
    });

    // Perform the action
    try {
      await (
        locator[method as keyof Locator] as unknown as (
          ...args: string[]
        ) => Promise<void>
      )(...args.map((arg) => arg?.toString() || ""));
    } catch (e) {
      logger({
        category: "action",
        message: "error performing method",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
          method: {
            value: method,
            type: "string",
          },
          args: {
            value: JSON.stringify(args),
            type: "object",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }

    // Handle navigation if a new page is opened
    if (method === "click") {
      logger({
        category: "action",
        message: "clicking element, checking for page navigation",
        level: 1,
        auxiliary: {
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      const newOpenedTab = await Promise.race([
        new Promise<Page | null>((resolve) => {
          Promise.resolve(stagehandPage.context()).then((context) => {
            context.once("page", (page: Page) => resolve(page));
            setTimeout(() => resolve(null), 1_500);
          });
        }),
      ]);

      logger({
        category: "action",
        message: "clicked element",
        level: 1,
        auxiliary: {
          newOpenedTab: {
            value: newOpenedTab ? "opened a new tab" : "no new tabs opened",
            type: "string",
          },
        },
      });

      if (newOpenedTab) {
        logger({
          category: "action",
          message: "new page detected (new tab) with URL",
          level: 1,
          auxiliary: {
            url: {
              value: newOpenedTab.url(),
              type: "string",
            },
          },
        });
        await newOpenedTab.close();
        await stagehandPage.goto(newOpenedTab.url());
        await stagehandPage.waitForLoadState("domcontentloaded");
      }

      await Promise.race([
        stagehandPage.waitForLoadState("networkidle"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]).catch((e) => {
        logger({
          category: "action",
          message: "network idle timeout hit",
          level: 1,
          auxiliary: {
            trace: {
              value: e.stack,
              type: "string",
            },
            message: {
              value: e.message,
              type: "string",
            },
          },
        });
      });

      logger({
        category: "action",
        message: "finished waiting for (possible) page navigation",
        level: 1,
      });

      if (stagehandPage.url() !== initialUrl) {
        logger({
          category: "action",
          message: "new page detected with URL",
          level: 1,
          auxiliary: {
            url: {
              value: stagehandPage.url(),
              type: "string",
            },
          },
        });
      }
    }
  } else {
    logger({
      category: "action",
      message: "chosen method is invalid",
      level: 1,
      auxiliary: {
        method: {
          value: method,
          type: "string",
        },
      },
    });

    throw new PlaywrightCommandMethodNotSupportedException(
      `Method ${method} not supported`,
    );
  }
}
