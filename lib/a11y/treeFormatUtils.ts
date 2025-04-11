import { AccessibilityNode } from "../../types/context";

/**
 * We define an "inlineRoles" set that contains the roles we still treat as inline:
 *  - "StaticText" typically.
 *  - "link" (including comma‐separated variations, like "scrollable, link").
 * Everything else is considered block-level by default.
 */
const INLINE_ROLES = new Set([
  "statictext",
  "link",
  "image",
  "superscript",
  "Abbr",
]);

/**
 * The maximum character width per line when wrapping text segments.
 */
export const MAX_LINE_WIDTH = 100;

/**
 * Determines if a node is considered block-level. By default, we treat
 * everything as block-level unless it specifically matches one of our
 * "inline" roles (StaticText or link).
 *
 * @param node - The accessibility node to evaluate.
 * @returns true if the node is *not* in our inline roles, meaning it's block-level.
 */
export function isBlockLevel(node: AccessibilityNode): boolean {
  // Convert the node's role to lowercase, then split on commas to handle roles like "scrollable, link"
  const parts = node.role
    .toLowerCase()
    .split(",")
    .map((r) => r.trim());

  // If *any* part is in INLINE_ROLES, we consider it inline. Otherwise, block-level.
  const isInline = parts.some((p) => INLINE_ROLES.has(p));
  return !isInline;
}

/**
 * Determines if a node is an "inline leaf," meaning it:
 * 1) Is NOT block-level itself, and
 * 2) Has no children, or only children that are also inline leaves
 *    (i.e., no block-level descendants).
 *
 * @param node - The accessibility node to check.
 * @returns true if the node can be treated as inline-only with no block substructure.
 */
export function isInlineLeaf(node: AccessibilityNode): boolean {
  // If the node is block-level, it can't be an inline leaf
  if (isBlockLevel(node)) return false;

  if (!node.children || node.children.length === 0) {
    return true; // no children => definitely a leaf
  }
  // If *any* child is block-level or has children, this isn't a simple inline leaf
  for (const child of node.children) {
    if (isBlockLevel(child)) {
      return false;
    }
    if (child.children && child.children.length > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Gathers text from a node that is known to be an inline leaf.
 *
 * - If role is "StaticText", we split .name into words
 * - If role includes "link", we display [@nodeId] plus link text
 * - Otherwise, we gather from its children (recursively) if they're also inline leaves
 */
export function gatherInlineLeafText(node: AccessibilityNode): string[] {
  // Convert role to lowercase and split on commas
  const parts = node.role
    .toLowerCase()
    .split(",")
    .map((r) => r.trim());

  // 1) If it's static text
  if (parts.includes("statictext")) {
    const text = (node.name || "").trim();
    return text ? text.split(/\s+/) : [];
  }

  // 2) If it's a link
  if (parts.includes("link")) {
    const linkText = (node.name || "").trim();
    if (linkText) {
      return [`<[${node.nodeId}] (${linkText})>`];
    }
    return [`<[${node.nodeId}] link:>`];
  }

  // 3) Otherwise, if it's some inline container, gather text from children
  const result: string[] = [];
  if (node.children) {
    for (const child of node.children) {
      if (isInlineLeaf(child)) {
        result.push(...gatherInlineLeafText(child));
      }
    }
  }
  return result;
}

/**
 * Splits an array of tokens into wrapped lines (up to maxWidth), prefixing each line with indent.
 */
export function wrapTextSegments(
  segments: string[],
  indent: string,
  maxWidth: number = MAX_LINE_WIDTH,
): string {
  const lines: string[] = [];
  let currentLine = indent;

  for (const seg of segments) {
    // +1 for space
    if (currentLine.length + seg.length + 1 > maxWidth) {
      lines.push(currentLine);
      currentLine = indent + seg;
    } else {
      if (currentLine === indent) {
        currentLine += seg;
      } else {
        currentLine += " " + seg;
      }
    }
  }

  if (currentLine.trim() !== "") {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

/**
 * Formats an accessibility node into a multi-line string:
 *  1) Print "[nodeId] role(: name?)"
 *  2) If child is inline, accumulate its text in inlineBuffer
 *  3) If child is block-level, flush inlineBuffer, then recurse deeper
 */
export function formatSimplifiedTree(
  node: AccessibilityNode,
  level = 0,
): string {
  const indent = "  ".repeat(level);

  // Print a line for the current node: [nodeId] role(: name?)
  let output = ``;
  if (node.role === "link") {
    output = `${indent}<[${node.nodeId}]>`;
  } else {
    output = `${indent}[${node.nodeId}] ${node.role}`;
  }

  if (node.name) output += `: ${node.name}`;
  output += "\n";

  // Buffer for collecting inline text from consecutive inline-leaf children
  let inlineBuffer: string[] = [];

  if (node.children) {
    for (const child of node.children) {
      // If child is purely inline, gather its text
      if (isInlineLeaf(child)) {
        inlineBuffer.push(...gatherInlineLeafText(child));
      } else {
        // This child is a block-level or container node => flush inline text first
        if (inlineBuffer.length > 0) {
          const wrapped = wrapTextSegments(
            inlineBuffer,
            indent + "  ",
            MAX_LINE_WIDTH,
          );
          output += wrapped + "\n";
          inlineBuffer = [];
        }
        // Then format this block-level child recursively, increasing indentation
        output += formatSimplifiedTree(child, level + 1);
      }
    }
  }

  // Flush any leftover inline text
  if (inlineBuffer.length > 0) {
    const wrapped = wrapTextSegments(
      inlineBuffer,
      indent + "  ",
      MAX_LINE_WIDTH,
    );
    output += wrapped + "\n";
  }

  return output;
}
