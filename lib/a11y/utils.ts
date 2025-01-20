import { AccessibilityNode, TreeResult, AXNode } from "../../types/context";
import { StagehandPage } from "../StagehandPage";
import { LogLine } from "../../types/log";
import { CDPSession } from "playwright";

// Parser function for str output
export function formatSimplifiedTree(
  node: AccessibilityNode,
  level = 0,
): string {
  const indent = "  ".repeat(level);
  let result = `${indent}[${node.nodeId}] ${node.role}${node.name ? `: ${node.name}` : ""}\n`;

  if (node.children?.length) {
    result += node.children
      .map((child) => formatSimplifiedTree(child, level + 1))
      .join("");
  }
  return result;
}

/**
 * Helper function to remove or collapse unnecessary structural nodes
 * Handles three cases:
 * 1. Removes generic/none nodes with no children
 * 2. Collapses generic/none nodes with single child
 * 3. Keeps generic/none nodes with multiple children but cleans their subtrees
 */
function cleanStructuralNodes(
  node: AccessibilityNode,
): AccessibilityNode | null {
  // Base case: leaf node
  if (!node.children) {
    return node.role === "generic" || node.role === "none" ? null : node;
  }

  // Recursively clean children
  const cleanedChildren = node.children
    .map((child) => cleanStructuralNodes(child))
    .filter(Boolean) as AccessibilityNode[];

  // Handle generic/none nodes specially
  if (node.role === "generic" || node.role === "none") {
    if (cleanedChildren.length === 1) {
      // Collapse single-child generic nodes
      return cleanedChildren[0];
    } else if (cleanedChildren.length > 1) {
      // Keep generic nodes with multiple children
      return { ...node, children: cleanedChildren };
    }
    // Remove generic nodes with no children
    return null;
  }

  // For non-generic nodes, keep them if they have children after cleaning
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
export function buildHierarchicalTree(nodes: AccessibilityNode[]): TreeResult {
  // Map to store processed nodes for quick lookup
  const nodeMap = new Map<string, AccessibilityNode>();

  // First pass: Create nodes that are meaningful
  // We only keep nodes that either have a name or children to avoid cluttering the tree
  nodes.forEach((node) => {
    const hasChildren = node.childIds && node.childIds.length > 0;
    const hasValidName = node.name && node.name.trim() !== "";

    // Skip nodes that have no semantic value (no name and no children)
    if (!hasValidName && !hasChildren) {
      return;
    }

    // Create a clean node object with only relevant properties
    nodeMap.set(node.nodeId, {
      role: node.role,
      nodeId: node.nodeId,
      ...(hasValidName && { name: node.name }), // Only include name if it exists and isn't empty
      ...(node.description && { description: node.description }),
      ...(node.value && { value: node.value }),
    });
  });

  // Second pass: Establish parent-child relationships
  // This creates the actual tree structure by connecting nodes based on parentId
  nodes.forEach((node) => {
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
  const finalTree = nodes
    .filter((node) => !node.parentId && nodeMap.has(node.nodeId)) // Get root nodes
    .map((node) => nodeMap.get(node.nodeId))
    .filter(Boolean)
    .map((node) => cleanStructuralNodes(node))
    .filter(Boolean) as AccessibilityNode[];

  // Generate a simplified string representation of the tree
  const simplifiedFormat = finalTree
    .map((node) => formatSimplifiedTree(node))
    .join("\n");

  return {
    tree: finalTree,
    simplified: simplifiedFormat,
  };
}

export async function getAccessibilityTree(
  page: StagehandPage,
  logger: (logLine: LogLine) => void,
) {
  await page.enableCDP("Accessibility");

  try {
    const { nodes } = await page.sendCDP<{ nodes: AXNode[] }>(
      "Accessibility.getFullAXTree",
    );

    // Extract specific sources
    const sources = nodes.map((node) => ({
      role: node.role?.value,
      name: node.name?.value,
      description: node.description?.value,
      value: node.value?.value,
      nodeId: node.nodeId,
      parentId: node.parentId,
      childIds: node.childIds,
    }));
    // Transform into hierarchical structure
    const hierarchicalTree = buildHierarchicalTree(sources);

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

// This function is wrapped into a string and sent as a CDP command
// It is not meant to be actually executed here
function getNodePath(node: Element) {
  const parts = [];
  let current = node;

  while (current && current.parentNode) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      let tagName = current.tagName.toLowerCase();
      const sameTagSiblings = Array.from(current.parentNode.children).filter(
        (child) => child.tagName === current.tagName,
      );

      if (sameTagSiblings.length > 1) {
        let index = 1;
        for (const sibling of sameTagSiblings) {
          if (sibling === current) break;
          index++;
        }
        tagName += "[" + index + "]";
      }

      parts.unshift(tagName);
    }
    current = current.parentNode as Element;
  }

  return "/" + parts.join("/");
}

const functionString = getNodePath.toString();

export async function getXPathByResolvedObjectId(
  cdpClient: CDPSession,
  resolvedObjectId: string,
): Promise<string> {
  const { result } = await cdpClient.send("Runtime.callFunctionOn", {
    objectId: resolvedObjectId,
    functionDeclaration: `function() {
      ${functionString}
      return getNodePath(this);
    }`,
    returnByValue: true,
  });

  return result.value || "";
}
